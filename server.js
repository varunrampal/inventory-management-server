// server.js (production-ready)
import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import axios from 'axios';
import path from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import cookieParser from 'cookie-parser';
import { ObjectId } from 'mongodb';
import mongoose from 'mongoose';

// Your project modules
import { verifyWebhook } from './webhookHandler.js';
import { syncInvoiceToInventory } from './syncInvoice.js';
import { syncUpdatedInvoice } from './syncUpdatedInvoice.js';
import { saveInvoiceInLocalInventory, reverseInvoiceQuantities } from './services/inventoryService.js';
import {
  syncEstimateToInventory,
  getEstimateDetails,
  saveEstimateInLocalInventory,
  syncUpdatedEstimate,
  deleteLocalEstimate
} from './services/estimateService.js';
import { getItemDetailsFromQB, createOrUpdateItem, deleteItem as deleteLocalItem } from './services/itemService.js';
import { saveTokenToMongo, getValidAccessToken } from './token.js';
import { getInvoiceDetails } from './quickbooksClient.js';
import Item from './models/item.js';
import { requireAdmin } from './middleware/auth.js';
import itemRoutes from './routes/items.js';
import estimateRoutes from './routes/estimates.js';
import adminRoutes from './routes/adminRoutes.js';
import authRoutes from './routes/authRoutes.js';
import packageRoutes from './routes/packagesRoute.js';
import qbRoutes from "./routes/qb.routes.js";
import db from './db.js';

dotenv.config();

/* -------------------------- ENV + CONSTANTS -------------------------- */
const {
  QB_SANDBOX_CLIENT_ID,
  QB_PROD_CLIENT_ID,
  QB_SANDBOX_CLIENT_SECRET,
  QB_PROD_CLIENT_SECRET,
  QB_SANDBOX_REDIRECT_URI, // must match Intuit dashboard (production app)
  QB_PROD_REDIRECT_URI,
  QUICKBOOKS_ENV, // 'production' or 'sandbox'
  MONGO_URI,
  CLIENT_URL,           // e.g. https://invtrack-admin.onrender.com
  DEV_CLIENT_URL,       // e.g. http://localhost:5173
  JWT_SECRET = 'change-this-secret',
  DEFAULT_SYNC_TYPE,    // 'invoices' or 'estimates' per your usage
  PORT = 4000

} = process.env;

const IS_PROD = QUICKBOOKS_ENV === 'production';

export const CLIENT_ID = IS_PROD ? QB_PROD_CLIENT_ID : QB_SANDBOX_CLIENT_ID;
export const CLIENT_SECRET = IS_PROD ? QB_PROD_CLIENT_SECRET : QB_SANDBOX_CLIENT_SECRET;
export const REDIRECT_URI = IS_PROD
  ? QB_PROD_REDIRECT_URI
  : QB_SANDBOX_REDIRECT_URI;  

const ALLOWED_ORIGINS = [CLIENT_URL, DEV_CLIENT_URL].filter(Boolean);

