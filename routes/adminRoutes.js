// routes/adminRoutes.js
import express from 'express';
import { syncAllCompanies, syncCompany } from '../services/syncService.js';
import { initiateAuthFlow } from '../utils/initiateAuthFlow.js'; // Ensure this path is correct
import { getValidAccessToken } from '../token.js'
import axios from 'axios';
import nodemailer from 'nodemailer';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const companiesPath = path.join(__dirname, '../public/companies.json');

// Endpoint to update lastSync time for a specific realmId
// This is used to update the last sync time after a successful sync operation
router.post('/update-sync-time', async (req, res) => {
  const { realmId } = req.body;
  if (!realmId) return res.status(400).json({ error: 'Missing realmId' });

  try {
    const data = await fs.readFile(companiesPath, 'utf-8');
    const companies = JSON.parse(data);

    const updated = companies.map(c =>
      c.realmId === realmId
        ? { ...c, lastSync: new Date().toISOString() }
        : c
    );

    await fs.writeFile(companiesPath, JSON.stringify(updated, null, 2));
    res.json({ message: 'lastSync updated', updated });
  } catch (err) {
    console.error('Update error:', err);
    res.status(500).json({ error: 'Failed to update file' });
  }
});



// Endpoint to manually trigger sync for all companies
// This can be used for testing or manual sync operations
router.post('/manual-sync/:realmId', async (req, res) => {
  const { realmId } = req.params;
  try {

    const accessToken = await getValidAccessToken(realmId);
     const syncResult = await syncCompany(accessToken, realmId); // your logic
   res.json({ message: 'Sync successful', syncResult });
  } catch (err) {
    // 🔔 Send email on failure
    const transporter = nodemailer.createTransport({
      service: 'Gmail',
      auth: {
        user: process.env.ALERT_EMAIL_USER,
        pass: process.env.ALERT_EMAIL_PASS
      }
    });

    await transporter.sendMail({
      from: '"Sync Alert" <noreply@example.com>',
      to: process.env.ALERT_EMAIL_TO,
      subject: '❌ QuickBooks Sync Failed',
      text: `Sync failure: ${err.message}`
    });

    res.status(500).json({ message: '❌ Sync failed. Admin notified.' });
  }
});

export default router;