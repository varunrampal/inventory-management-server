// models/Package.js
import mongoose from 'mongoose';
import Counter from "./counter.js";

const packageLineSchema = new mongoose.Schema({
  itemId: { type: String, required: true },
  name: String,
  quantity: { type: Number, required: true, min: 0 },
  rate: Number,
  amount: Number
}, { _id: false });

const pkgSchema = new mongoose.Schema({
  estimateId: { type: String, index: true, required: true },
  realmId: { type: String, index: true, required: true },
  lines: { type: [packageLineSchema], default: [] },
  notes: String,

  packageDate: { type: Date, required: true, default: Date.now },
  shipmentDate: { type: Date },
  driverName: { type: String },
  packageCode: { type: String, unique: true },
  quantities: { type: Map, of: Number, default: {} },

  totals: {
    lines: { type: Number, default: 0 },
    amount: { type: Number, default: 0 }
  },
  snapshot: {
    customerName: String,
    txnDate: Date,
    totalAmount: Number,
    billTo: mongoose.Schema.Types.Mixed, // store as object or string
    shipTo: mongoose.Schema.Types.Mixed
  },
  status: {
    type: String,
    enum: ["Created", "Shipped", "Delivered", "Cancelled"],
    default: "Created"
  }
}, { timestamps: true });


// Indexes
pkgSchema.index({ realmId: 1, packageDate: -1 });
pkgSchema.index({ realmId: 1, shipmentDate: -1 });
pkgSchema.index({ realmId: 1, "snapshot.customerName": 1 });
pkgSchema.index({ realmId: 1, estimateId: 1 });

// Hooks
pkgSchema.pre("save", async function (next) {
  if (this.packageCode) return next(); // already set

  try {
    // Find & increment counter atomically per realm
    const counter = await Counter.findOneAndUpdate(
      { realmId: this.realmId },
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );

    const padded = String(counter.seq).padStart(4, "0"); // "0001"
    this.packageCode = `PKG-${padded}`;
    next();
  } catch (err) {
    next(err);
  }
});


export default mongoose.model('Package', pkgSchema);
