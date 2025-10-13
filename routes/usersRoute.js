// /server/routes/users.js
import { Router } from "express";
import User from "../models/User.js";
import { requireAuth, requireRole, requireSameRealm } from "../middleware/auth.js";

const r = Router();

// GET /api/users?role=supervisor&realmId=...
r.get("/", requireAuth, requireRole("admin"), requireSameRealm, async (req, res) => {
  const { realmId, role, q } = req.query;
  const filter = {};
  if (realmId) filter.realmId = realmId;
  if (role) filter.roles = role; // matches any user having this role
  if (q) {
    // optional name/email search
    filter.$or = [
      { name: { $regex: q, $options: "i" } },
      { email: { $regex: q, $options: "i" } },
    ];
  }

  const users = await User.find(filter, { name: 1, email: 1, roles: 1 }) // projection
    .sort({ name: 1 })
    .lean();

  res.json(users);
});

export default r;
