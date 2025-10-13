// /server/routes/auth.js
import { Router } from "express";
import bcrypt from "bcryptjs";
import User from "../models/User.js";
import { issueToken } from "../middleware/auth.js";

const r = Router();

// POST /api/auth/signup
r.post("/signup", async (req, res) => {
  const { realmId, name, email, password, roles = ["employee"], employeeId } = req.body;
  const exists = await User.findOne({ email });
  if (exists) return res.status(400).json({ error: "Email already registered" });
  const passwordHash = await bcrypt.hash(password, 10);
  const u = await User.create({ realmId, name, email, passwordHash, roles, employeeId });
  const token = issueToken({ userId: u._id, roles: u.roles, realmId: u.realmId, employeeId: u.employeeId });
  res.json({ token, user: { _id: u._id, name: u.name, email: u.email, roles: u.roles, realmId: u.realmId, employeeId: u.employeeId } });
});

// POST /api/auth/login
r.post("/login", async (req, res) => {
  const { email, password } = req.body;
  const u = await User.findOne({ email });
  if (!u || !u.isActive) return res.status(401).json({ error: "Invalid credentials" });
  const ok = await bcrypt.compare(password, u.passwordHash);
  if (!ok) return res.status(401).json({ error: "Invalid credentials" });
  const token = issueToken({ userId: u._id, roles: u.roles, realmId: u.realmId, employeeId: u.employeeId });
  res.json({ token, user: { _id: u._id, name: u.name, email: u.email, roles: u.roles, realmId: u.realmId, employeeId: u.employeeId } });
});

export default r;
