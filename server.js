const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
require('dotenv').config();

const app = express();

// ✅ Improved CORS setup
const allowedOrigins = [
  "https://hungryhawk87.github.io",
  "http://localhost:3000"
];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("CORS not allowed for this origin"));
      }
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

// ✅ Handle preflight requests (important for browsers)
app.options("*", cors());


// Gift Card Schema
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

// Email Configuration
let transporter = null;
if (process.env.EMAIL_USER && process.env.EMAIL_PASSWORD) {
  transporter = nodemailer.createTransport({
    service: process.env.EMAIL_SERVICE || 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD
    }
  });
}

// Generate unique code
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

// Send Email
async function sendEmail(to, subject, html) {
  if (!transporter) {
    console.log('Email not configured');
    return { success: false };
  }
  try {
    await transporter.sendMail({
      from: `"LIKE Gift Cards" <${process.env.EMAIL_USER}>`,
      to, subject, html
    });
    return { success: true };
  } catch (error) {
    console.error('Email error:', error);
    return { success: false };
  }
}

// Routes

app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'LIKE Gift Cards API',
    endpoints: {
      health: 'GET /',
      create: 'POST /api/giftcards/create',
      verify: 'POST /api/giftcards/verify',
      redeem: 'POST /api/giftcards/redeem'
    }
  });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

// Create Gift Card
app.post('/api/giftcards/create', async (req, res) => {
  try {
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
      code, recipient, recipientEmail, senderEmail, amount,
      currency, currencySymbol, 
      message: message || 'A special gift for you!',
      denomType: denomType || 'fixed',
      balance: denomType === 'multi' ? amount : null,
      status: 'active'
    });

    await giftCard.save();

    // Send email if recipient email provided
    if (recipientEmail && transporter) {
      const emailHtml = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #ff8a00;">You've Received a LIKE Gift Card! 🎁</h2>
          <p>Hi ${recipient || 'there'},</p>
          <div style="background: linear-gradient(90deg, #0b355b, #093b6d); padding: 20px; border-radius: 12px; color: white; margin: 20px 0;">
            <h3 style="margin: 0;">Gift Card Code</h3>
            <p style="font-size: 24px; font-weight: bold; font-family: monospace;">${code}</p>
            <p><strong>Amount:</strong> ${currencySymbol}${amount}</p>
            ${message ? `<p><strong>Message:</strong> ${message}</p>` : ''}
          </div>
          <p>Visit https://hungryhawk87.github.io/linkegiftcard.github.io/ to redeem</p>
        </div>
      `;
      await sendEmail(recipientEmail, `Your LIKE Gift Card - ${currencySymbol}${amount}`, emailHtml);
    }

    res.json({
      success: true,
      message: 'Gift card created',
      data: { code, amount, currency, currencySymbol, status: 'active', createdAt: giftCard.createdAt }
    });

  } catch (error) {
    console.error('Create error:', error);
    res.status(500).json({ success: false, message: 'Failed to create gift card' });
  }
});

// Verify Gift Card
app.post('/api/giftcards/verify', async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) {
      return res.status(400).json({ success: false, message: 'Code required' });
    }

    const giftCard = await GiftCard.findOne({ code: code.toUpperCase() });
    if (!giftCard) {
      return res.status(404).json({ success: false, message: 'Gift card not found' });
    }

    res.json({
      success: true,
      data: {
        code: giftCard.code,
        amount: giftCard.amount,
        currency: giftCard.currency,
        currencySymbol: giftCard.currencySymbol,
        status: giftCard.status,
        balance: giftCard.balance,
        message: giftCard.message,
        createdAt: giftCard.createdAt
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Verification failed' });
  }
});

// Redeem Gift Card
app.post('/api/giftcards/redeem', async (req, res) => {
  try {
    const { code, withdrawalMethod, bankName, accountName, accountNumber, swiftCode, cryptoNetwork, walletAddress, email } = req.body;

    if (!code || !withdrawalMethod || !email) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    const giftCard = await GiftCard.findOne({ code: code.toUpperCase() });
    if (!giftCard) {
      return res.status(404).json({ success: false, message: 'Gift card not found' });
    }
    if (giftCard.status !== 'active') {
      return res.status(400).json({ success: false, message: `Gift card is ${giftCard.status}` });
    }

    giftCard.status = 'redeemed';
    giftCard.redeemedAt = new Date();
    giftCard.redemptionDetails = {
      withdrawalMethod, bankName, accountName, accountNumber, 
      swiftCode, cryptoNetwork, walletAddress, email
    };
    await giftCard.save();

    // Send confirmation email
    if (transporter) {
      let paymentDetails = '';
      if (withdrawalMethod === 'bank') {
        paymentDetails = `Bank: ${bankName}<br>Account: ${accountNumber}`;
      } else {
        paymentDetails = `Network: ${cryptoNetwork}<br>Wallet: ${walletAddress}`;
      }

      const emailHtml = `
        <h2 style="color: #ff8a00;">Redemption Confirmed</h2>
        <p>Code: ${giftCard.code}</p>
        <p>Amount: ${giftCard.currencySymbol}${giftCard.amount}</p>
        <p>Method: ${withdrawalMethod}</p>
        <p>${paymentDetails}</p>
        <p>Processing time: 2-3 business days</p>
      `;
      await sendEmail(email, `LIKE Gift Card Redemption - ${code}`, emailHtml);
    }

    res.json({
      success: true,
      message: 'Gift card redeemed successfully',
      data: { code: giftCard.code, status: 'redeemed' }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Redemption failed' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✓ Server running on port ${PORT}`);
});