// helper used in timesheets + employees routes
import SupervisorAllotment from "../models/SupervisorAllotment.js";

export async function allowedEmployeeIds(req) {
  const roles = req.user?.roles || [];
  if (roles.includes("admin") || roles.includes("manager")) return null; // all
  if (roles.includes("supervisor")) {
    const rows = await SupervisorAllotment.find({
      realmId: req.user.realmId,
      supervisorUserId: req.user.userId
    }).lean();
    return rows.map(r => String(r.employeeId));
  }
  // plain employee: only self
  return [String(req.user?.employeeId)].filter(Boolean);
}
