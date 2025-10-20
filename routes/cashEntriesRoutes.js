// routes/cashEntries.js
import { Router } from "express";
import { body, param, query, validationResult } from "express-validator";
import CashEntry from "../models/CashEntry.js";
import { stringify } from "csv-stringify";

const router = Router();

// realm helper (query or header)
function getRealmId(req) {
  return String(req.query.realmId || req.headers["x-realm-id"] || "").trim();
}
function mustHaveRealm(req, res, next) {
  const realmId = getRealmId(req);
  if (!realmId) return res.status(400).json({ error: "realmId is required" });
  req.realmId = realmId;
  next();
}
function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  next();
}
const dateRange = (start, end) => {
  const filter = {};
  if (start || end) {
    filter.date = {};
    if (start) filter.date.$gte = new Date(start);
    if (end) {
      const d = new Date(end);
      if (end.length <= 10) d.setHours(23,59,59,999);
      filter.date.$lte = d;
    }
  }
  return filter;
};

// GET /admin/cashentries
router.get(
  "/",
  mustHaveRealm,
  [
    query("start").optional().isISO8601(),
    query("end").optional().isISO8601(),
    query("type").optional().isIn(["in", "out"]),
    query("limit").optional().isInt({ min: 1, max: 1000 }),
    query("skip").optional().isInt({ min: 0 }),
    query("search").optional().isString(),
  ],
  validate,
  async (req, res) => {
    const { start, end, type, search } = req.query;
    const limit = parseInt(req.query.limit || "500", 10);
    const skip = parseInt(req.query.skip || "0", 10);

    const filter = { realmId: req.realmId, ...dateRange(start, end) };
    if (type) filter.type = type;
    if (search) filter.note = { $regex: search, $options: "i" };

    const [items, count, totals] = await Promise.all([
      CashEntry.find(filter).sort({ date: 1, _id: 1 }).skip(skip).limit(limit),
      CashEntry.countDocuments(filter),
      CashEntry.aggregate([
        { $match: filter },
        {
          $group: {
            _id: null,
            totalIn: { $sum: { $cond: [{ $eq: ["$type", "in"] }, "$amount", 0] } },
            totalOut:{ $sum: { $cond: [{ $eq: ["$type","out"] }, "$amount", 0] } },
          },
        },
        { $project: { _id: 0, totalIn: 1, totalOut: 1, balance: { $subtract: ["$totalIn", "$totalOut"] } } },
      ]),
    ]);

    res.json({ items, count, totals: totals[0] || { totalIn: 0, totalOut: 0, balance: 0 } });
  }
);

// POST /admin/cashentries
router.post(
  "/",
  mustHaveRealm,
  [
    body("type").isIn(["in", "out"]),
    body("amount").isFloat({ min: 0 }),
    body("note").optional().isString(),
    body("date").optional().isISO8601(),
    body("category").optional().isString(),
    body("paymentMethod").optional().isString(),
  ],
  validate,
  async (req, res) => {
    const payload = { ...req.body, realmId: req.realmId };
    const created = await CashEntry.create(payload);
    res.status(201).json(created);
  }
);

// PUT /admin/cashentries/:id
router.put(
  "/:id",
  mustHaveRealm,
  [
    param("id").isMongoId(),
    body("type").optional().isIn(["in", "out"]),
    body("amount").optional().isFloat({ min: 0 }),
    body("note").optional().isString(),
    body("date").optional().isISO8601(),
    body("category").optional().isString(),
    body("paymentMethod").optional().isString(),
  ],
  validate,
  async (req, res) => {
    const updated = await CashEntry.findOneAndUpdate(
      { _id: req.params.id, realmId: req.realmId },
      req.body,
      { new: true }
    );
    if (!updated) return res.status(404).send("Not found");
    res.json(updated);
  }
);

// DELETE /admin/cashentries/:id
router.delete(
  "/:id",
  mustHaveRealm,
  [param("id").isMongoId()],
  validate,
  async (req, res) => {
    const deleted = await CashEntry.findOneAndDelete({ _id: req.params.id, realmId: req.realmId });
    if (!deleted) return res.status(404).send("Not found");
    res.json({ ok: true });
  }
);

// GET /admin/cashentries/summary
router.get(
  "/summary",
  mustHaveRealm,
  [
    query("start").optional().isISO8601(),
    query("end").optional().isISO8601(),
    query("groupBy").optional().isIn(["day","week","month"]),
  ],
  validate,
  async (req, res) => {
    const { start, end } = req.query;
    const groupBy = req.query.groupBy || "day";
    const filter = { realmId: req.realmId, ...dateRange(start, end) };
    const dateExpr = {
      day:   { $dateToString: { format: "%Y-%m-%d", date: "$date" } },
      week:  { $dateToString: { format: "%G-W%V",   date: "$date" } }, // ISO week
      month: { $dateToString: { format: "%Y-%m",    date: "$date" } },
    }[groupBy];

    const result = await CashEntry.aggregate([
      { $match: filter },
      { $group: {
          _id: dateExpr,
          totalIn:  { $sum: { $cond: [{ $eq: ["$type","in"] }, "$amount", 0] } },
          totalOut: { $sum: { $cond: [{ $eq: ["$type","out"] }, "$amount", 0] } },
          count: { $sum: 1 }
      }},
      { $project: { _id: 0, period: "$_id", totalIn: 1, totalOut: 1, balance: { $subtract: ["$totalIn","$totalOut"] }, count: 1 } },
      { $sort: { period: 1 } },
    ]);

    res.json(result);
  }
);

// GET /admin/cashentries/export (CSV)
router.get(
  "/export",
  mustHaveRealm,
  [
    query("start").optional().isISO8601(),
    query("end").optional().isISO8601(),
    query("type").optional().isIn(["in","out"]),
    query("search").optional().isString(),
  ],
  validate,
  async (req, res) => {
    const { start, end, type, search } = req.query;
    const filter = { realmId: req.realmId, ...dateRange(start, end) };
    if (type) filter.type = type;
    if (search) filter.note = { $regex: search, $options: "i" };

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="cash-entries.csv"`);

    const stringifier = stringify({
      header: true,
      columns: ["date","type","amount","note","category","paymentMethod","createdAt"],
    });
    stringifier.pipe(res);

    const cursor = CashEntry.find(filter).sort({ date: 1, _id: 1 }).cursor();
    for await (const doc of cursor) {
      stringifier.write([
        doc.date?.toISOString() ?? "",
        doc.type,
        doc.amount,
        doc.note ?? "",
        doc.category ?? "",
        doc.paymentMethod ?? "",
        doc.createdAt?.toISOString() ?? "",
      ]);
    }
    stringifier.end();
  }
);

export default router;
