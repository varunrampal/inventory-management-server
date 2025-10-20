// server/cors.js
import cors from "cors";

const whitelist = [
  "https://invtrack.ca",
  "https://www.invtrack.ca",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

export const corsMiddleware = cors({
  origin(origin, cb) {
    // allow non-browser tools (e.g., curl/postman) with no origin
    if (!origin) return cb(null, true);
    if (whitelist.includes(origin)) return cb(null, true);
    return cb(new Error(`CORS blocked: ${origin} not in whitelist`));
  },
  credentials: true, // if you use cookies or Authorization headers
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Requested-With",
    "Accept",
  ],
  exposedHeaders: ["Content-Length", "Content-Type"],
  maxAge: 600, // cache the preflight for 10 minutes
});
