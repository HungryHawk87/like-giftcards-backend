const express = require("express");
const Razorpay = require("razorpay");
const crypto = require("crypto");
const cors = require("cors");

const app = express();

// ===============================
// MIDDLEWARE
// ===============================
app.use(express.json());
app.use(cors({
  origin: '*', // In production, specify your domain
  credentials: true
}));

// ===============================
// 🔑 RAZORPAY CONFIGURATION
// ===============================
const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || "rzp_test_Rt6rTO0QIYWaVk";
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || "KfOmHp6IAJ70ij5opQ0HnC3h"; // ✅ CORRECTED - Added missing 'h'

const razorpay = new Razorpay({
  key_id: RAZORPAY_KEY_ID,
  key_secret: RAZORPAY_KEY_SECRET
});

// In-memory storage (replace with database in production)
const giftCards = new Map();

// ===============================
// HEALTH CHECK
// ===============================
app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "LIKE Razorpay backend running ✅",
    timestamp: new Date().toISOString()
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "LIKE Gift Cards API is running",
    timestamp: new Date().toISOString(),
    stats: {
      giftCards: giftCards.size
    }
  });
});

// ===============================
// CREATE ORDER
// ===============================
app.post("/api/razorpay/create-order", async (req, res) => {
  try {
    console.log("📦 Incoming order request:", req.body);
    
    const { amount, currency, receipt } = req.body;
    
    // Validate amount
    if (!amount || amount < 1) {
      return res.status(400).json({ 
        success: false,
        error: "Amount must be at least ₹1" 
      });
    }

    // Create Razorpay order
    const options = {
      amount: Number(amount) * 100, // Convert to paise
      currency: currency || "INR",
      receipt: receipt || `receipt_${Date.now()}`,
      notes: {
        purpose: "Gift Card Purchase"
      }
    };

    const order = await razorpay.orders.create(options);
    
    console.log("✅ Order created successfully:", order.id);
    
    res.json({
      success: true,
      order: order
    });
    
  } catch (err) {
    console.error("❌ RAZORPAY ORDER ERROR:", err);
    res.status(500).json({ 
      success: false,
      error: err.error?.description || err.message 
    });
  }
});

// ===============================
// VERIFY PAYMENT
// ===============================
app.post("/api/razorpay/verify", (req, res) => {
  try {
    console.log("🔍 Verifying payment:", req.body);
    
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature
    } = req.body;

    // Validate required fields
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ 
        success: false,
        error: "Missing payment details" 
      });
    }

    // Create signature for verification
    const body = razorpay_order_id + "|" + razorpay_payment_id;
    
    const expectedSignature = crypto
      .createHmac("sha256", RAZORPAY_KEY_SECRET) // ✅ CORRECTED - Use RAZORPAY_KEY_SECRET variable
      .update(body)
      .digest("hex");

    // Verify signature
    if (expectedSignature !== razorpay_signature) {
      console.log("❌ Payment signature mismatch");
      return res.status(400).json({ 
        success: false,
        error: "Invalid payment signature" 
      });
    }

    console.log("✅ Payment verified successfully");

    // Generate gift card code
    const code = generateGiftCardCode();
    
    // Store gift card (in production, save to database)
    const giftCard = {
      code: code,
      orderId: razorpay_order_id,
      paymentId: razorpay_payment_id,
      status: "active",
      createdAt: new Date().toISOString()
    };
    
    giftCards.set(code, giftCard);

    res.json({ 
      success: true, 
      code: code,
      message: "Payment verified and gift card created"
    });
    
  } catch (err) {
    console.error("❌ Verify Error:", err);
    res.status(500).json({ 
      success: false, 
      error: err.message 
    });
  }
});

// ===============================
// GIFT CARD ROUTES
// ===============================

