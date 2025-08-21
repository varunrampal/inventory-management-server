// models/Package.js
import mongoose from 'mongoose';

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

  // 🔹 NEW FIELDS
  packageDate: { type: Date, required: true },      // e.g., today by default
  shipmentDate: { type: Date },                     // when it ships/leaves
  driverName: { type: String },                     // who’s delivering
  packageCode: { type: String, unique: true },      // human-friendly ID

  totals: {
    lines: { type: Number, default: 0 },
    amount: { type: Number, default: 0 }
  },
  snapshot: {
    customerName: String,
    txnDate: Date
  },
  status: { type: String, default: 'Created' }
}, { timestamps: true });

// Simple generator: PKG-YYYYMMDD-XXXXXX
function generatePackageCode() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `PKG-${y}${m}${day}-${rand}`;
}

pkgSchema.pre('save', async function (next) {
  if (this.packageCode) return next();

  let code, exists;
  for (let i = 0; i < 10; i++) {
    const num = Math.floor(1000 + Math.random() * 9000); // 1000–9999
    code = `PKG-${num}`;
    exists = await this.constructor.findOne({ packageCode: code }).lean();
    if (!exists) {
      this.packageCode = code;
      break;
    }
  }

  if (!this.packageCode) {
    return next(new Error('Failed to generate unique package code'));
  }

  next();
});


// pkgSchema.pre('save', async function (next) {
//   if (!this.packageCode) {
//     // Try until unique (very low collision chance, but safe loop)
//     for (let i = 0; i < 5; i++) {
//       const code = generatePackageCode();
//       const exists = await this.constructor.findOne({ packageCode: code }).lean();
//       if (!exists) {
//         this.packageCode = code;
//         break;
//       }
//     }
//   }
//   next();
// });

export default mongoose.model('Package', pkgSchema);
