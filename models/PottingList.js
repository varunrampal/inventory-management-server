import mongoose from "mongoose";

export const SEASONS = ["Spring", "Summer", "Fall", "Winter"];
export const ITEM_STATUSES = ["Pending", "In Progress", "Completed"];
export const LIST_STATUSES = ["Pending", "In Progress", "Completed"];

const PottingItemSchema = new mongoose.Schema(
  { name: { type: String, required: true, trim: true },
    size: { type: String, trim: true, default: "" },
    quantity: { type: Number, min: 0, default: 0 },
    status: { type: String, enum: ITEM_STATUSES, default: "Pending" },
  },
  { _id: false }
);

const PottingListSchema = new mongoose.Schema(
  {
    realmId: { type: String, index: true },
    code: { type: String, index: true, required: true, trim: true },
    estimateId: { type: String, index: true },
    docNumber: { type: String, index: true, default: "" },
    reference: { type: String, trim: true, index: true, default: "" },
    customerName: { type: String, required: true, trim: true },
    year: { type: Number, required: true, min: 2000, max: 2100 },
    season: { type: String, enum: SEASONS, required: true },
    status: { type: String, enum: LIST_STATUSES, default: "Pending", index: true },
    items: { type: [PottingItemSchema], validate: v => Array.isArray(v) && v.length > 0 },
  },
  { timestamps: true, collection: "pottinglists" }
);

// One per (realm, year, season, estimateId) when estimateId exists
PottingListSchema.index(
  { realmId: 1, year: 1, season: 1, estimateId: 1 },
  { unique: true, partialFilterExpression: { estimateId: { $exists: true, $ne: null } } }
);

// One per (realm, year, season, docNumber) when docNumber exists
PottingListSchema.index(
  { realmId: 1, year: 1, season: 1, docNumber: 1 },
  { unique: true, partialFilterExpression: { docNumber: { $exists: true, $ne: null } } }
);

// One per (realm, year, season, reference) when reference exists
PottingListSchema.index(
  { realmId: 1, year: 1, season: 1, reference: 1 },
  { unique: true, partialFilterExpression: { reference: { $exists: true, $ne: "" } } }
);

// Always keep human code unique per realm
PottingListSchema.index({ realmId: 1, code: 1 }, { unique: true });

PottingListSchema.index({ realmId: 1, year: 1, season: 1 });
PottingListSchema.index({ realmId: 1, customerName: 1 });
PottingListSchema.index({ realmId: 1, "items.size": 1 }); // for group-by size

export const PottingList = mongoose.model("PottingList", PottingListSchema);
// (optional) also export default if you like
export default PottingList;