// Create Gift Card (with payment details)
app.post("/api/giftcards/create", async (req, res) => {
  try {
    const {
      recipient,
      recipientEmail,
      senderEmail,
      amount,
      currency,
      currencySymbol,
      message,
      denomType,
      paymentId,
      orderId
    } = req.body;

    // Validate required fields
    if (!senderEmail || !amount) {
      return res.status(400).json({
        success: false,
        message: "Sender email and amount are required"
      });
    }

    // Generate gift card code
    const code = generateGiftCardCode();

    // Create gift card
    const giftCard = {
      code,
      recipient,
      recipientEmail,
      senderEmail,
      amount,
      currency,
      currencySymbol,
      message: message || "A special gift for you!",
      denomType: denomType || "fixed",
      status: "active",
      paymentId,
      orderId,
      createdAt: new Date().toISOString(),
      redeemedAt: null
    };

    // Store gift card
    giftCards.set(code, giftCard);

    console.log("🎁 Gift card created:", code);

    res.json({
      success: true,
      data: giftCard
    });

  } catch (error) {
    console.error("❌ Create gift card error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create gift card",
      error: error.message
    });
  }
});

// Verify Gift Card
app.post("/api/giftcards/verify", (req, res) => {
  try {
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({
        success: false,
        message: "Gift card code is required"
      });
    }

    const giftCard = giftCards.get(code.toUpperCase());

    if (!giftCard) {
      return res.status(404).json({
        success: false,
        message: "Invalid gift card code"
      });
    }

    res.json({
      success: true,
      data: giftCard
    });

  } catch (error) {
    console.error("❌ Verify gift card error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to verify gift card",
      error: error.message
    });
  }
});

// Redeem Gift Card
app.post("/api/giftcards/redeem", (req, res) => {
  try {
    const {
      code,
      withdrawalMethod,
      email,
      bankName,
      accountName,
      accountNumber,
      swiftCode,
      cryptoNetwork,
      walletAddress
    } = req.body;

    // Validate input
    if (!code || !withdrawalMethod || !email) {
      return res.status(400).json({
        success: false,
        message: "Code, withdrawal method, and email are required"
      });
    }

    const giftCard = giftCards.get(code.toUpperCase());

    if (!giftCard) {
      return res.status(404).json({
        success: false,
        message: "Invalid gift card code"
      });
    }

    if (giftCard.status !== "active") {
      return res.status(400).json({
        success: false,
        message: `Gift card is ${giftCard.status}`
      });
    }

    // Update gift card status
    giftCard.status = "redeemed";
    giftCard.redeemedAt = new Date().toISOString();
    giftCard.redemptionDetails = {
      withdrawalMethod,
      email,
      bankName,
      accountName,
      accountNumber,
      swiftCode,
      cryptoNetwork,
      walletAddress
    };
    
    giftCards.set(code.toUpperCase(), giftCard);

    console.log("✅ Gift card redeemed:", code);

    res.json({
      success: true,
      message: "Redemption request submitted successfully"
    });

  } catch (error) {
    console.error("❌ Redeem gift card error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to redeem gift card",
      error: error.message
    });
  }
});

// ===============================
// ADMIN ROUTES (for testing)
// ===============================

// Get all gift cards
app.get("/api/admin/giftcards", (req, res) => {
  const allCards = Array.from(giftCards.values());
  res.json({
    success: true,
    count: allCards.length,
    data: allCards
  });
});

// ===============================
// HELPER FUNCTIONS
// ===============================

function generateGiftCardCode() {
  const part1 = crypto.randomBytes(2).toString("hex").toUpperCase();
  const part2 = crypto.randomBytes(2).toString("hex").toUpperCase();
  const part3 = crypto.randomBytes(2).toString("hex").toUpperCase();
  return `LIKE-${part1}-${part2}-${part3}`;
}

// ===============================
// ERROR HANDLING
// ===============================
app.use((err, req, res, next) => {
  console.error("❌ Error:", err);
  res.status(500).json({
    success: false,
    message: "Internal server error",
    error: err.message
  });
});

// ===============================
// START SERVER
// ===============================
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   🎁 LIKE GIFT CARDS API SERVER                          ║
║                                                           ║
║   ✅ Server running on port: ${PORT}                     ║
║   🔑 Razorpay Key ID: ${RAZORPAY_KEY_ID}                 ║
║                                                           ║
║   📝 Endpoints:                                           ║
║   GET  /                                                  ║
║   GET  /api/health                                       ║
║   POST /api/razorpay/create-order                        ║
║   POST /api/razorpay/verify                              ║
║   POST /api/giftcards/create                             ║
║   POST /api/giftcards/verify                             ║
║   POST /api/giftcards/redeem                             ║
║   GET  /api/admin/giftcards                              ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
  `);
});

module.exports = app;
