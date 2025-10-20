import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret';

// export const requireAdmin = (req, res, next) => {
//   const token = req.cookies.token;
//   if (!token) return res.status(401).json({ error: 'Unauthorized' });

//   try {
//     const decoded = jwt.verify(token, JWT_SECRET);
//     if (decoded.role === 'admin') return next();
//     return res.status(403).json({ error: 'Forbidden' });
//   } catch (err) {
//     return res.status(401).json({ error: 'Invalid token' });
//   }
// };

export const requireAdmin = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    console.log(decoded);
   // if (decoded.role === 'admin') return next();
   if (decoded.roles[0] === 'admin') return next();
    return res.status(403).json({ error: 'Forbidden' });
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

export function issueToken(payload, opts = {}) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d", ...opts });
}

export function requireAuth(req, res, next) {
  const hdr = req.headers.authorization || "";
  const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  try {
    req.user = jwt.verify(token, JWT_SECRET); // { userId, roles, realmId, employeeId }
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    const userRoles = req.user?.roles || [];
    const ok = roles.some((r) => userRoles.includes(r));
    if (!ok) return res.status(403).json({ error: "Forbidden" });
    next();
  };
}

export function requireSameRealm(req, res, next) {
  const tokenRealm = req.user?.realmId;
  const inputRealm = req.query.realmId || req.body.realmId;
  if (tokenRealm && inputRealm && tokenRealm !== inputRealm) {
    return res.status(403).json({ error: "Cross-realm access denied" });
  }
  next();
}