const corsOptions = {
  origin(origin, cb) {
    if (!origin) return cb(null, true); // allow server-to-server / curl
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    return cb(new Error(`Not allowed by CORS: ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400,
};

const QB_BASE_URL =
  QUICKBOOKS_ENV === 'sandbox'
    ? 'https://sandbox-quickbooks.api.intuit.com'
    : 'https://quickbooks.api.intuit.com';

/* ----------------------------- APP SETUP ----------------------------- */
const app = express();
app.set('trust proxy', 1); // if behind a proxy (Render/NGINX/etc.)

app.use(cors(corsOptions));
app.use(cookieParser());
// Cap payload size to prevent abuse
app.use(express.json({ limit: '1mb' }));

// __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Static (e.g., for logos, EULA html fallback if needed)
//app.use('/static', express.static(path.join(__dirname, 'public'), { maxAge: IS_PROD ? '1d' : 0 }));
app.use('/static', express.static(path.join(__dirname, 'public'), { maxAge: 0 }));

/* ------------------------------ DATABASE ----------------------------- */
await db.connect(); // your db.js already handles client
mongoose
  .connect(MONGO_URI, { dbName: undefined })
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

/* --------------------------- AUTH BOOTSTRAP -------------------------- */
// For demo/admin login — keep minimal in production
const adminUser = {
  email: 'admin@example.com',
  passwordHash: await bcrypt.hash('admin123', 10),
};

/* -------------------------------- ROUTES ----------------------------- */
// Your existing feature routes
app.use("/admin/qb", qbRoutes);
app.use('/admin/items', itemRoutes);
app.use('/admin/estimates', estimateRoutes);
app.use('/admin/packages', packageRoutes);
app.use('/admin/sync', adminRoutes);
app.use('/auth', authRoutes);

/* -------- Admin login (Bearer token response; front-end stores it) --- */
app.post('/admin/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (email === adminUser.email && (await bcrypt.compare(password, adminUser.passwordHash))) {
      const token = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '2h' });
      return res.status(200).json({ token });
    }
    return res.status(401).json({ error: 'Invalid credentials' });
  } catch (e) {
    console.error('Login error:', e);
    return res.status(500).json({ error: 'Server error' });
  }
});

/* ------------------------- Admin auth check (JWT) -------------------- */
app.get('/admin/auth-check', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).send('No token');
  const token = authHeader.split(' ')[1];
  try {
    jwt.verify(token, JWT_SECRET);
    return res.sendStatus(200);
  } catch {
    return res.status(401).send('Invalid token');
  }
});

/* -------------------------- Inventory endpoints ---------------------- */
// Low stock (uses Mongoose model)
app.get('/admin/inventory/lowstock/:realmId', requireAdmin, async (req, res) => {
  try {
    const { realmId } = req.params;
    const { search = '', page = 1, limit = 10 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const nameQuery = search ? { name: { $regex: new RegExp(search, 'i') } } : {};

    const findQuery = { ...nameQuery, realmId, quantity: { $lt: 100 } };

    const [items, total] = await Promise.all([
      Item.find(findQuery).skip(skip).limit(parseInt(limit)).sort({ updatedAt: -1 }),
      Item.countDocuments(findQuery),
    ]);

    res.json({ items, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    console.error('Low stock fetch error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Full inventory via raw driver (kept for compatibility)
app.get('/admin/inventory/:realmId', requireAdmin, async (req, res) => {
  try {
    const { realmId } = req.params;
    const items = await db.connect().then(conn => conn.collection('items').find({ realmId }).toArray());
    res.json(items);
  } catch (err) {
    console.error('Inventory fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch inventory' });
  }
});

// Update an item
app.put('/admin/inventory/:id/:realmId', requireAdmin, async (req, res) => {
  try {
    const { id, realmId } = req.params;
    const update = { ...req.body, updatedAt: new Date() };
    const result = await db.connect().then(conn =>
      conn.collection('items').updateOne({ _id: new ObjectId(id), realmId }, { $set: update })
    );
    res.json({ success: result.modifiedCount > 0 });
  } catch (err) {
    console.error('Item update error:', err);
    res.status(500).json({ error: 'Failed to update item' });
  }
});

/* ------------------------- QuickBooks OAuth -------------------------- */
// Step 1: redirect user to Intuit consent
app.get('/auth/quickbooks', (req, res) => {
  const scope = [
    'com.intuit.quickbooks.accounting',
    // Include only what you actually need:
    // 'openid', 'profile', 'email'
  ].join(' ');

  const state = `invtrack-${Math.random().toString(36).slice(2)}`;
  const url =
    `https://appcenter.intuit.com/connect/oauth2?client_id=${CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&response_type=code&scope=${encodeURIComponent(scope)}` +
    `&state=${encodeURIComponent(state)}`;

  res.redirect(url);
});

// Step 2: callback (store tokens in DB)
app.get('/auth/callback', async (req, res) => {
  try {
    const { code, realmId } = req.query;
    if (!code || !realmId) return res.status(400).send('Missing code or realmId');

    const tokenRes = await axios.post(
      'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
      new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`,
        },
      }
    );

    await saveTokenToMongo(String(realmId), tokenRes.data);
    // Redirect to your admin UI page that can read ?realmId
     const redirectTo = IS_PROD ? CLIENT_URL.replace(/\/$/, '') : DEV_CLIENT_URL.replace(/\/$/, '');
    //const redirectTo = (CLIENT_URL || DEV_CLIENT_URL || '/').replace(/\/$/, '');
    console.log(`${redirectTo}/qb-connected?realmId=${encodeURIComponent(String(realmId))}`);
    res.redirect(`${redirectTo}/qb-connected?realmId=${encodeURIComponent(String(realmId))}`);
  } catch (err) {
    console.error('QuickBooks callback error:', err?.response?.data || err.message);
    res.status(400).send('QuickBooks authorization failed.');
  }
});

/* -------------------- Example: Read invoices (safe) ------------------ */
// Always get a fresh token from DB; do not use process memory
app.get('/invoices', async (req, res) => {
  try {
    const { realmId } = req.query;
    if (!realmId) return res.status(400).send('realmId required');

    const access_token = await getValidAccessToken(String(realmId));
    const query = 'SELECT * FROM Invoice MAXRESULTS 50';

    const response = await axios.get(
      `${QB_BASE_URL}/v3/company/${realmId}/query?query=${encodeURIComponent(query)}`,
      { headers: { Authorization: `Bearer ${access_token}`, Accept: 'application/json' } }
    );

    res.json(response.data);
  } catch (err) {
    console.error('Fetch invoices error:', err?.response?.data || err.message);
    res.status(500).json({ error: 'Failed to fetch invoices' });
  }
});

/* -------------------- QuickBooks Webhooks (single) ------------------- */
/**
 * Intuit will POST here. Keep it quick:
 * - verify signature
 * - ack 200 immediately
 * - process events asynchronously
 */
app.post('/quickbooks/webhook', express.json(), verifyWebhook, async (req, res) => {
  res.sendStatus(200); // respond fast

  try {
    const notifications = req.body?.eventNotifications || [];
    for (const event of notifications) {
      const realmId = event.realmId;
      console.log(realmId, 'Webhook event:', JSON.stringify(event));

      for (const entity of event.dataChangeEvent?.entities || []) {
        try {
          const accessToken = await getValidAccessToken(realmId);

          // INVOICES
          if (entity.name === 'Invoice' && DEFAULT_SYNC_TYPE === 'invoices') {
            if (entity.operation === 'Create') {
              await syncInvoiceToInventory(accessToken, realmId, entity.id);
              const invoice = await getInvoiceDetails(accessToken, realmId, entity.id);
              await saveInvoiceInLocalInventory(invoice, realmId);
            } else if (entity.operation === 'Update') {
              await syncUpdatedInvoice(accessToken, realmId, entity.id);
            } else if (entity.operation === 'Delete') {
              await reverseInvoiceQuantities(entity.id);
            }
          }

          // ESTIMATES
          if (entity.name === 'Estimate' && DEFAULT_SYNC_TYPE === 'estimates') {
            if (entity.operation === 'Create') {
              await syncEstimateToInventory(accessToken, realmId, entity.id);
              const estimate = await getEstimateDetails(accessToken, realmId, entity.id);
              await saveEstimateInLocalInventory(estimate, realmId);
            } else if (entity.operation === 'Update') {
              await syncUpdatedEstimate(accessToken, realmId, entity.id);
            } else if (entity.operation === 'Delete') {
              // If you want to reverse estimate quantities here, add your handler
              // await reverseEstimateQuantities(entity.id);
              // Or delete local mirror if required:
              await deleteLocalEstimate(entity.id, realmId);
            }
          }

          // ITEMS
          if (entity.name === 'Item') {
            if (entity.operation === 'Create' || entity.operation === 'Update') {
              const itemDetails = await getItemDetailsFromQB(accessToken, realmId, entity.id);
              if (itemDetails) {
                await createOrUpdateItem(itemDetails, realmId);
              } else {
                console.warn(`Item ${entity.id} not found on QB`);
              }
            } else if (entity.operation === 'Delete') {
              await deleteLocalItem(entity.id);
            }
          }
        } catch (innerErr) {
          console.error(`Webhook entity ${entity?.name} (${entity?.id}) failed:`, innerErr?.message);
        }
      }
    }
  } catch (err) {
    console.error('Webhook processing error:', err?.message);
  }
});

/* ----------------------------- 404 + ERRORS -------------------------- */
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// Basic error handler (avoid leaking stack in prod)
app.use((err, req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Server error' });
});



/* ------------------------------ START ------------------------------- */
app.listen(PORT, () => {
  console.log(`🚀 Server up on http://localhost:${PORT} (env=${QUICKBOOKS_ENV}, QB=${QUICKBOOKS_ENV}), URI=${REDIRECT_URI}`);
});
