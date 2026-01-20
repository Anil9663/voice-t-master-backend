require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const admin = require('firebase-admin');
const cors = require('cors');
const paypal = require('@paypal/checkout-server-sdk');
const path = require('path'); // ✅ यह लाइन बहुत जरुरी है

// --- 1. CONFIGURATION ---
const app = express();
app.use(cors());
app.use(express.json());

// ✅ Public Folder को Open करें (ताकि payment.html दिखे)
app.use(express.static('public'));

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

// --- 2. DATABASE MODELS ---
const userSchema = new mongoose.Schema({
  uid: { type: String, required: true, unique: true },
  email: String,
  customerId: String,
  name: String,
  isPro: { type: Boolean, default: false },
  plan: { type: String, default: 'free' },
  planExpiry: Date,
  dailyLimitSeconds: { type: Number, default: 5400 },
  createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

const paymentSchema = new mongoose.Schema({
  uid: String,
  orderId: String,
  amount: String,
  planId: String,
  date: { type: Date, default: Date.now },
  status: String
});
const Payment = mongoose.model('Payment', paymentSchema);

// --- 3. PLANS CONFIGURATION ---
const PLANS = {
  "daily_4hr":   { price: "4.99", days: 30, limit: 14400, name: "Creator Pro" },
  "daily_2hr":   { price: "2.99", days: 30, limit: 7200,  name: "Starter Flex" },
  "daily_2_5hr": { price: "3.49", days: 30, limit: 9000,  name: "Student Smart" },
  "daily_3hr":   { price: "3.99", days: 30, limit: 10800, name: "Study Plus" },
  "daily_3_5hr": { price: "4.49", days: 30, limit: 12600, name: "Writer Flow" },
  "pro_monthly": { price: "5.99", days: 30, limit: -1,    name: "Monthly Pro" },
  "pro_quarterly": { price: "14.99", days: 90, limit: -1, name: "3 Months Pro" },
  "pro_biannual": { price: "23.99", days: 180, limit: -1, name: "6 Months Pro" },
  "pro_yearly":  { price: "35.99", days: 365, limit: -1,   name: "Yearly Saver" },
  "lifetime_pro": { price: "199.99", days: 36500, limit: -1, name: "Lifetime Access" },
  "pass_1day":   { price: "2.99", days: 1, limit: -1,     name: "1 Day Pass" },
  "pass_3day":   { price: "3.99", days: 3, limit: -1,     name: "3 Day Pass" },
  "pass_7day":   { price: "4.99", days: 7, limit: -1,     name: "7 Day Pass" }
};

// --- 4. MIDDLEWARE (Token Check) ---
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

// ✅ ROUTE 1: Payment Page Serve करना
app.get('/pay', (req, res) => {
    // यह public/payment.html फाइल को ब्राउज़र में भेजेगा
    res.sendFile(path.join(__dirname, 'public', 'payment.html'));
});

// ✅ ROUTE 2: Sync User (Extension से)
app.post('/api/sync-user', verifyToken, async (req, res) => {
  try {
    let user = await User.findOne({ uid: req.uid });
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
    }
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ ROUTE 3: Create Order (WEB VERSION - No Token Header)
app.post('/api/create-order-web', async (req, res) => {
  const { planId, uid } = req.body; // UID body से आएगा
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

// ✅ ROUTE 4: Capture Order (WEB VERSION - No Token Header)
app.post('/api/capture-order-web', async (req, res) => {
  const { orderID, planId, uid } = req.body;
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
        { uid: uid }, // UID सीधे उपयोग करें
        { 
          isPro: (plan.limit === -1),
          plan: planId,
          planExpiry: expiryDate,
          dailyLimitSeconds: plan.limit
        }
      );

      // Save Payment
      await new Payment({
        uid: uid,
        orderId: orderID,
        amount: plan.price,
        planId: planId,
        status: "Success"
      }).save();

      console.log(`💰 Plan Activated for ${uid}: ${planId}`);
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