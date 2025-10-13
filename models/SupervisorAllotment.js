import mongoose from "mongoose";


const allotmentSchema = new mongoose.Schema(
{
realmId: { type: String, index: true },
supervisorUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
employeeId: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true, index: true },
},
{ timestamps: true, versionKey: false }
);


allotmentSchema.index({ realmId: 1, supervisorUserId: 1, employeeId: 1 }, { unique: true });


export default mongoose.model("SupervisorAllotment", allotmentSchema);