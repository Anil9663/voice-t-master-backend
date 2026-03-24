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
const Order = require('./models/Order'); // 🔥 [NEW] Order Model जोड़ें

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
  // --- 🌟 MAIN PRO PLANS ---
  "pro_monthly": { price: "5.99", days: 30, limit: -1, name: "Monthly Pro" },
  "pro_3months": { price: "14.99", days: 90, limit: -1, name: "3 Months Pro" },
  "pro_6months": { price: "23.99", days: 180, limit: -1, name: "6 Months Pro" },
  "pro_yearly": { price: "35.99", days: 365, limit: -1, name: "Yearly Saver" },
  "lifetime_pro": { price: "199.99", days: 36500, limit: -1, name: "Lifetime Access" },

  // --- ⏱️ DAILY USAGE PLANS (Limits in seconds) ---
  "daily_2hr": { price: "2.99", days: 30, limit: 7200, name: "Starter Flex (2 Hrs)" },
  "daily_2_5hr": { price: "3.49", days: 30, limit: 9000, name: "Student Smart (2.5 Hrs)" },
  "daily_3hr": { price: "3.99", days: 30, limit: 10800, name: "Study Plus (3 Hrs)" },
  "daily_3_5hr": { price: "4.49", days: 30, limit: 12600, name: "Writer Flow (3.5 Hrs)" },
  "daily_4hr": { price: "4.99", days: 30, limit: 14400, name: "Creator Pro (4 Hrs)" },

  // --- 🎫 PRO ACCESS PASSES ---
  "pass_1day": { price: "2.99", days: 1, limit: -1, name: "1 Day Pro Pass" },
  "pass_3day": { price: "3.99", days: 3, limit: -1, name: "3 Day Pro Pass" },
  "pass_7day": { price: "4.99", days: 7, limit: -1, name: "7 Day Pro Pass" }
};

// --- 🛡️ VALIDATION CONSTANTS ---
// Allowed Countries (Whitelist)
const ALLOWED_COUNTRIES = [
  "India", "United States", "United Kingdom", "Canada", "Australia",
  "Germany", "France", "Japan", "China", "Brazil", "Unknown" // Fallback
];

