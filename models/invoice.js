import mongoose from 'mongoose';

const itemLineSchema = new mongoose.Schema({
  name: String,         // e.g., "Widget A"
  itemId: String,       // QuickBooks Item ID
  quantity: Number,     // Quantity sold
  rate: Number,         // Price per unit
  amount: Number        // quantity * rate
}, { _id: false });

const invoiceSchema = new mongoose.Schema({
  invoiceId: { type: String, required: true}, // QuickBooks Invoice ID
  realmId: { type: String, required: true },// Company ID from QuickBooks
  // Additional fields from QuickBooks Invoice
  customerName: String,
  txnDate: Date,
  totalAmount: Number,
  items: [itemLineSchema],
  raw: Object        // Full raw response for reference/debugging
}, { timestamps: true });

invoiceSchema.index({ invoiceId: 1, realmId: 1 }, { unique: true });

export default mongoose.model('Invoice', invoiceSchema);