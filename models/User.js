const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    // 1. Identity
    uid: { type: String, required: true, unique: true }, // Firebase UID (Internal)
    customerId: { type: String, unique: true }, // Public ID (VTM-202601301000)
    email: String,
    name: String,

    // 2. Business Logic
    walletBalance: { type: Number, default: 0 }, // Refer & Earn Balance
    isPro: { type: Boolean, default: false },
    plan: { type: String, default: 'free' },

    // 3. Dates (Always in UTC)
    planExpiry: { type: Date },
    createdAt: { type: Date, default: Date.now },
    lastLogin: { type: Date, default: Date.now },

    // 4. Analytics & Survey (Overridable)
    // यह डेटा यूजर की सेटिंग सिंक नहीं करता, बस हमारे रिकॉर्ड के लिए है
    analytics: {
        country: { type: String, required: true }, // "India"
        inputLanguage: { type: String },           // "hi-IN"

        // 🔥 New Survey Data
        survey: {
            profession: { type: String, default: 'Unknown' }, // e.g. "developer"
            useCase: { type: String, default: 'Unknown' },    // e.g. "coding"
            source: { type: String, default: 'Unknown' }      // e.g. "youtube"
        }
    }
});

module.exports = mongoose.model('User', userSchema);