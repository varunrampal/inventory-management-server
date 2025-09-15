import mongoose from "mongoose";

const QuickBooksConnectionSchema = new mongoose.Schema(
  {
    userId: { type: String, index: true }, // optional: link to your user/org
    realmId: { type: String, unique: true, index: true },
    environment: { type: String, enum: ["sandbox", "production"], default: "sandbox" },

    access_token: String,
    refresh_token: String,
    expires_at: Number, // epoch ms

    companyInfo: mongoose.Schema.Types.Mixed,
  },
  { timestamps: true }
);

export default mongoose.model("QuickBooksConnection", QuickBooksConnectionSchema);
