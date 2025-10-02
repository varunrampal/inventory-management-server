import mongoose from "mongoose";

const plcounterSchema = new mongoose.Schema(
  {
    realmId: { type: String, required: true },
    name:    { type: String, required: true },     // e.g. "pottinglist" | "package"
    year:    { type: Number, default: new Date().getFullYear() },
    seq:     { type: Number, default: 0 },
  },
  { versionKey: false, collection: "counters" }
);

// one unique seq per (realm, name, year)
plcounterSchema.index({ realmId: 1, name: 1, year: 1 }, { unique: true });

export default mongoose.model("PLCounter", plcounterSchema);