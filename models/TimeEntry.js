import mongoose from "mongoose";

const TimeEntrySchema = new mongoose.Schema(
  {
    realmId: { type: String, required: true, index: true },

    // Employee reference (string id from your People/Employees collection or Quick add)
    employeeId: { type: String, required: true, index: true },
    employeeName: { type: String, required: true }, // denormalized for fast display

    // One of the following two patterns is enough; keep both if you already have them
    date: { type: Date, required: true, index: true }, // the work day (UTC)
    hours: { type: Number, required: true, min: 0 },   // decimal hours for that day

    // (Optional) workflow flags
    approved: { type: Boolean, default: true }, // set false if you want a review step
    notes: { type: String },
  },
  { timestamps: true, collection: "time_entries" }
);

// Helpful compound index for period aggregations
TimeEntrySchema.index({ realmId: 1, date: 1, employeeId: 1 });

export default mongoose.model("TimeEntry", TimeEntrySchema);
