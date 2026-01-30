const mongoose = require('mongoose');

const counterSchema = new mongoose.Schema({
    _id: { type: String, required: true }, // हम इसे 'customerId' नाम देंगे
    seq: { type: Number, default: 1000 }   // 1000 से गिनती शुरू होगी
});

module.exports = mongoose.model('Counter', counterSchema);