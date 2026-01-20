require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const admin = require('firebase-admin');
const cors = require('cors');
const paypal = require('@paypal/checkout-server-sdk');

// --- 1. CONFIGURATION ---
const app = express();
app.use(cors());
app.use(express.json());

// Firebase Admin Setup
const serviceAccount = require(`./${process.env.FIREBASE_CREDENTIALS}`);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB Connected'))
  .catch(err => console.error('❌ MongoDB Error:', err));

// PayPal Setup
const Environment = process.env.PAYPAL_MODE === 'sandbox' 
  ? paypal.core.SandboxEnvironment 
  : paypal.core.LiveEnvironment;
const client = new paypal.core.PayPalHttpClient(
  new Environment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_CLIENT_SECRET)
);

// --- 2. DATABASE MODELS (Schema) ---
// User Schema (वही डेटा जो हमें चाहिए)
const userSchema = new mongoose.Schema({
  uid: { type: String, required: true, unique: true }, // Firebase UID
  email: String,
  customerId: String, // VM-2026-XXXX
  name: String,
  isPro: { type: Boolean, default: false },
  plan: { type: String, default: 'free' },
  planExpiry: Date,
  dailyLimitSeconds: { type: Number, default: 5400 },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

// Payment History Schema
const paymentSchema = new mongoose.Schema({
  uid: String,
  orderId: String,
  amount: String,
  planId: String,
  date: { type: Date, default: Date.now },
  status: String
});

const Payment = mongoose.model('Payment', paymentSchema);

// --- 3. PLANS CONFIGURATION (Secure) ---
const PLANS = {
  "daily_4hr":   { price: "4.99", days: 30, limit: 14400, name: "Creator Pro" },
  "daily_2hr":   { price: "2.99", days: 30, limit: 7200,  name: "Starter Flex" },
  "pro_monthly": { price: "5.99", days: 30, limit: -1,    name: "Monthly Pro" },
  "pro_yearly":  { price: "35.99", days: 365, limit: -1,   name: "Yearly Saver" },
  "pass_1day":   { price: "2.99", days: 1, limit: -1,     name: "1 Day Pass" }
};

// --- 4. MIDDLEWARE (Security Guard) ---
// यह चेक करेगा कि रिक्वेस्ट भेजने वाला यूजर असली है या नहीं
const verifyToken = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    req.uid = decodedToken.uid;
    req.email = decodedToken.email;
    next();
  } catch (error) {
    return res.status(403).json({ error: "Invalid Token" });
  }
};

// --- 5. API ROUTES ---

// A. Login/Sync User (Frontend से कॉल होगा जब यूजर लॉगिन करे)
app.post('/api/sync-user', verifyToken, async (req, res) => {
  try {
    let user = await User.findOne({ uid: req.uid });

    // अगर यूजर पहली बार आया है, तो नया बनाओ
    if (!user) {
      const year = new Date().getFullYear();
      const randomPart = Math.floor(1000 + Math.random() * 9000);
      const customID = `VM-${year}-${randomPart}`;

      user = new User({
        uid: req.uid,
        email: req.email,
        customerId: customID,
        name: req.body.name || "User"
      });
      await user.save();
      console.log(`🆕 New User Created: ${req.email}`);
    }

    res.json(user); // यूजर का डेटा वापस भेजो
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// B. Create PayPal Order
app.post('/api/create-order', verifyToken, async (req, res) => {
  const { planId } = req.body;
  const plan = PLANS[planId];

  if (!plan) return res.status(400).json({ error: "Invalid Plan" });

  const request = new paypal.orders.OrdersCreateRequest();
  request.prefer("return=representation");
  request.requestBody({
    intent: "CAPTURE",
    purchase_units: [{
      amount: { currency_code: "USD", value: plan.price },
      description: `Voice Master: ${plan.name}`
    }]
  });

  try {
    const order = await client.execute(request);
    res.json({ orderID: order.result.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "PayPal Error" });
  }
});

// C. Capture Order & Activate Plan
app.post('/api/capture-order', verifyToken, async (req, res) => {
  const { orderID, planId } = req.body;
  const plan = PLANS[planId];

  const request = new paypal.orders.OrdersCaptureRequest(orderID);
  request.requestBody({});

  try {
    const capture = await client.execute(request);
    
    if (capture.result.status === 'COMPLETED') {
      const now = new Date();
      const expiryDate = new Date();
      expiryDate.setDate(now.getDate() + plan.days);

      // MongoDB Update
      await User.findOneAndUpdate(
        { uid: req.uid },
        { 
          isPro: (plan.limit === -1),
          plan: planId,
          planExpiry: expiryDate,
          dailyLimitSeconds: plan.limit
        }
      );

      // Save Payment Record
      await new Payment({
        uid: req.uid,
        orderId: orderID,
        amount: plan.price,
        planId: planId,
        status: "Success"
      }).save();

      console.log(`💰 Plan Activated for ${req.email}: ${planId}`);
      res.json({ success: true });
    } else {
      res.json({ success: false });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Verification Failed" });
  }
});

// --- 6. START SERVER ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});