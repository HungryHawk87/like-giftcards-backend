const express = require("express");
const Razorpay = require("razorpay");
const crypto = require("crypto");
const cors = require("cors");

const app = express();
app.use(express.json());
app.use(cors());

// 🔑 Razorpay TEST keys (ENV later)
const razorpay = new Razorpay({
  key_id: "rzp_test_Rt6rTO0QIYWaVk",
  key_secret: "KfOmHp6IAJ70ij5opQ0HnC3"
});

// ===============================
// HEALTH CHECK
// ===============================
app.get("/", (req, res) => {
  res.send("LIKE Razorpay backend running");
});

// ===============================
// CREATE ORDER
// ===============================
app.post("/api/razorpay/create-order", async (req, res) => {
  try {
    console.log("Incoming order:", req.body);

    const order = await razorpay.orders.create({
      amount: Number(req.body.amount) * 100,
      currency: "INR"
    });

    console.log("Order created:", order.id);
    res.json(order);
  } catch (err) {
    console.error("RAZORPAY ERROR:", err);
    res.status(500).json({ error: err.error?.description || err.message });
  }
});


// ===============================
// VERIFY PAYMENT
// ===============================
app.post("/api/razorpay/verify", (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature
    } = req.body;

    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expected = crypto
      .createHmac("sha256", "OdnRMEZGaqizY3jg5uB24gM9")
      .update(body)
      .digest("hex");

    if (expected !== razorpay_signature) {
      return res.status(400).json({ success: false });
    }

    // ✅ PAYMENT VERIFIED (Gift card creation handled separately)
    res.json({ success: true, code: "LIKE-" + Date.now() });
  } catch (err) {
    console.error("Verify Error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () =>
  console.log("🚀 Razorpay backend running on port", PORT)
);


