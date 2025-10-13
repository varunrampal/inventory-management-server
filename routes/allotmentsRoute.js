// /server/routes/allotments.js
import { Router } from "express";
import SupervisorAllotment from "../models/SupervisorAllotment.js";
import { requireAuth, requireRole, requireSameRealm } from "../middleware/auth.js";

const r = Router();

// POST /api/allotments  (admin)
r.post("/", requireAuth, requireRole("admin"), requireSameRealm, async (req, res) => {
  const { realmId, supervisorUserId, employeeId } = req.body;
  const doc = await SupervisorAllotment.create({ realmId, supervisorUserId, employeeId });
  res.status(201).json(doc);
});

// GET /api/allotments  (admin)
r.get("/", requireAuth, requireRole("admin"), requireSameRealm, async (req, res) => {
  const { realmId, supervisorUserId } = req.query;
  const filter = {};
  if (realmId) filter.realmId = realmId;
  if (supervisorUserId) filter.supervisorUserId = supervisorUserId;
  const docs = await SupervisorAllotment.find(filter).lean();
  res.json(docs);
});

// DELETE /api/allotments/:id  (admin)
r.delete("/:id", requireAuth, requireRole("admin"), requireSameRealm, async (req, res) => {
  await SupervisorAllotment.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

export default r;
