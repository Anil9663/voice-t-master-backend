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

// --- 🛡️ VALIDATION CONSTANTS ---
// Allowed Countries (Whitelist)
const ALLOWED_COUNTRIES = [
  "India", "United States", "United Kingdom", "Canada", "Australia",
  "Germany", "France", "Japan", "China", "Brazil", "Unknown" // Fallback
];

// Allowed Languages (Whitelist)
const ALLOWED_LANGUAGES = [
  "hi-IN", "en-US", "en-GB", "es-ES", "fr-FR", "de-DE", "ja-JP",
  "zh-CN", "pt-BR", "Unknown"
];

// Allowed Survey Data
// Allowed Survey Data
const ALLOWED_PROFESSIONS = [
  'student', 'developer', 'writer', 'business', 'medical', 'other', 'Unknown',
  // UI Display Values (Fallback)
  'Student / Researcher', 'Developer / Engineer', 'Writer / Content Creator', 'Business / Professional'
];

const ALLOWED_USECASES = [
  'learning', 'working', 'coding', 'writing', 'personal', 'emails', 'docs', 'other', 'Unknown',
  // UI Display Values (Fallback)
  'Writing Emails & Messages', 'Creating Documents / Notes', 'Voice Coding', 'Language Learning'
];

const ALLOWED_SOURCES = [
  'google', 'youtube', 'friend', 'social', 'ads', 'other', 'Unknown',
  // UI Display Values (Fallback)
  'YouTube', 'Google Search', 'Friend / Colleague', 'Social Media'
];

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

  return `VTM-${dateStr}-${counter.seq}`;
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

  try {
    // 🛡️ 1. STRICT VALIDATION (Whitelist Check)
    // if (!ALLOWED_COUNTRIES.includes(country)) return res.status(400).json({ error: "Invalid Country" }); // Disabled: Frontend allows all
    if (!ALLOWED_LANGUAGES.includes(language)) return res.status(400).json({ error: "Invalid Language" });

    if (survey) {
      if (survey.profession && !ALLOWED_PROFESSIONS.includes(survey.profession)) return res.status(400).json({ error: "Invalid Profession" });
      if (survey.useCase && !ALLOWED_USECASES.includes(survey.useCase)) return res.status(400).json({ error: "Invalid Use Case" });
      if (survey.source && !ALLOWED_SOURCES.includes(survey.source)) return res.status(400).json({ error: "Invalid Source" });
    }

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
        plan: "free", // Default
        isPro: false,
        analytics: {
          country,
          inputLanguage: language,
          survey: survey || {}
        }
      });
      await user.save();
    } else {
      // --- EXISTING USER ---
      if (!user.customerId) {
        const newId = await generateCustomerId();
        user.customerId = newId;
      }

      // Update Analytics (Trusted Data)
      if (!user.analytics) user.analytics = {};
      user.analytics.country = country;
      user.analytics.inputLanguage = language;

      // Update Survey (Merge)
      if (survey) {
        user.analytics.survey = {
          profession: survey.profession || user.analytics.survey?.profession || 'Unknown',
          useCase: survey.useCase || user.analytics.survey?.useCase || 'Unknown',
          source: survey.source || user.analytics.survey?.source || 'Unknown'
        };
      }

      user.lastLogin = new Date();
      await user.save();
    }

    // C. 🔥 PREPARE SECURE TOKEN DATA
    // Calculate Limits
    let currentLimit = 5400; // Default Free: 90 Mins
    const userPlan = PLANS[user.plan] || PLANS['daily_4hr']; // Default fallback if needed

    // Check if Plan Valid/Expired
    const now = new Date();
    const expiry = user.planExpiry ? new Date(user.planExpiry) : null;
    let isExpired = false;

    if (user.isPro && expiry && now > expiry) {
      isExpired = true;
      console.log(`⚠️ Plan Expired for ${user.customerId}`);
      // Notify User (Email Trigger)
      // sendPlanExpiredEmail(user.email); 
    }

    // Determine Final Limits for Token
    if (user.isPro && !isExpired) {
      currentLimit = user.dailyLimitSeconds || -1; // -1 means Unlimited
    } else {
      currentLimit = 5400; // Back to Free Limit
    }

    // D. GENERATE SIGNED SESSION TOKEN
    const sessionToken = jwt.sign(
      {
        cid: user.customerId,
        isPro: (user.isPro && !isExpired), // Token says FALSE if expired
        plan: isExpired ? 'free' : user.plan,
        expiry: user.planExpiry, // UTC String
        limit: currentLimit,     // Daily Limit in Seconds
        uid: user.uid
      },
      JWT_SECRET,
      { expiresIn: '24h' } // Short Lived (Security)
    );

    res.json({ success: true, sessionToken });

  } catch (err) {
    console.error("Login Error:", err);
    res.status(500).json({ error: "Server Error" });
  }
});

