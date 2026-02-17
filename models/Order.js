const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
    orderId: { type: String, required: true, unique: true }, // PayPal Order ID
    uid: { type: String, required: true },                   // User's Firebase UID
    customerId: { type: String, required: true },            // VTM-2026...
    planId: { type: String, required: true },
    amount: { type: String, required: true },
    gateway: { type: String, default: 'PayPal' },
    status: { type: String, default: 'COMPLETED' },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Order', orderSchema);