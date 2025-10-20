// models/CashEntry.js
import mongoose from "mongoose";

const CashEntrySchema = new mongoose.Schema(
  {
    realmId: { type: String, required: true },            // 🔑 multi-tenant
    type: { type: String, enum: ["in", "out"], required: true },
    amount: { type: Number, required: true, min: 0 },
    note: { type: String, default: "" },
    date: { type: Date, default: () => new Date() },
    category: { type: String, default: "" },
    paymentMethod: { type: String, default: "cash" },
  },
  { timestamps: true, versionKey: false, collection: "cash_entries" }
);

// helpful indexes
CashEntrySchema.index({ realmId: 1, date: 1 });
CashEntrySchema.index({ realmId: 1, type: 1, date: 1 });

export default mongoose.model("CashEntry", CashEntrySchema);
