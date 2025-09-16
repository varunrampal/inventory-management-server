// models/Package.js
import mongoose from 'mongoose';
import Counter from './counter.js';

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

  // 🔧 remove global unique
  packageCode: { type: String }, 

  quantities: { type: Map, of: Number, default: {} },

  totals: {
    lines: { type: Number, default: 0 },
    amount: { type: Number, default: 0 }
  },
  snapshot: {
    customerName: String,
    txnDate: Date,
    totalAmount: Number,
    billTo: mongoose.Schema.Types.Mixed,
    shipTo: mongoose.Schema.Types.Mixed
  },
  status: {
    type: String,
    enum: ['Created', 'Shipped', 'Delivered', 'Cancelled'],
    default: 'Created'
  }
}, { timestamps: true });

// Indexes
pkgSchema.index({ realmId: 1, packageDate: -1 });
pkgSchema.index({ realmId: 1, shipmentDate: -1 });
pkgSchema.index({ realmId: 1, 'snapshot.customerName': 1 });
pkgSchema.index({ realmId: 1, estimateId: 1 });

// ✅ Make codes unique per realm
pkgSchema.index({ realmId: 1, packageCode: 1 }, { unique: true, name: 'realm_packageCode_unique' });

// Stronger code allocator (works for save and can be reused elsewhere)
async function allocatePackageCode(realmId) {
  const counter = await Counter.findOneAndUpdate(
    { realmId },
    { $setOnInsert: { seq: 0 }, $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  const padded = String(counter.seq).padStart(4, '0');
  return `PKG-${padded}`;
}

// pre('save') for single inserts/updates
pkgSchema.pre('save', async function(next) {
  if (this.packageCode) return next();
  try {
    this.packageCode = await allocatePackageCode(this.realmId);
    next();
  } catch (err) {
    if (err?.code === 11000) { // race or old index collision
      try {
        this.packageCode = await allocatePackageCode(this.realmId);
        return next();
      } catch (e2) {
        return next(e2);
      }
    }
    next(err);
  }
});

// ⚠️ insertMany does NOT run pre('save'). Cover it:
pkgSchema.pre('insertMany', async function(next, docs) {
  try {
    // Assign codes only where missing
    for (const d of docs) {
      if (!d.packageCode) {
        d.packageCode = await allocatePackageCode(d.realmId);
      }
    }
    next();
  } catch (err) {
    next(err);
  }
});
