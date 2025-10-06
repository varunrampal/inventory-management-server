import mongoose from "mongoose";

const timesheetEntrySchema = new mongoose.Schema(
{
realmId: { type: String, index: true },
employeeId: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true, index: true },
date: { type: Date, required: true, index: true },
hours: { type: Number, required: true, min: 0, max: 24 },
note: { type: String },
},
{ timestamps: true, versionKey: false }
);


// Prevent duplicates per employee per date
timesheetEntrySchema.index({ realmId: 1, employeeId: 1, date: 1 }, { unique: true, sparse: true });


export default mongoose.model("TimesheetEntry", timesheetEntrySchema);