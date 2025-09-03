// models/Counter.js
import mongoose from "mongoose";

const counterSchema = new mongoose.Schema({
  realmId: { type: String, required: true, unique: true },
  seq: { type: Number, default: 0 }
});

export default mongoose.model("Counter", counterSchema);
