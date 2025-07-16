import mongoose from 'mongoose';

const ItemSchema = new mongoose.Schema({
  itemId: { type: String, required: true, unique: true }, // QuickBooks item ID
  name: { type: String, required: true },
  sku: { type: String },
  description: { type: String },
  quantity: { type: Number, default: 0 },
  unitPrice: { type: Number, default: 0 },
  type: { type: String, enum: ['Inventory', 'Service', 'NonInventory'], default: 'Inventory' },
  location: { type: String },
  active: { type: Boolean, default: true },
  realmId: { type: String }, // For multi-tenant or multi-account setups
  raw: mongoose.Schema.Types.Mixed // original QuickBooks item payload
}, { timestamps: true });

export default mongoose.model('Item', ItemSchema);
