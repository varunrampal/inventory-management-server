import mongoose from 'mongoose';

const itemLineSchema = new mongoose.Schema({
  name: String,         // e.g., "Widget A"
  itemId: String,       // QuickBooks Item ID
  quantity: Number,     // Quantity sold
  rate: Number,         // Price per unit
  amount: Number        // quantity * rate
}, { _id: false });

const invoiceSchema = new mongoose.Schema({
  invoiceId: { type: String, required: true, unique: true }, // QuickBooks Invoice ID
  customerName: String,
  txnDate: Date,
  totalAmount: Number,
  realmId: String,   // Company ID
  items: [itemLineSchema],
  raw: Object        // Full raw response for reference/debugging
}, { timestamps: true });

export default mongoose.model('Invoice', invoiceSchema);