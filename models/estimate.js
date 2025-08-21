import mongoose from 'mongoose';

const EstimateItemSchema = new mongoose.Schema({
  itemId: { type: String, required: true },
  name: String,
  quantity: Number,
  fulfilled: { type: Number, default: 0 },
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

EstimateSchema.set("toJSON", { virtuals: true });
EstimateSchema.set("toObject", { virtuals: true });

EstimateSchema.virtual("packages", {
  ref: "Package",
  localField: "estimateId",
  foreignField: "estimateId",
  justOne: false,
  options: { sort: { createdAt: -1 } },
});

export default mongoose.model('Estimate', EstimateSchema);
