// models/Counter.js
import mongoose from "mongoose";

const counterSchema = new mongoose.Schema({
  realmId: { type: String, required: true, unique: true },
  seq: { type: Number, default: 0 }
});
counterSchema.index({ realmId: 1 }, { unique: true });

export default mongoose.model("Counter", counterSchema);
