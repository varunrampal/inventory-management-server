// /server/scripts/seed-demo.js
import mongoose from "mongoose";
import dotenv from "dotenv";
import bcrypt from 'bcrypt';

import User from "../models/User.js";
import Employee from "../models/employee.js";
import SupervisorAllotment from "../models/SupervisorAllotment.js";

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/timesheets";
const REALM = process.env.REALM_Id || "123146276399949";

// helper: upsert a document by filter; returns doc
async function upsert(Model, filter, data) {
  await Model.updateOne(filter, { $setOnInsert: data }, { upsert: true });
  return Model.findOne(filter).lean();
}

// helper: create or update password on existing user
async function upsertUser({ name, email, roles, realmId, password, employeeId, isActive = true }) {
  const existing = await User.findOne({ email });
  const passwordHash = await bcrypt.hash(password, 10);

  if (!existing) {
    const u = await User.create({ name, email, roles, realmId, passwordHash, employeeId, isActive });
    return u.toObject();
  } else {
    // ensure roles/realm/employee link are set; refresh password for convenience (optional)
    await User.updateOne(
      { _id: existing._id },
      { $set: { roles, realmId, employeeId, isActive, passwordHash } }
    );
    return (await User.findById(existing._id)).toObject();
  }
}

async function main() {
  await mongoose.connect(MONGO_URI);
  console.log("✅ Mongo connected");

  // 1) Employees (HR records)
//   const alice = await upsert(
//     Employee,
//     { realmId: REALM, name: "Alice Worker" },
//     { realmId: REALM, name: "Alice Worker", email: "alice@demo.test", phone: "+1 604 555 0101", cashHourlyRate: 22.5, currency: "CAD" }
//   );
//   const bob = await upsert(
//     Employee,
//     { realmId: REALM, name: "Bob Worker" },
//     { realmId: REALM, name: "Bob Worker", email: "bob@demo.test", phone: "+1 604 555 0102", cashHourlyRate: 24.0, currency: "CAD" }
//   );

 // console.log("👥 Employees:", { alice: alice._id, bob: bob._id });

  // 2) Users
  const admin = await upsertUser({
    name: "Admin",
    email: "admin@greenflownurseries.com",
    roles: ["admin"],
    realmId: REALM,
    password: "admin@123",
  });

  const supervisor = await upsertUser({
    name: "Harinderjeet Singh",
    email: "supervisor@greenflownurseries.com",
    roles: ["supervisor"],
    realmId: REALM,
    password: "supervisor@123",
  });

  // Optional employee login (linked to Alice Employee record)
//   const employeeUser = await upsertUser({
//     name: "Alice Worker",
//     email: "employee@demo.test",
//     roles: ["employee"],
//     realmId: REALM,
//     employeeId: alice._id,
//     password: "Employee#12345",
//   });

//   console.log("👤 Users:", {
//     admin: admin._id,
//     supervisor: supervisor._id,
//     employee: employeeUser._id,
//   });

  // 3) Supervisor ↔ Employee allotments (Sam supervises Alice + Bob)
  async function upsertAllotment(supervisorUserId, employeeId) {
    await SupervisorAllotment.updateOne(
      { realmId: REALM, supervisorUserId, employeeId },
      { $setOnInsert: { realmId: REALM, supervisorUserId, employeeId } },
      { upsert: true }
    );
  }

  await upsertAllotment(supervisor._id, '68e405addd38d8661b8fb08a');
  await upsertAllotment(supervisor._id,'68e43d1ae9f2470ce8e412d7');
  await upsertAllotment(supervisor._id,'68e339877d37879df8bbf346');

  console.log("🔗 Allotments:", {
    supervisor: supervisor._id,
    employees: ['68e405addd38d8661b8fb08a', '68e43d1ae9f2470ce8e412d7', '68e339877d37879df8bbf346'],
  });

  console.log("\n✅ Seed complete!");
  console.log("Login accounts:");
  console.log("  Admin      → admin@demo.test       / Admin#12345");
  console.log("  Supervisor → supervisor@demo.test  / Supervisor#12345");
  console.log("  Employee   → employee@demo.test    / Employee#12345");
  console.log(`Realm ID used: ${REALM}`);

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
