// project/cron.js
import cron from 'node-cron';
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
import { getValidAccessToken } from './token.js';
import { syncItemsFromQuickBooks } from './services/itemService.js';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI;
const realmId = process.env.REALM_Id // Replace with your actual realm ID

// Schedule task to run daily at 2 AM
cron.schedule('*/5 * * * *', async () => {
  console.log('⏰ Running scheduled QuickBooks item sync...');

  const client = new MongoClient(MONGO_URI);
  try {
    await client.connect();
    const db = client.db('pnpinventoryDB');

    const accessToken = await getValidAccessToken(realmId);
    console.log(`🔑 Using access token: ${accessToken}`);

    await syncItemsFromQuickBooks(accessToken, realmId);
  } catch (err) {
    console.error('❌ Cron sync failed:', err);
  } finally {
    await client.close();
  }

  console.log('✅ Scheduled sync completed');
});