// 1.1 SYNC USER STATUS (Polling)
app.post('/api/sync-user', async (req, res) => {
  const { firebaseToken } = req.body;
  try {
    const decodedToken = await admin.auth().verifyIdToken(firebaseToken);
    const user = await User.findOne({ uid: decodedToken.uid });
    if (!user) return res.status(404).json({ error: "User not found" });

    // Logic to check expiry (Same as Login)
    const now = new Date();
    const expiry = user.planExpiry ? new Date(user.planExpiry) : null;
    let isExpired = false;
    let currentLimit = 5400;

    if (user.isPro && expiry && now > expiry) {
      isExpired = true;
      // Notify User (Email Trigger)
      // sendPlanExpiredEmail(user.email);
    }

    if (user.isPro && !isExpired) {
      currentLimit = user.dailyLimitSeconds || -1;
    }

    // Generate Fresh Token
    const sessionToken = jwt.sign(
      {
        cid: user.customerId,
        isPro: (user.isPro && !isExpired),
        plan: isExpired ? 'free' : user.plan,
        expiry: user.planExpiry,
        limit: currentLimit,
        uid: user.uid
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({ success: true, sessionToken });

  } catch (e) {
    console.error("Sync Error:", e);
    res.status(500).json({ error: "Sync Failed" });
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
      expiryDate.setDate(now.getDate() + plan.days); // UTC Calculation

      await User.findOneAndUpdate(
        { uid: decoded.uid },
        {
          isPro: (plan.limit === -1),
          plan: decoded.plan,
          planExpiry: expiryDate,
          dailyLimitSeconds: plan.limit // Save Limit in DB
        }
      );
      console.log(`💰 Paid: ${decoded.cid}`);
      res.json({ success: true });
    }
  } catch (e) {
    res.status(500).json({ error: "Capture Failed" });
  }
});

// --- ALIAS ROUTES (For Frontend Compatibility) ---
app.post('/api/create-order', (req, res) => {
  // Redirect logic or minimal wrapper
  // Frontend expects { planId }, Backend 'create-link' makes a JWT link
  // We need to return the same 'url' or adapt.
  // However, the frontend calls 'create-link' logic. Let's fix the mismatch.
  // Frontend: dashboard_controller.js -> callApi('/create-order', ... {planId})

  // We will use the Logic of 'create-link' here but return JSON suitable for an API trigger if needed.
  // For now, let's just Redirect to the existing route handler logic.
  req.url = '/api/payment/create-link';
  app._router.handle(req, res);
});

app.post('/api/capture-order', (req, res) => {
  req.url = '/api/payment/capture';
  app._router.handle(req, res);
});

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server Running on UTC Timezone`);
});

// --- EMAIL NOTIFICATION HELPER (Placeholder) ---
async function sendPlanExpiredEmail(email) {
  console.log(`📧 [Email Mock] Sending 'Plan Expired' email to: ${email}`);
  // Use Nodemailer or SendGrid here
  // Example: await transporter.sendMail({ to: email, subject: "Plan Expired", ... });
}