// Allowed Languages (Whitelist)
// Allowed Languages (Whitelist) - Synced with Frontend (languages.js)
const ALLOWED_LANGUAGES = [
  "af-ZA", "sq-AL", "am-ET", "ar-DZ", "ar-BH", "ar-EG", "ar-IQ", "ar-IL", "ar-JO", "ar-KW", "ar-LB", "ar-MA", "ar-OM", "ar-QA", "ar-SA", "ar-PS", "ar-TN", "ar-AE", "ar-YE", "hy-AM", "az-AZ", "eu-ES", "bn-IN", "bs-BA", "bg-BG", "my-MM", "ca-ES", "hr-HR", "cs-CZ", "da-DK", "nl-BE", "nl-NL", "en-AU", "en-CA", "en-GH", "en-HK", "en-IN", "en-IE", "en-KE", "en-NZ", "en-NG", "en-PH", "en-SG", "en-ZA", "en-TZ", "en-GB", "en-US", "et-EE", "fil-PH", "fi-FI", "fr-BE", "fr-CA", "fr-FR", "fr-CH", "gl-ES", "ka-GE", "de-AT", "de-DE", "de-CH", "el-GR", "gu-IN", "hi-IN", "hu-HU", "is-IS", "id-ID", "it-IT", "it-CH", "ja-JP", "jv-ID", "kn-IN", "km-KH", "ko-KR", "lo-LA", "lv-LV", "lt-LT", "mk-MK", "ms-MY", "ml-IN", "mr-IN", "mn-MN", "ne-NP", "fa-IR", "pl-PL", "pt-BR", "pt-PT", "ro-RO", "ru-RU", "sr-RS", "si-LK", "sk-SK", "sl-SI", "es-AR", "es-BO", "es-CL", "es-CO", "es-CR", "es-DO", "es-EC", "es-SV", "es-GT", "es-HN", "es-MX", "es-NI", "es-PA", "es-PY", "es-PE", "es-PR", "es-ES", "es-US", "es-UY", "es-VE", "sw-KE", "sw-TZ", "sv-SE", "ta-IN", "te-IN", "th-TH", "tr-TR", "uk-UA", "uz-UZ", "vi-VN", "zu-ZA", "bn-BD", "yue-Hant-HK", "en-PK", "iw-IL", "cmn-Hans-CN", "cmn-Hant-TW", "no-NO", "pa-Guru-IN", "su-ID", "ta-MY", "ta-SG", "ta-LK", "ur-IN", "ur-PK", "ar-LY", "ar-SY", "zh-HK", "zh-CN", "zh-TW", "he-IL", "ga-IE", "kk-KZ", "mt-MT", "nb-NO", "ps-AF", "so-SO", "es-CU", "es-GQ", "cy-GB", "Unknown"
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
// Format: VTM-202602101001
async function generateCustomerId() {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');

  const dateStr = `${year}${month}${day}`; // 20260210

  // Counter Update
  // $inc के साथ upsert करने पर यह 0 से 1 हो जाता है, 
  // इसलिए हम चेक करेंगे कि क्या यह 1000 से कम है
  const counter = await Counter.findByIdAndUpdate(
    { _id: 'customerId' },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );

  // 🔥 [FIX] अगर काउंटिंग 1000 से कम है (जैसे 1), तो इसे फोर्स करके 1001 कर दें
  let sequence = counter.seq;
  if (sequence < 1000) {
    // डेटाबेस में अपडेट करें ताकि अगली बार 1002 आए
    await Counter.findByIdAndUpdate({ _id: 'customerId' }, { seq: 1001 });
    sequence = 1001;
  }

  // 🔥 [FIX] हाइफन हटा दिया गया है: VTM-YYYYMMDDSequence
  return `VTM-${dateStr}${sequence}`;
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

        // 🔥 [FIX] Default Values Explicitly Set
        plan: 'free',
        isPro: false,
        walletBalance: 0,
        dailyLimitSeconds: 5400, // 90 Mins
        planExpiry: null, // Null for free users

        analytics: {
          country: country || 'Unknown',
          inputLanguage: language || 'en-US',
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
      
      // 🔥 [FIX] अगर डेटा आया है, तभी अपडेट करें (पुराना डेटा डिलीट होने से बचाएं)
      if (country !== undefined) user.analytics.country = country;
      if (language !== undefined) user.analytics.inputLanguage = language;

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
      console.log(`⚠️ [Login] Plan Expired for ${user.customerId}. Resetting DB to Free.`);
      
      // 🔥 डेटाबेस में डिफॉल्ट वैल्यू सेट करें
      await User.findOneAndUpdate(
        { uid: user.uid },
        {
          isPro: false,
          plan: 'free',
          dailyLimitSeconds: 5400
        }
      );
      
      user.isPro = false;
      user.plan = 'free';
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
        isPro: (user.isPro && !isExpired),
        plan: isExpired ? 'free' : user.plan,
        expiry: user.planExpiry,
        limit: currentLimit,
        uid: user.uid,
        name: user.name,
        email: user.email,
        photo: decodedToken.picture // 🔥 [NEW] Google से आने वाली प्रोफाइल फोटो
      },
      JWT_SECRET,
      { expiresIn: '24h' } // Short Lived (Security)
    );

    res.json({ 
        success: true, 
        sessionToken,
        analytics: user.analytics // 🔥 [NEW] UI में भरने के लिए MongoDB से पुराना डेटा भेजें
    });

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
      console.log(`⚠️ [Sync] Plan Expired for ${user.customerId}. Resetting DB to Free.`);
      
      // 🔥 डेटाबेस में तुरंत डिफॉल्ट वैल्यू सेट करें
      await User.findOneAndUpdate(
        { uid: user.uid },
        {
          isPro: false,
          plan: 'free',
          dailyLimitSeconds: 5400
        }
      );
      
      user.isPro = false;
      user.plan = 'free';
      currentLimit = 5400;
    } else if (user.isPro && !isExpired) {
      currentLimit = user.dailyLimitSeconds || -1;
    }

    // Generate Fresh Token
    // D. GENERATE SIGNED SESSION TOKEN
    const sessionToken = jwt.sign(
      {
        cid: user.customerId,
        isPro: (user.isPro && !isExpired),
        plan: isExpired ? 'free' : user.plan,
        expiry: user.planExpiry,
        limit: currentLimit,
        uid: user.uid,
        name: user.name,
        email: user.email,
        photo: decodedToken.picture // 🔥 [NEW] Google से आने वाली प्रोफाइल फोटो
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    // 🔥 [FIX: Send analytics back to frontend]
    res.json({ 
        success: true, 
        sessionToken: sessionToken,
        analytics: user.analytics || {} // <-- यह लाइन गायब थी!
    });

  } catch (e) {
    console.error("Sync Error:", e);
    res.status(500).json({ error: "Sync Failed" });
  }
});



    // 1.2 SILENT BACKGROUND SYNC (For Extension Background Script)
    app.get('/api/refresh-session', verifySession, async (req, res) => {
      try {
        const user = await User.findOne({ uid: req.user.uid });
        if (!user) return res.status(404).json({ error: "User not found" });

        const now = new Date();
        const expiry = user.planExpiry ? new Date(user.planExpiry) : null;
        let isExpired = false;
        let currentLimit = 5400;

        if (user.isPro && expiry && now > expiry) {
          isExpired = true;
          console.log(`⚠️ [Refresh] Plan Expired for ${user.customerId}. Resetting DB to Free.`);
          
          // 🔥 डेटाबेस में तुरंत डिफॉल्ट वैल्यू सेट करें
          await User.findOneAndUpdate(
            { uid: user.uid },
            {
              isPro: false,
              plan: 'free',
              dailyLimitSeconds: 5400
            }
          );
          
          // टोकन के लिए लोकल वेरिएबल भी अपडेट कर दें
          user.isPro = false;
          user.plan = 'free';
          currentLimit = 5400;
        } else if (user.isPro && !isExpired) {
          currentLimit = user.dailyLimitSeconds || -1;
        }

        const sessionToken = jwt.sign(
          {
            cid: user.customerId,
            isPro: (user.isPro && !isExpired),
            plan: isExpired ? 'free' : user.plan,
            expiry: user.planExpiry,
            limit: currentLimit,
            uid: user.uid,
            name: user.name,
            email: user.email,
            photo: req.user.photo
          },
          JWT_SECRET,
          { expiresIn: '24h' }
        );

        res.json({ 
          success: true, 
          sessionToken, 
          isPro: (user.isPro && !isExpired), 
          plan: user.plan, 
          limit: currentLimit,
          expiry: user.planExpiry
        });

      } catch (e) {
        console.error("Refresh Error:", e);
        res.status(500).json({ error: "Refresh Failed" });
      }
    });




    // 1.3 GET USER ORDER HISTORY (Last 1 Year Only - Lazy Loading)
    app.get('/api/my-orders', verifySession, async (req, res) => {
      try {
        const cid = req.user.cid; // सिक्योर टोकन से Customer ID निकाली
        if (!cid) return res.status(400).json({ error: "Customer ID missing" });

        // ठीक 1 साल पहले की तारीख निकालें
        const oneYearAgo = new Date();
        oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

        // डेटाबेस से ढूँढें: सिर्फ इस CID के ऑर्डर जो 1 साल के अंदर हों (सबसे नए पहले)
        const orders = await Order.find({ 
            customerId: cid, 
            createdAt: { $gte: oneYearAgo } 
        }).sort({ createdAt: -1 });

        res.json({ success: true, orders: orders });
      } catch (e) {
        console.error("Order Fetch Error:", e);
        res.status(500).json({ error: "Failed to fetch history" });
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

// 5. CAPTURE ORDER (JWT Flow)
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

// --- NEW ROUTES FOR WEB PAYMENT (UID Based) ---

// 6. PayPal Config (For Frontend)
app.get('/api/config/paypal', (req, res) => {
  res.json({ clientId: process.env.PAYPAL_CLIENT_ID });
});

// 7. Create Order (Web/UID)
app.post('/api/create-order-web', async (req, res) => {
  const { planId, uid } = req.body;
  const plan = PLANS[planId];
  if (!plan) return res.status(400).json({ error: "Invalid Plan" });

  const request = new paypal.orders.OrdersCreateRequest();
  request.prefer("return=representation");
  request.requestBody({
    intent: 'CAPTURE',
    purchase_units: [{
      amount: {
        currency_code: 'USD',
        value: plan.price
      },
      description: plan.name
    }]
  });

  try {
    const order = await client.execute(request);
    res.json({ orderID: order.result.id });
  } catch (e) {
    console.error("PayPal Create Error:", e);
    res.status(500).json({ error: "Order Creation Failed" });
  }
});

// 8. Capture Order (Web/UID)
app.post('/api/capture-order-web', async (req, res) => {
  const { orderID, planId, uid, cid } = req.body; // 🔥 [NEW] Frontend से cid भी लेंगे
  const plan = PLANS[planId];

  if (!plan) return res.status(400).json({ error: "Invalid Plan" });

  const request = new paypal.orders.OrdersCaptureRequest(orderID);
  request.requestBody({});

  try {
    const capture = await client.execute(request);

    if (capture.result.status === 'COMPLETED') {
      const now = new Date();
      const expiryDate = new Date();
      expiryDate.setDate(now.getDate() + plan.days);

      // 1. User को Pro बनाएँ (Direct Update via Customer ID)
      await User.findOneAndUpdate(
        { customerId: cid }, // 🔥 [FIXED] अब हम अपनी Customer ID से यूज़र को ढूँढेंगे!
        {
          isPro: (plan.limit === -1),
          plan: planId,
          planExpiry: expiryDate, // UTC
          dailyLimitSeconds: plan.limit
        }
      );

      // 2. 🔥 [NEW] नया Order डेटाबेस में सेव करें
      const newOrder = new Order({
        orderId: orderID,
        uid: uid,
        customerId: cid || "Unknown",
        planId: planId,
        amount: plan.price,
        gateway: 'PayPal',
        status: 'COMPLETED'
      });
      await newOrder.save();

      console.log(`✅ 💰 Payment Success: ${cid} bought ${planId}`);
      res.json({ success: true });
    } else {
      res.status(400).json({ error: "Payment not completed on PayPal end." });
    }
  } catch (e) {
    console.error("❌ PayPal Capture Error:", e);
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







// =========================================================
// 🚀 NEW SECURE CHECKOUT FLOW (For Standalone Website)
// =========================================================

// 1. Generate Secure Checkout Link (एक्सटेंशन इसे कॉल करेगा)
app.post('/api/payment/create-checkout-link', verifySession, async (req, res) => {
  const { planId } = req.body;

  if (!PLANS[planId]) return res.status(400).json({ error: "Invalid Plan" });

  // A. 15 मिनट वाला सुरक्षित टोकन बनाएँ
  const checkoutToken = jwt.sign(
    {
      cid: req.user.cid,
      uid: req.user.uid,
      plan: planId
    },
    JWT_SECRET,
    { expiresIn: '15m' } // 🔥 सिर्फ 15 मिनट के लिए वैलिड
  );

  // B. आपकी नई वेबसाइट का URL 
  // (जब तक GitHub पर लाइव नहीं करते, तब तक आप यहाँ अपनी लोकल कंप्यूटर वाली index.html का पाथ डाल सकते हैं)
  const WEBSITE_URL = "https://anil9663.github.io/VoiceTMaster/"; // <-- बाद में इसे अपने असली गिटहब लिंक से बदलें
  // लोकल टेस्टिंग के लिए आप इसे ऐसे भी रख सकते हैं: "http://127.0.0.1:5500/index.html"

  // C. पूरा URL बनाकर एक्सटेंशन को भेजें
  const redirectUrl = `${WEBSITE_URL}?token=${checkoutToken}`;

  console.log(`🔗 Generated Checkout Link for: ${req.user.cid} -> ${planId}`);
  res.json({ url: redirectUrl });
});

// 2. Verify Checkout Token (नई वेबसाइट इसे कॉल करेगी)
app.post('/api/payment/verify-checkout-token', async (req, res) => {
  const { token } = req.body;

  try {
    // टोकन को डिकोड करें
    const decoded = jwt.verify(token, JWT_SECRET);

    // डेटाबेस से ताज़ा जानकारी निकालें (ताकि वेबसाइट पर नाम/फोटो सही दिखे)
    const user = await User.findOne({ uid: decoded.uid });
    if (!user) return res.status(404).json({ valid: false, error: "User not found" });

    const plan = PLANS[decoded.plan];

    // सब सही है, वेबसाइट को यूजर का डेटा भेजें
    res.json({
      valid: true,
      uid: user.uid,
      customerId: user.customerId,
      name: user.name,
      email: user.email,
      planId: decoded.plan,
      planName: plan.name,
      price: plan.price
    });
  } catch (e) {
    console.error("❌ Checkout Token Expired or Invalid");
    res.status(400).json({ valid: false, error: "Link Expired. Please try again." });
  }
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