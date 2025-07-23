import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Invoice from '../models/invoice.js';
import Token from '../models/token.js';
import { syncCompany } from '../services/syncService.js';

dotenv.config();

(async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');

    const collection = mongoose.connection.db.collection('invoices');
    const indexes = await collection.indexes();

    const oldIndex = indexes.find(i => i.key?.invoiceId === 1 && !i.key?.realmId);
    if (oldIndex) {
      await collection.dropIndex('invoiceId_1');
      console.log('🗑️ Dropped old unique index on invoiceId');
    } else {
      console.log('✅ No conflicting index found');
    }

    await Invoice.collection.createIndex(
      { invoiceId: 1, realmId: 1 },
      { unique: true }
    );
    console.log('✅ Created compound unique index on { invoiceId, realmId }');

    // ✅ Auto-sync all realmIds
    const companies = await Token.find({ accessToken: { $ne: '' } });

    for (const company of companies) {
      try {
        console.log(`🔄 Syncing invoices for realmId: ${company.realmId}...`);
        const result = await syncCompany(company.access_token, company.realmId);
        console.log(`✅ Synced ${result.invoicesSynced} invoices for ${company.realmId}`);
      } catch (syncErr) {
        console.error(`❌ Sync failed for ${company.realmId}:`, syncErr.message);
      }
    }

    await mongoose.disconnect();
    console.log('✅ All done.');
  } catch (err) {
    console.error('❌ Script error:', err);
    process.exit(1);
  }
})();