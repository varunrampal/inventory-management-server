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
import { verifyWebhook } from './webhookHandler.js';
import { syncInvoiceToInventory } from './syncInvoice.js';
import { syncUpdatedInvoice } from './syncUpdatedInvoice.js';
import { saveInvoiceInLocalInventory, reverseInvoiceQuantities } from './services/inventoryService.js';
import {
  syncEstimateToInventory,
  getEstimateDetails,
  saveEstimateInLocalInventory,
  syncUpdatedEstimate,
  reverseEstimateQuantities
} from './services/estimateService.js';
import {getItemDetailsFromQB,createOrUpdateItem, deleteItem } from './services/itemService.js';
import { updateLocalInventory } from './services/inventoryService.js';
import { saveTokenToMongo, getValidAccessToken } from './token.js';
import { getInvoiceDetails } from './quickbooksClient.js';
import { requireAdmin } from './middleware/auth.js'; // For MongoDB ObjectId
import itemRoutes from './routes/items.js';
import estimateRoutes from './routes/estimates.js'; // Import your estimates routes
import adminRoutes from './routes/adminRoutes.js'; // Import your admin routes
import authRoutes from './routes/authRoutes.js'; // Import your auth routes
//import './cron.js'
import db from './db.js'; // your MongoDB connection
dotenv.config();


const {
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI,
  ENVIRONMENT,
  MONGO_URI,
  CLIENT_URL
} = process.env;

const app = express();
app.use(cors({
  origin: CLIENT_URL || 'http://localhost:5173',

}));
app.use(cookieParser());
app.use(express.json());

// Resolve __dirname in ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve the public directory
app.use('/static', express.static(path.join(__dirname, 'public')));



const connectedDb = await db.connect();



const QB_BASE_URL = ENVIRONMENT === 'sandbox'
  ? 'https://sandbox-quickbooks.api.intuit.com'
  : 'https://quickbooks.api.intuit.com';

let access_token = ''; // Store securely in DB in production
let realmId = '';


const SECRET = process.env.JWT_SECRET || 'change-this-secret';

// Mock admin (in real life: store in DB)
const adminUser = {
  email: 'admin@example.com',
  passwordHash: await bcrypt.hash('admin123', 10) // hash this once
};

// app.use(cors({

//   origin: 'https://inventory-management-frontend-d8oi.onrender.com',//process.env.CLIENT_URL || 'http://localhost:5173',
//   credentials: true, // Allow cookies to be sent

// }));


app.use('/admin/items', itemRoutes);
app.use('/admin/estimates', estimateRoutes);
app.use('/admin/sync', adminRoutes);
app.use('/auth', authRoutes); // Serve static files for auth

mongoose.connect(MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));



// Admin login
// app.post('/admin/login', async (req, res) => {
//   const { email, password } = req.body;
//   if (email === adminUser.email && await bcrypt.compare(password, adminUser.passwordHash)) {
//     //const token = jwt.sign({ email }, SECRET, { expiresIn: '2h' });
//     const token = jwt.sign({ role: 'admin' }, SECRET, { expiresIn: '2h' });
//     console.log('Environment:', process.env.NODE_ENV);
//     res.cookie('token', token, 
//       { httpOnly: true,
//         sameSite: 'lax',
//         secure: true,//process.env.NODE_ENV === 'production',
//         maxAge: 24 * 60 * 60 * 1000 // 1 day
//        }

//     );
//     res.json({ success: true });
//   } else {
//     res.status(401).json({ error: 'Invalid credentials' });
//   }
// });

app.post('/admin/login', async (req, res) => {
  const { email, password } = req.body;
  if (email === adminUser.email && await bcrypt.compare(password, adminUser.passwordHash)) {
    //const token = jwt.sign({ email }, SECRET, { expiresIn: '2h' });
    const token = jwt.sign({ role: 'admin' }, SECRET, { expiresIn: '2h' });

    return res.status(200).json({ token });

  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});


// Middleware to check admin authentication
// app.get('/admin/auth-check', (req, res) => {
//   const token = req.cookies.token;
//    console.log('Cookies received:', req.cookies);  
//   console.log('Token:', token);
//   if (!token) return res.status(401).send();

//   try {

//     jwt.verify(token, process.env.JWT_SECRET);
//     return res.status(200).send();
//   } catch {
//     return res.status(401).send();
//   }
// });
app.get('/admin/auth-check', (req, res) => {
  const authHeader = req.headers.authorization;
  console.log('Authorization header:', authHeader);
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).send('No token');
  }
  const token = authHeader.split(' ')[1];
  //console.log('Token:', token);
  try {
    jwt.verify(token, SECRET);
    res.sendStatus(200);
  } catch {
    res.status(401).send('Invalid token');
  }
});

//Admin Logout
app.post('/admin/logout', (req, res) => {
  res.clearCookie('token', {
    httpOnly: true,
    sameSite: 'lax',
    secure: true
  });

  return res.status(200).json({ message: 'Logged out' });
});

// Admin Routes to view and edit inventory
app.get('/admin/inventory', requireAdmin, async (req, res) => {
  //app.get('/admin/inventory', async (req, res) => {
  try {
    const items = await connectedDb.collection('item').find().toArray();
    console.log('Fetched items:', items);
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch inventory' });
  }
});

