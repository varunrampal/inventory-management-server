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
    if (decoded.role === 'admin') return next();
    return res.status(403).json({ error: 'Forbidden' });
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

