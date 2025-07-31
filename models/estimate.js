import mongoose from 'mongoose';

const EstimateItemSchema = new mongoose.Schema({
  itemId: { type: String, required: true },
  name: String,
  quantity: Number,
  rate: Number,
  amount: Number
}, { _id: false });

const EstimateSchema = new mongoose.Schema({
  estimateId: { type: String, required: true },
  realmId: { type: String, required: true },
  customerName: String,
  txnDate: String,
  totalAmount: Number,
  txnStatus: {
  type: String,
  enum: ['Pending', 'Accepted', 'Declined', 'Closed'],
  default: 'Pending'
},
  items: [EstimateItemSchema],
  raw: mongoose.Schema.Types.Mixed, // full raw QuickBooks object (optional)
}, { timestamps: true });
EstimateSchema.index({ estimateId: 1, realmId: 1 }, { unique: true });
export default mongoose.model('Estimate', EstimateSchema);
