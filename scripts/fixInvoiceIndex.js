import mongoose from 'mongoose';
import Invoice from '../models/invoice.js'; // Adjust path as needed
import dotenv from 'dotenv';

dotenv.config();

(async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');

    const indexes = await mongoose.connection.db.collection('invoices').indexes();

    // 1. Drop the old `invoiceId` index if it exists
    const oldIndex = indexes.find(i => i.key && i.key.invoiceId === 1 && !i.key.realmId);
    if (oldIndex) {
      await mongoose.connection.db.collection('invoices').dropIndex('invoiceId_1');
      console.log('🗑️ Dropped old unique index on invoiceId');
    } else {
      console.log('✅ No conflicting index on invoiceId found');
    }

    // 2. Create the compound unique index
    await Invoice.collection.createIndex(
      { invoiceId: 1, realmId: 1 },
      { unique: true }
    );
    console.log('✅ Created compound unique index on { invoiceId, realmId }');

    // 3. (Optional) Trigger re-sync logic here
    // await syncQuickBooksData(token.accessToken, token.realmId);

    await mongoose.disconnect();
    console.log('✅ Done.');
  } catch (err) {
    console.error('❌ Error fixing index:', err.message);
    process.exit(1);
  }
})();
