import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import axios from 'axios';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import cookieParser from 'cookie-parser';
import { ObjectId } from 'mongodb';

import mongoose from 'mongoose';
import { verifyWebhook } from './webhookHandler.js';
import { syncInvoiceToInventory } from './syncInvoice.js';
import {syncUpdatedInvoice} from './syncUpdatedInvoice.js';
import {  saveInvoiceInLocalInventory, reverseInvoiceQuantities } from './inventoryService.js';
import { saveTokenToMongo, getValidAccessToken } from './token.js';
import {getInvoiceDetails} from './quickbooksClient.js';
import {requireAdmin} from './auth.js'; // For MongoDB ObjectId
//import './cron.js'
import db from './db.js'; // your MongoDB connection

const connectedDb = await db.connect();

dotenv.config();
const app = express();

app.use(cors({

  origin: 'https://inventory-management-frontend-d8oi.onrender.com',//process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true, // Allow cookies to be sent

}));
app.use(cookieParser());
app.use(express.json());


const {
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI,
  ENVIRONMENT,
  MONGO_URI
} = process.env;

mongoose.connect(MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));


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

// Admin login
app.post('/admin/login', async (req, res) => {
  const { email, password } = req.body;
  if (email === adminUser.email && await bcrypt.compare(password, adminUser.passwordHash)) {
    //const token = jwt.sign({ email }, SECRET, { expiresIn: '2h' });
    const token = jwt.sign({ role: 'admin' }, SECRET, { expiresIn: '2h' });
    console.log('Environment:', process.env.NODE_ENV);
    res.cookie('token', token, 
      { httpOnly: true,
        sameSite: 'lax',
        secure: true,//process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000 // 1 day
       }
       
    );
    res.json({ success: true });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

// Middleware to check admin authentication
app.get('/admin/auth-check', (req, res) => {
  const token = req.cookies.token;
   console.log('Cookies received:', req.cookies);  
  console.log('Token:', token);
  if (!token) return res.status(401).send();

  try {

    jwt.verify(token, process.env.JWT_SECRET);
    return res.status(200).send();
  } catch {
    return res.status(401).send();
  }
});


//Admin Logout
app.post('/admin/logout', (req, res) => {
  res.clearCookie('token', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.ENVIRONMENT === 'production'
  });

  return res.status(200).json({ message: 'Logged out' });
});

// Admin Routes to view and edit inventory
//app.get('/admin/inventory', requireAdmin,async (req, res) => {
 app.get('/admin/inventory', async (req, res) => {
  try {
    const items = await connectedDb.collection('item').find().toArray();
    console.log('Fetched items:', items);
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch inventory' });
  }
});

//app.put('/admin/inventory/:id',requireAdmin, async (req, res) => {
  app.put('/admin/inventory/:id', async (req, res) => {
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
        if (entity.name === 'Invoice') {
          if (entity.operation === 'Create') {
            console.log('New Invoice created:', entity.id);
            // Fetch invoice details + sync inventory
            await syncInvoiceToInventory(accessToken, realmId, entity.id);
            const invoice = await getInvoiceDetails(accessToken, realmId, entity.id);
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
      } catch (err) {
        console.error(`❌ Failed to sync invoice ${entity.id}:`, err.message);
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