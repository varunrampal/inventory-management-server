import { Router } from "express";
import TimesheetEntry from "../models/TimesheetEntry.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { allowedEmployeeIds } from "../services/supervisorService.js";

const r = Router();


// Upsert a single day entry for an employee
r.post("/upsert", requireAuth, requireRole("supervisor"), async (req, res) => {
try {
const { realmId, employeeId, date, hours, note } = req.body;

const allowed = await allowedEmployeeIds(req);
  if (Array.isArray(allowed) && !allowed.includes(String(employeeId))) {
    return res.status(403).json({ error: "Not allotted to supervisor" });
  }

const d = new Date(date);
const doc = await TimesheetEntry.findOneAndUpdate(
{ realmId, employeeId, date: d },
{ $set: { hours, note } },
{ upsert: true, new: true, setDefaultsOnInsert: true }
);
res.status(201).json(doc);
} catch (err) { res.status(400).json({ error: err.message }); }
});

// Bulk upsert (weekly grid)
r.post("/bulk", async (req, res) => {
try {
const { realmId, employeeId, entries } = req.body; // [{date, hours, note?}]
const ops = entries.map(e => ({
updateOne: {
filter: { realmId, employeeId, date: new Date(e.date) },
update: { $set: { hours: e.hours, note: e.note } },
upsert: true
}
}));
const result = await TimesheetEntry.bulkWrite(ops);
res.json({ ok: true, result });
} catch (err) { res.status(400).json({ error: err.message }); }
});


// Query by employee + date range
r.get("/", async (req, res) => {
const { realmId, employeeId, from, to } = req.query;
const filter = {};
if (realmId) filter.realmId = realmId;
if (employeeId) filter.employeeId = employeeId;
if (from || to) {
filter.date = {};
if (from) filter.date.$gte = new Date(from);
if (to) filter.date.$lte = new Date(to);
}
const docs = await TimesheetEntry.find(filter).sort({ date: 1 }).lean();
res.json(docs);
});


// Delete one entry
r.delete("/:id", async (req, res) => {
await TimesheetEntry.findByIdAndDelete(req.params.id);
res.json({ ok: true });
});


// Aggregation: weekly totals by employee within range
r.get("/summary/payroll", async (req, res) => {
  const { realmId, from, to } = req.query;

  const match = {};
  if (realmId) match.realmId = realmId;
  if (from || to) {
    match.date = {};
    if (from) match.date.$gte = new Date(from);
    if (to)   match.date.$lte = new Date(to);
  }

  const rows = await TimesheetEntry.aggregate([
    { $match: match },

    // weekly buckets
    { $addFields: { isoWeek: { $isoWeek: "$date" }, year: { $isoWeekYear: "$date" } } },

    // sum hours per employee per week
    // { $group: {
    //     _id: { employeeId: "$employeeId", year: "$year", week: "$isoWeek" },
    //     hours: { $sum: "$hours" }
    // }},
{ $group: { _id: "$employeeId", hours: { $sum: "$hours" } } },
{ $lookup: { from: "employees", localField: "_id", foreignField: "_id", as: "emp" } },
{ $set: { emp: { $first: "$emp" } } },
{ $project: {
    _id: 0,
    employeeId: "$_id",
    name: "$emp.name",
    hours: 1,
    cashHourlyRate: { $ifNull: ["$emp.cashHourlyRate", 0] },
    currency: { $ifNull: ["$emp.currency", "CAD"] },
    amount: { $round: [{ $multiply: ["$hours", { $ifNull: ["$emp.cashHourlyRate", 0] }] }, 2] }
}},

    { $sort: { year: 1, week: 1, name: 1 } }
  ]);

  res.json(rows);
});

export default r;