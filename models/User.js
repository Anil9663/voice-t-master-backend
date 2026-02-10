const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    // 1. Identity
    uid: { type: String, required: true, unique: true }, // Firebase UID
    customerId: { type: String, unique: true }, // VTM-202602101001
    email: String,
    name: String,

    // 2. Business Logic
    walletBalance: { type: Number, default: 0 },
    isPro: { type: Boolean, default: false },
    plan: { type: String, default: 'free' },

    // 🔥 [FIX] Daily Limit Added (Default 90 Mins = 5400 Seconds)
    dailyLimitSeconds: { type: Number, default: 5400 },

    // 3. Dates (Always in UTC)
    // 🔥 [FIX] Plan Expiry Default null
    planExpiry: { type: Date, default: null },

    createdAt: { type: Date, default: Date.now },
    lastLogin: { type: Date, default: Date.now },

    // 4. Analytics & Survey
    analytics: {
        country: { type: String },
        inputLanguage: { type: String },

        survey: {
            profession: { type: String, default: 'Unknown' },
            useCase: { type: String, default: 'Unknown' },
            source: { type: String, default: 'Unknown' }
        }
    }
});

module.exports = mongoose.model('User', userSchema);