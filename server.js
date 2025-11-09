const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const crypto = require('crypto');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
require('dotenv').config();

const app = express();

// ⚙️ Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({
  origin: ['https://hungryhawk87.github.io', 'http://localhost:3000'],
  credentials: true
}));

// 🌐 MongoDB connection
let isMongoConnected = false;
const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI missing — gift cards won’t save!');
} else {
  mongoose.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
  }).then(() => {
    console.log('✅ Connected to MongoDB');
    isMongoConnected = true;
  }).catch(err => {
    console.error('❌ MongoDB connection error:', err.message);
  });
}

// 🎁 Gift Card Schema
const giftCardSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, index: true },
  recipient: String,
  recipientEmail: String,
  senderEmail: { type: String, required: true },
  amount: { type: Number, required: true, min: 1 },
  currency: { type: String, required: true },
  currencySymbol: String,
  message: String,
  denomType: { type: String, enum: ['fixed', 'multi'], default: 'fixed' },
  status: { type: String, enum: ['active', 'redeemed', 'expired'], default: 'active' },
  balance: Number,
  createdAt: { type: Date, default: Date.now },
  redeemedAt: Date,
  redemptionDetails: {
    withdrawalMethod: String,
    bankName: String,
    accountName: String,
    accountNumber: String,
    swiftCode: String,
    cryptoNetwork: String,
    walletAddress: String,
    email: String
  }
});
const GiftCard = mongoose.model('GiftCard', giftCardSchema);

// ✉️ Email sender using Resend API
async function sendEmail(to, subject, html) {
  if (!process.env.RESEND_API_KEY) {
    console.error('❌ RESEND_API_KEY not configured');
    return { success: false };
  }
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'LIKE Gift Cards <onboarding@resend.dev>',
        to: [to],
        subject,
        html
      })
    });

    if (!response.ok) {
      const text = await response.text();
      console.error('❌ Email send failed:', text);
      return { success: false };
    }

    console.log(`✅ Email sent to ${to}`);
    return { success: true };
  } catch (error) {
    console.error('❌ Email error:', error.message);
    return { success: false };
  }
}

// 🔢 Generate unique code
function generateGiftCardCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const parts = [];
  for (let g = 0; g < 3; g++) {
    let part = '';
    for (let c = 0; c < 4; c++) {
      part += alphabet[crypto.randomInt(0, alphabet.length)];
    }
    parts.push(part);
  }
  return `LIKE-${parts.join('-')}`;
}

// 🩺 Health check
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'LIKE Gift Cards API',
    mongodb: isMongoConnected ? 'connected' : 'disconnected',
    email: process.env.RESEND_API_KEY ? 'configured' : 'not configured',
    endpoints: {
      health: 'GET /',
      create: 'POST /api/giftcards/create',
      verify: 'POST /api/giftcards/verify',
      redeem: 'POST /api/giftcards/redeem'
    }
  });
});

// 🧾 Create Gift Card
app.post('/api/giftcards/create', async (req, res) => {
  try {
    console.log('📥 Received create request:', req.body);
    if (!isMongoConnected) {
      return res.status(503).json({ success: false, message: 'Database not connected' });
    }

    const { recipient, recipientEmail, senderEmail, amount, currency, currencySymbol, message, denomType } = req.body;
    if (!senderEmail || !amount || !currency) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    let code, attempts = 0;
    while (attempts < 10) {
      code = generateGiftCardCode();
      const existing = await GiftCard.findOne({ code });
      if (!existing) break;
      attempts++;
    }

    const giftCard = new GiftCard({
      code, recipient, recipientEmail, senderEmail, amount, currency, currencySymbol,
      message: message || 'A special gift for you!', denomType: denomType || 'fixed',
      balance: denomType === 'multi' ? amount : null, status: 'active'
    });

    await giftCard.save();
    console.log(`✅ Created gift card ${code}`);

    // Send email via Resend
    if (recipientEmail) {
      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto;">
          <h2 style="color: #ff8a00;">You've Received a LIKE Gift Card 🎁</h2>
          <p>Hi ${recipient || 'there'},</p>
          <div style="background: linear-gradient(90deg, #0b355b, #093b6d); color: white; padding: 20px; border-radius: 12px; margin: 20px 0;">
            <h3>Gift Card Code</h3>
            <p style="font-size: 24px; font-weight: bold; font-family: monospace;">${code}</p>
            <p><strong>Amount:</strong> ${currencySymbol}${amount}</p>
            ${message ? `<p><strong>Message:</strong> ${message}</p>` : ''}
          </div>
          <p>Redeem at: https://hungryhawk87.github.io/linkegiftcard.github.io/</p>
        </div>`;
      await sendEmail(recipientEmail, `Your LIKE Gift Card - ${currencySymbol}${amount}`, html);
    }

    res.json({
      success: true,
      message: 'Gift card created successfully',
      data: { code, amount, currency, currencySymbol, status: 'active', createdAt: giftCard.createdAt }
    });
  } catch (err) {
    console.error('❌ Create error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to create gift card: ' + err.message });
  }
});

// 🧾 Verify Gift Card
app.post('/api/giftcards/verify', async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ success: false, message: 'Code required' });
    const giftCard = await GiftCard.findOne({ code: code.toUpperCase() });
    if (!giftCard) return res.status(404).json({ success: false, message: 'Gift card not found' });
    res.json({ success: true, data: giftCard });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Verification failed: ' + err.message });
  }
});

// 💸 Redeem Gift Card
app.post('/api/giftcards/redeem', async (req, res) => {
  try {
    const { code, withdrawalMethod, email } = req.body;
    if (!code || !withdrawalMethod || !email) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    const giftCard = await GiftCard.findOne({ code: code.toUpperCase() });
    if (!giftCard) return res.status(404).json({ success: false, message: 'Gift card not found' });
    if (giftCard.status !== 'active') {
      return res.status(400).json({ success: false, message: `Gift card is ${giftCard.status}` });
    }

    giftCard.status = 'redeemed';
    giftCard.redeemedAt = new Date();
    await giftCard.save();

    await sendEmail(email, `LIKE Gift Card Redemption - ${code}`,
      `<h3>Your redemption is confirmed</h3><p>Code: ${code}</p><p>Status: redeemed</p>`);

    res.json({ success: true, message: 'Gift card redeemed successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Redemption failed: ' + err.message });
  }
});

// 🚀 Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`🌐 API: http://localhost:${PORT}/api`);
});

