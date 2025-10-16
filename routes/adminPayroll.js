import express from "express";
import mongoose from "mongoose";
import TimesheetEntry from "../models/TimesheetEntry.js";
import Employee from "../models/employee.js";
import PayrollPayment from "../models/PayrollPayment.js";

const router = express.Router();

/** ----------------- Auth / Realm helpers ----------------- */
function requireAuth(req, _res, next) {
  // Replace with your real JWT auth; ensure req.user or allow realmId via header/query
  next();
}
function getRealmId(req) {
  return normalizeRealmId(
    req.headers["x-realm-id"] || req.query.realmId || req.user?.realmId
  );
}
/** ----------------- Period helpers (Sat end) ----------------- */
function toYMD(d) {
  const yr = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${yr}-${mo}-${da}`;
}
function parsePeriodId(periodId) {
  const [startStr, endStr] = String(periodId).split("_");
  if (!startStr || !endStr) throw new Error("Invalid periodId");
  // Use UTC inclusive window [start .. end]
  const start = new Date(`${startStr}T00:00:00.000Z`);
  const end   = new Date(`${endStr}T23:59:59.999Z`);
  return { start, end, label: `${startStr} → ${endStr}` };
}

// Anchor is a Saturday that ends a valid period (current: 2025-10-11)
function buildBiweeklyPeriods({ count = 12 } = {}) {
  const anchorStr = process.env.PAYROLL_ANCHOR_END || "2025-10-11"; // Saturday
  // Noon local to avoid DST edge cases when doing +/− days in JS
  const anchor = new Date(`${anchorStr}T12:00:00`);
  const today = new Date();
  const MS14 = 14 * 24 * 3600 * 1000;

  const steps = Math.floor((today - anchor) / MS14);
  const currentEnd = new Date(anchor.getTime() + steps * MS14 * (today >= anchor ? 1 : -1));
  const endRef = today >= anchor ? currentEnd : new Date(anchor.getTime() - MS14);

  const out = [];
  const half = Math.floor(count / 2);

  for (let i = half; i >= 1; i--) {
    const end = new Date(endRef.getTime() - i * MS14);
    const start = new Date(end.getTime() - 13 * 24 * 3600 * 1000);
    out.push(periodFromRange(start, end));
  }
  {
    const end = new Date(endRef);
    const start = new Date(end.getTime() - 13 * 24 * 3600 * 1000);
    out.push(periodFromRange(start, end));
  }
  for (let i = 1; i <= half - 1; i++) {
    const end = new Date(endRef.getTime() + i * MS14);
    const start = new Date(end.getTime() - 13 * 24 * 3600 * 1000);
    out.push(periodFromRange(start, end));
  }
  return out;
}
function periodFromRange(start, end) {
  const id = `${toYMD(start)}_${toYMD(end)}`;
  const label = `${toYMD(start)} → ${toYMD(end)} (Sat end)`;
  return { id, label, start: start.toISOString(), end: end.toISOString() };
}

function normalizeRealmId(raw) {
  if (raw == null) return null;
  if (typeof raw === "string") return raw;
  // Some apps store it inside an object, or as a number
  if (typeof raw === "number") return String(raw);
  if (typeof raw === "object") {
    // Common accidental shapes: { realmId: "..." } or {_id: "..."}
    if (raw.realmId) return String(raw.realmId);
    if (raw._id) return String(raw._id);
  }
  return String(raw); // last resort
}

/** ----------------- GET /admin/payroll/periods ----------------- */
router.get("/periods", requireAuth, async (req, res) => {
  const count = Math.min(Number(req.query.count || 12), 26);
  res.json(buildBiweeklyPeriods({ count }));
});

/** ----------------- GET /admin/payroll/summary ----------------- */
router.get("/summary", requireAuth, async (req, res) => {
  try {
    const realmId = getRealmId(req);
    
    if (!realmId) return res.status(400).json({ error: "realmId required" });

    const { periodId } = req.query;
    if (!periodId) return res.status(400).json({ error: "periodId required" });

    const { start, end, label } = parsePeriodId(periodId);
   
    // Sum hours by employee within the window
    const hoursByEmployee = await TimesheetEntry.aggregate([
      { $match: { realmId, date: { $gte: start, $lte: end } } },
      {
        $group: {
          _id: "$employeeId",
          totalHours: { $sum: "$hours" },
        }
      },
      { $project: { _id: 0, employeeId: "$_id", totalHours: { $round: ["$totalHours", 2] } } },
      // Join to Employee to get fullName
      {
        $lookup: {
          from: "employees",
          localField: "employeeId",
          foreignField: "_id",
          as: "emp"
        }
      },
      { $addFields: { emp: { $first: "$emp" } } },
      { $project: { employeeId: 1, totalHours: 1, employeeName: { $ifNull: ["$emp.name", ""] }, cashHourlyRate: { $ifNull: ["$emp.cashHourlyRate", 0] }  } },
      { $sort: { employeeName: 1 } },
    ]);

    // Existing payments for the period
    const payments = await PayrollPayment.find({ realmId, periodId }).lean();
    const paidMap = new Map(
      payments.map(p => [String(p.employeeId), { hoursPaid: p.hoursPaid || 0, notes: p.notes || "" }])
    );

    const rows = [];
    const seen = new Set();

    for (const r of hoursByEmployee) {
      const key = String(r.employeeId);
      const paid = paidMap.get(key);
      rows.push({
        employeeId: r.employeeId,                  // ObjectId (front-end treats as key)
        employeeName: r.employeeName || "",        // safe if missing
        totalHours: Number(r.totalHours || 0),
        cashHourlyRate: Number(r.cashHourlyRate || 0),   
        hoursPaid: paid ? Number(paid.hoursPaid || 0) : 0,
        notes: paid?.notes || "",
      });
      seen.add(key);
    }

    // Include payments for employees with zero hours (rare but possible)
   if (payments.length) {
  const missingIds = payments.filter(p => !seen.has(String(p.employeeId))).map(p => p.employeeId);
  if (missingIds.length) {
    const emps = await Employee.find(
      { _id: { $in: missingIds }, realmId },
      { _id: 1, fullName: 1, cashHourlyRate: 1 }
    ).lean();

    const metaById = Object.fromEntries(
      emps.map(e => [String(e._id), { name: e.fullName || "", rate: e.cashHourlyRate || 0 }])
    );

    for (const p of payments) {
      const key = String(p.employeeId);
      if (seen.has(key)) continue;
      const meta = metaById[key] || {};
      rows.push({
        employeeId: p.employeeId,
        employeeName: meta.name || "",
        totalHours: 0,
        cashHourlyRate: Number(meta.rate || 0),          // ← NEW in response
        hoursPaid: Number(p.hoursPaid || 0),
        notes: p.notes || "",
      });
    }
  }
}
    res.json({
      period: { id: periodId, label, start: start.toISOString(), end: end.toISOString() },
      rows,
      globalNotes: "",
    });
  } catch (err) {
    console.error("Payroll summary error:", err);
    res.status(500).json({ error: "Failed to load payroll summary" });
  }
});

/** ----------------- POST /admin/payroll/pay ----------------- */
router.post("/pay", requireAuth, async (req, res) => {
  const session = await mongoose.startSession();
  try {
    const realmId = getRealmId(req) || req.body.realmId;
    if (!realmId) return res.status(400).json({ error: "realmId required" });

    const { periodId, rows } = req.body || {};
    if (!periodId) return res.status(400).json({ error: "periodId required" });
    if (!Array.isArray(rows)) return res.status(400).json({ error: "rows[] required" });

    await session.withTransaction(async () => {
      for (const r of rows) {
        if (!r?.employeeId) continue;
        const empId = new mongoose.Types.ObjectId(r.employeeId);
        const hoursPaid = Math.max(0, Number(r.hoursPaid || 0));
        const notes = String(r.notes || "");

        await PayrollPayment.updateOne(
          { realmId, periodId, employeeId: empId },
          {
            $set: {
              hoursPaid,
              notes,
              updatedBy: req.user?.email || req.user?.sub || "system",
            },
          },
          { upsert: true, session }
        );
      }
      // Optional: upsert period-level notes in a separate collection
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("Payroll pay error:", err);
    res.status(500).json({ error: "Failed to save payroll payments" });
  } finally {
    await session.endSession();
  }
});

export default router;