app.put('/admin/inventory/:id', requireAdmin, async (req, res) => {
  // app.put('/admin/inventory/:id', async (req, res) => {
  const { id } = req.params;
  const update = req.body;
  console.log('Updating item:', id, update);
  try {
    update.updatedAt = new Date();
    const result = await connectedDb.collection('item').updateOne(
      { _id: new ObjectId(id) },
      { $set: update }
    );
    res.json({ success: result.modifiedCount > 0 });
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: 'Failed to update item' });
  }
});



app.get('/auth/quickbooks', (req, res) => {
  const scope = [
    'com.intuit.quickbooks.accounting',
    'openid',
    'profile',
    'email'
  ].join(' ');

  const url = `https://appcenter.intuit.com/connect/oauth2?client_id=${CLIENT_ID}&redirect_uri=${REDIRECT_URI}&response_type=code&scope=${encodeURIComponent(scope)}&state=12345`;

  res.redirect(url);
});

app.get('/auth/callback', async (req, res) => {
  const { code, realmId: rId } = req.query;
  realmId = rId;

  const tokenRes = await axios.post(
    'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
    new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI
    }),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`,
      },
    }
  );

  access_token = tokenRes.data.access_token;

  //console.log(`Access Token: ${access_token}`);

  await saveTokenToMongo(realmId, tokenRes.data);

  res.send('QuickBooks connected! You can now access /invoices.');
});

app.get('/invoices', async (req, res) => {
  if (!access_token || !realmId) return res.status(401).send('Not authenticated');

  try {
    const query = 'SELECT * FROM Invoice MAXRESULTS 50';
    const response = await axios.get(
      `${QB_BASE_URL}/v3/company/${realmId}/query?query=${encodeURIComponent(query)}`,
      {
        headers: {
          Authorization: `Bearer ${access_token}`,
          Accept: 'application/json',
        },
      }
    );
    res.json(response.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// This webhook is called when an invoice is created, updated or deleted in QuickBooks
// It will sync the invoice to the local inventory
app.post('/quickbooks/webhook', express.json(), verifyWebhook, async (req, res) => {
  const events = req.body.eventNotifications;
  console.log('Call 1')
  events.forEach(event => {
    const realmId = event.realmId;
    event.dataChangeEvent.entities.forEach(async entity => {
      try {
        const accessToken = await getValidAccessToken(realmId);
        //console.log('Access Token:', accessToken);
        // Handle different entity types
        if (entity.name === 'Invoice') {
          if (entity.operation === 'Create') {
            console.log('New Invoice created:', entity.id);
            // Fetch invoice details + sync inventory
            await syncInvoiceToInventory(accessToken, realmId, entity.id);
            const invoice = await getInvoiceDetails(accessToken, realmId, entity.id);
            // Save invoice in local inventory
            await saveInvoiceInLocalInventory(invoice, realmId);
          }
          else if (entity.operation === 'Update') {
            console.log('Invoice updated:', entity.id);
            await syncUpdatedInvoice(accessToken, realmId, entity.id);
          } else if (entity.operation === 'Delete') {
            console.log('Invoice deleted:', entity.id);
            await reverseInvoiceQuantities(entity.id);
          }
        }
      // Handle estimates and items similarly
        if (entity.name === 'Estimate') {
          if (entity.operation === 'Create') {
            console.log('New Estimate created:', entity.id);
            // Fetch estimate details + sync inventory
            await syncEstimateToInventory(accessToken, realmId, entity.id);
            const estimate = await getEstimateDetails(accessToken, realmId, entity.id);
            // Save estimate in local inventory
            await saveEstimateInLocalInventory(estimate, realmId);
          } else if (entity.operation === 'Update') {
            console.log('Estimate updated:', entity.id);
            // Sync updated estimate to inventory
            await syncUpdatedEstimate(accessToken, realmId, entity.id);
          }else if (entity.operation === 'Delete') {
            console.log('Estimate deleted:', entity.id);
            // Reverse quantities for deleted estimate
            await deleteItem(entity.id);
          }

        }
        // Handle items
        if (entity.name === 'Item') {
          if (entity.operation === 'Create' || entity.operation === 'Update') {
            console.log('New Item created/Updated:', entity.id);
            // Handle new item creation logic here
            const itemDetails = await getItemDetailsFromQB(accessToken, realmId, entity.id);
            if (!itemDetails) {
                console.warn(`⚠️ No item found for ID ${entity.id}`);
                return null;
            }
            await createOrUpdateItem(itemDetails, realmId);

          } else if (entity.operation === 'Delete') {
             
            console.log('Item deleted:', entity.id);
            // Handle item deletion logic here
            await deleteItemByQuickBooksId(entity.id);
          }
        }
      } catch (err) {
        console.error(`❌ Failed to sync ${entity.id}:`, err.message);
      }
    });
  });

  res.status(200).send();
});


app.post('/quickbooks/webhook', express.json(), async (req, res) => {
  res.sendStatus(200); // Respond fast to QuickBooks
  console.log('Call 2')
  const events = req.body.eventNotifications;

  for (const event of events) {
    const realmId = event.realmId;

    for (const entity of event.dataChangeEvent.entities) {
      if (entity.name === 'Invoice' && entity.operation === 'Create') {
        const invoiceId = entity.id;

        await syncInvoiceToInventory(
          access_token,
          realmId,
          invoiceId
        );
      }
    }
  }
});


app.listen(4000, () => console.log('Server running on http://localhost:4000'));