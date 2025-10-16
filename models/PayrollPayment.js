import mongoose from "mongoose";

/**
 * Stores what was paid (or marked as paid) per employee per payroll period.
 * periodId must match the front-end select value (e.g. "2025-09-29_2025-10-12").
 */
const PayrollPaymentSchema = new mongoose.Schema(
  {
    realmId: { type: String, required: true, index: true },
    periodId: { type: String, required: true, index: true },

    employeeId: { type: String, required: true, index: true },
    hoursPaid: { type: Number, default: 0 },
    notes: { type: String, default: "" },

    // (Optional) audit
    updatedBy: { type: String }, // user id/email
  },
  { timestamps: true, collection: "payroll_payments" }
);

// 1 doc per (realmId, periodId, employeeId)
PayrollPaymentSchema.index({ realmId: 1, periodId: 1, employeeId: 1 }, { unique: true });

export default mongoose.model("PayrollPayment", PayrollPaymentSchema);
