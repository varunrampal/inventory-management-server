import Token from '../models/token.js';
import axios from 'axios';
import { getValidAccessToken } from '../token.js';
import { syncInvoicesToDB } from '../services/invoiceService.js';
import { syncEstimatesToDB } from '../services/estimateService.js';
import { syncItemsFromQuickBooks } from '../services/itemService.js';
import fs from 'fs/promises';
import path from 'path';

export async function syncAllCompanies() {
//   const companies = await Token.find();

const filePath = path.resolve('data/companies.json');
    const content = await fs.readFile(filePath, 'utf-8');
    const companies = JSON.parse(content);

  
console.log(`🔄 Syncing ${companies.length} companies...`);
  for (const company of companies) {
    const { realmId } = company;
    try {
      const accessToken = await getValidAccessToken(realmId);
        if (!accessToken) {
            console.warn(`⚠️ No valid access token for ${realmId}`);
            continue;
        }
      await syncItemsFromQuickBooks(accessToken, realmId);
      //await syncInvoicesToDB(accessToken, realmId);
      //await syncEstimatesToDB(accessToken, realmId);
      console.log(`✅ Synced: ${realmId}`);
    } catch (err) {
      console.error(`❌ Failed to sync ${realmId}:`, err.message);
    }
  }
}

export async function syncCompany(accessToken, realmId) {

  if (!accessToken) {
    throw new Error(`❌ No valid access token for realmId: ${realmId}`);
  } 
  console.log(`🔄 Syncing company: ${realmId}`);
  try {
        await syncItemsFromQuickBooks(accessToken, realmId, { includeInactive: true, pageSize: 1000, minorVersion: 65 });
        await syncEstimatesToDB(accessToken, realmId);
        await syncInvoicesToDB(accessToken, realmId);
       
    console.log(`✅ Synced: ${realmId}`);
  } catch (err) {
    console.error(`❌ Failed to sync ${realmId}:`, err.message);
  }
}
