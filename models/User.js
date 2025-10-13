import mongoose from "mongoose";


const userSchema = new mongoose.Schema(
{
realmId: { type: String, index: true },
name: { type: String, required: true },
email: { type: String, required: true, unique: true },
passwordHash: { type: String, required: true },
roles: {
type: [String],
enum: ["admin", "supervisor", "employee"],
default: ["employee"],
index: true,
},
employeeId: { type: mongoose.Schema.Types.ObjectId, ref: "Employee" }, // optional link
isActive: { type: Boolean, default: true },
},
{ timestamps: true, versionKey: false }
);


export default mongoose.model("User", userSchema);