// import mongoose from 'mongoose';

// const ItemSchema = new mongoose.Schema({
//   itemId: { type: String, required: true }, // QuickBooks item ID
//   name: { type: String, required: true },
//   realmId: { type: String, required: true },
//   sku: { type: String },
//   description: { type: String },
//   quantity: { type: Number, default: 0 },
//   unitPrice: { type: Number, default: 0 },
//   type: { type: String, enum: ['Inventory', 'Service', 'NonInventory'], default: 'Inventory' },
//   location: { type: String },
//   active: { type: Boolean, default: true },
//   realmId: { type: String }, // For multi-tenant or multi-account setups
//   raw: mongoose.Schema.Types.Mixed // original QuickBooks item payload
// }, { timestamps: true });
// ItemSchema.index({ itemId: 1, realmId: 1 }, { unique: true });
// export default mongoose.model('Item', ItemSchema);

import mongoose from "mongoose";

const ItemSchema = new mongoose.Schema({
  itemId:      { type: String, required: true },            // QBO Item.Id
  realmId:     { type: String, required: true },            // tenant
  name:        { type: String, required: true },
  sku:         { type: String, default: "" },
  description: { type: String, default: "" },
  quantity:    { type: Number, default: 0 },                // QtyOnHand (Inventory)
  unitPrice:   { type: Number, default: 0 },                // Sales price
  type:        { type: String, enum: ['Inventory','Service','NonInventory','Category','Group'], default: 'Inventory' },
  location:    { type: String, default: "" },               // your own field (not from QBO)
  active:      { type: Boolean, default: true },
  raw:         mongoose.Schema.Types.Mixed                  // full QBO payload
}, { timestamps: true });

// Uniqueness per tenant
ItemSchema.index({ itemId: 1, realmId: 1 }, { unique: true });

// Helpful lookups/search
ItemSchema.index({ realmId: 1, name: 1 });
ItemSchema.index({ realmId: 1, sku: 1 });
// Optional: lightweight text search across fields (only one text index allowed)
// ItemSchema.index({ name: "text", sku: "text", description: "text" });

export default mongoose.model('Item', ItemSchema);
