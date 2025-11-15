// models/DriverLocationHistory.js
import mongoose from "mongoose";

const driverLocationHistorySchema = new mongoose.Schema({
  driverId: { type: String, required: true, index: true },
  lat: { type: Number, required: true },
  lng: { type: Number, required: true },
  timestamp: { type: Date, default: Date.now, index: true },
});

// Helpful index: query by driver + time range
driverLocationHistorySchema.index({ driverId: 1, timestamp: 1 });

export const DriverLocationHistory = mongoose.model(
  "DriverLocationHistory",
  driverLocationHistorySchema
);
