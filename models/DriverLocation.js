// models/DriverLocation.js
import mongoose from "mongoose";

const driverLocationSchema = new mongoose.Schema({
  driverId: { type: String, required: true, index: true },
  lat: { type: Number, required: true },
  lng: { type: Number, required: true },
  updatedAt: { type: Date, default: Date.now },
});

driverLocationSchema.index({ driverId: 1 }, { unique: true });

export const DriverLocation = mongoose.model("DriverLocation", driverLocationSchema);
