// models/PaymentEntry.js
import mongoose from "mongoose";

const PaymentEntrySchema = new mongoose.Schema(
  {
    
    companyId: {
      type: String,   // e.g. "peels", "greenflow", "a11"
      required: true,
      index: true,
    },
    companyName: {
      type: String,   // optional display label
      trim: true,
    },
    paymentDate: {
      type: Date,
      required: true,
    },
    customerName: {
      type: String,
      required: true,
      trim: true,
    },
    invoiceNumber: {
      type: String,
      trim: true,
    },
    paymentType: {
      type: String,
      enum: ["cash", "etransfer"],
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },

    // Optional fields for your own tracking
    receivedBy: {
      type: String,
      trim: true,
    },
    bankAccount: {
      type: String,
      trim: true,
    },
    bankReceivedDate: {
      type: Date,
    },
    bankReference: {
      type: String,
      trim: true,
    },
    depositSlipNumber: {
      type: String,
      trim: true,
    },
    postedInAccounting: {
      type: Boolean,
      default: false,
    },
    notes: {
      type: String,
      trim: true,
    },
  },
  { timestamps: true }
);

export const PaymentEntry = mongoose.model("PaymentEntry", PaymentEntrySchema);