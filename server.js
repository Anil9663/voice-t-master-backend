require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const admin = require('firebase-admin');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');
const paypal = require('@paypal/checkout-server-sdk');

// Models Import
const User = require('./models/User');
const Counter = require('./models/Counter');

// --- CONFIG ---
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Payment page serve karne ke liye

// Secret Key (इसे .env में रखना सुरक्षित है)
const JWT_SECRET = process.env.JWT_SECRET || "MY_SUPER_SECRET_DIGITAL_KEY_123";

// Firebase Setup
const serviceAccount = require(`./${process.env.FIREBASE_CREDENTIALS}`);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

// MongoDB Setup
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

// Plans Config
const PLANS = {
  "daily_4hr": { price: "4.99", days: 30, limit: 14400, name: "Creator Pro" },
  "daily_2hr": { price: "2.99", days: 30, limit: 7200, name: "Starter Flex" },
  "pro_monthly": { price: "5.99", days: 30, limit: -1, name: "Monthly Pro" },
  "pro_yearly": { price: "35.99", days: 365, limit: -1, name: "Yearly Saver" },
  "lifetime_pro": { price: "199.99", days: 36500, limit: -1, name: "Lifetime Access" },
  "pass_1day": { price: "2.99", days: 1, limit: -1, name: "1 Day Pass" }
};

// --- 🛠️ HELPER: ID GENERATOR ---
// Format: VTM-202601301000
async function generateCustomerId() {
  const now = new Date();
  // UTC Date Parts
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');

  const dateStr = `${year}${month}${day}`; // 20260130

  // Counter Update (Atomic Operation)
  const counter = await Counter.findByIdAndUpdate(
    { _id: 'customerId' },
    { $inc: { seq: 1 } },
    { new: true, upsert: true } // Create if not exists
  );

  return `VTM-${dateStr}${counter.seq}`;
}

// --- 🔒 MIDDLEWARE: Verify Session ---
const verifySession = (req, res, next) => {
  const token = req.headers['x-session-token'];
  if (!token) return res.status(401).json({ error: "Access Denied" });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ error: "Invalid Session" });
  }
};

// =========================================================
// 🚀 API ROUTES
// =========================================================

// 1. LOGIN & SETUP (Secure)
app.post('/api/auth/login', async (req, res) => {
  // Frontend se data:
  const { firebaseToken, country, language, survey } = req.body;

  // 🛡️ SERVER VALIDATION (Security Check)
  if (!country || !language) {
    return res.status(400).json({ error: "Country and Language are required!" });
  }

  // सर्वे वैलिडेशन (अगर भेजा है तो सही होना चाहिए)
  if (survey) {
    const validProfessions = ['student', 'developer', 'writer', 'business', 'medical', 'other'];
    if (survey.profession && !validProfessions.includes(survey.profession)) {
      return res.status(400).json({ error: "Invalid Profession Selection" });
    }
  }

  try {
    // A. Verify Firebase Token
    const decodedToken = await admin.auth().verifyIdToken(firebaseToken);
    const uid = decodedToken.uid;
    const email = decodedToken.email;

    // B. Find or Create User
    let user = await User.findOne({ uid });

    if (!user) {
      // --- NEW USER ---
      const newId = await generateCustomerId();
      console.log(`🆕 Creating User: ${newId} (${country})`);

      user = new User({
        uid,
        customerId: newId,
        email,
        name: decodedToken.name || "User",
        analytics: {
          country,
          inputLanguage: language,
          survey: survey || {} // सर्वे डाटा सेव
        }
      });
      await user.save();
    } else {
            // --- EXISTING USER (Migration Fix) ---
            
            // 1. अगर पुराने यूजर के पास ID नहीं है, तो अभी जेनरेट करें
            if (!user.customerId) {
                const newId = await generateCustomerId();
                user.customerId = newId;
                console.log(`♻️ Generated ID for Existing User: ${newId}`);
            }

            // 2. डेटा ओवरराइट (Override) करें
            // हमें यह सुनिश्चित करना है कि analytics ऑब्जेक्ट मौजूद हो
            if (!user.analytics) user.analytics = {};

            user.analytics.country = country;
            user.analytics.inputLanguage = language;
            
            // 3. सर्वे डेटा अपडेट (Survey Data Update)
            if (survey) {
                user.analytics.survey = {
                    profession: survey.profession || user.analytics.survey?.profession || 'Unknown',
                    useCase: survey.useCase || user.analytics.survey?.useCase || 'Unknown',
                    source: survey.source || user.analytics.survey?.source || 'Unknown'
                };
            }
            
            user.lastLogin = new Date();
            await user.save();
            console.log(`✅ User Updated: ${user.customerId}`);
        }

    // C. 🔥 GENERATE SECURE SESSION TOKEN
    // यह टोकन फ्रंटेंड में सेव होगा
    const sessionToken = jwt.sign(
      {
        cid: user.customerId,
        isPro: user.isPro,
        plan: user.plan,
        expiry: user.planExpiry, // UTC Date
        uid: user.uid
      },
      JWT_SECRET,
      { expiresIn: '30d' } // 30 दिन वैलिड
    );

    res.json({ success: true, sessionToken });

  } catch (err) {
    console.error("Login Error:", err);
    res.status(500).json({ error: "Server Error during Login" });
  }
});

// 2. GENERATE PAYMENT LINK
app.post('/api/payment/create-link', verifySession, async (req, res) => {
  const { planId } = req.body;
  if (!PLANS[planId]) return res.status(400).json({ error: "Invalid Plan" });

  // Payment Token (Short lived)
  const paymentToken = jwt.sign(
    {
      cid: req.user.cid,
      uid: req.user.uid,
      plan: planId,
      price: PLANS[planId].price
    },
    JWT_SECRET,
    { expiresIn: '30m' }
  );

  const paymentUrl = `https://voice-t-master-backend.onrender.com/pay?token=${paymentToken}`;
  res.json({ url: paymentUrl });
});

// 3. SERVE PAYMENT PAGE
app.get('/pay', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'payment.html'));
});

// 4. VERIFY PAYMENT PAGE TOKEN (Called by payment.html)
app.post('/api/payment/verify-token', async (req, res) => {
  const { token } = req.body;
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const plan = PLANS[decoded.plan];
    res.json({ valid: true, planName: plan.name, price: plan.price });
  } catch (e) {
    res.status(400).json({ valid: false, error: "Link Expired" });
  }
});

// 5. CAPTURE ORDER
app.post('/api/payment/capture', async (req, res) => {
  const { orderID, token } = req.body;
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const plan = PLANS[decoded.plan];

    const request = new paypal.orders.OrdersCaptureRequest(orderID);
    request.requestBody({});
    const capture = await client.execute(request);

    if (capture.result.status === 'COMPLETED') {
      const now = new Date();
      const expiryDate = new Date();
      expiryDate.setDate(now.getDate() + plan.days);

      await User.findOneAndUpdate(
        { uid: decoded.uid },
        {
          isPro: (plan.limit === -1),
          plan: decoded.plan,
          planExpiry: expiryDate,
          dailyLimitSeconds: plan.limit
        }
      );
      console.log(`💰 Paid: ${decoded.cid}`);
      res.json({ success: true });
    }
  } catch (e) {
    res.status(500).json({ error: "Capture Failed" });
  }
});

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server Running on UTC Timezone`);
});