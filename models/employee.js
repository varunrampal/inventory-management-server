import mongoose from "mongoose";


const employeeSchema = new mongoose.Schema(
{
realmId: { type: String, index: true }, // optional multi-tenant
name: { type: String, required: true },
phone: { type: String },
cashHourlyRate: { type: Number, default: 0 },
currency: { type: String, default: "CAD" },
isActive: { type: Boolean, default: true },
},
{ timestamps: true, versionKey: false }
);


employeeSchema.index({ realmId: 1, name: 1 }, { unique: true, sparse: true });


export default mongoose.model("Employee", employeeSchema);