
import express from "express";
import Razorpay from "razorpay";
import crypto from "crypto";
import cors from "cors";
import axios from "axios";

const app = express();
app.use(express.json());
app.use(cors());

// 🔑 Razorpay TEST keys (MOVE TO ENV LATER)
const razorpay = new Razorpay({
  key_id: "rzp_test_Rt6rTO0QIYWaVk",
  key_secret: "KfOmHp6IAJ70ij5opQ0HnC3"
});

// ================================
// CREATE RAZORPAY ORDER
// ================================
app.post("/api/razorpay/create-order", async (req, res) => {
  try {
    const { amount, email } = req.body;

    if (!amount) {
      return res.status(400).json({ message: "Amount required" });
    }

    const order = await razorpay.orders.create({
      amount: Number(amount) * 100, // paise
      currency: "INR",
      receipt: "LIKE_" + Date.now(),
      notes: { email }
    });

    res.json(order);
  } catch (err) {
    console.error("Create order error:", err);
    res.status(500).json({ message: err.message });
  }
});

// ================================
// VERIFY PAYMENT + CREATE GIFT CARD
// ================================
app.post("/api/razorpay/verify", async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      recipient,
      recipientEmail,
      senderEmail,
      amount,
      currency,
      currencySymbol,
      message,
      denomType
    } = req.body;

    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expected = crypto
      .createHmac("sha256", razorpay.key_secret)
      .update(body)
      .digest("hex");

    if (expected !== razorpay_signature) {
      return res.status(400).json({ success: false, message: "Invalid signature" });
    }

    // ✅ CREATE GIFT CARD ONLY AFTER PAYMENT
    const giftRes = await axios.post(
      "https://like-giftcards-api.onrender.com/api/giftcards/create",
      {
        recipient,
        recipientEmail,
        senderEmail,
        amount: Number(amount),
        currency,
        currencySymbol,
        message,
        denomType
      }
    );

    res.json({
      success: true,
      code: giftRes.data.data.code
    });

  } catch (err) {
    console.error("Verify error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get("/", (_, res) => res.send("LIKE Razorpay backend running"));

app.listen(process.env.PORT || 5000, () =>
  console.log("🚀 Razorpay backend running")
);
