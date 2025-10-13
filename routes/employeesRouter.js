import { Router } from "express";
import Employee from "../models/employee.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { allowedEmployeeIds } from "../services/supervisorService.js";


const r = Router();


// Create
r.post("/", async (req, res) => {
try {
const { realmId, name, phone, isActive, cashHourlyRate, currency } = req.body;
const doc = await Employee.create({ realmId, name, phone, isActive, cashHourlyRate, currency });
res.status(201).json(doc);
} catch (err) { res.status(400).json({ error: err.message }); }
});


// List
r.get("/", requireAuth, requireRole("supervisor","manager","admin"), async (req, res) => {
const { realmId, q, active } = req.query;
const filter = {};
if (realmId) filter.realmId = realmId;
//if (active !== undefined) filter.isActive = active === "true";
filter.isActive = true;
if (q) filter.name = { $regex: q, $options: "i" };

 const roles = req.user.roles || [];
  if (!roles.includes("admin") && !roles.includes("manager")) {
    const allowed = await allowedEmployeeIds(req);
    if (Array.isArray(allowed)) filter._id = { $in: allowed };
  }

const docs = await Employee.find(filter).sort({ name: 1 }).lean();
res.json(docs);
});


// Update
r.put("/:id", async (req, res) => {
try {
const updated = await Employee.findByIdAndUpdate(req.params.id, req.body, { new: true });
res.json(updated);
} catch (err) { res.status(400).json({ error: err.message }); }
});


// Delete
r.delete("/:id", async (req, res) => {
try {
await Employee.findByIdAndDelete(req.params.id);
res.json({ ok: true });
} catch (err) { res.status(400).json({ error: err.message }); }
});


export default r;