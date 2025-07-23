import mongoose from 'mongoose';
import Estimate from '../models/estimate.js'; // Adjust path as needed
import dotenv from 'dotenv';

dotenv.config();

(async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');

    const indexes = await mongoose.connection.db.collection('estimates').indexes();

    // 1. Drop the old `estimateId` index if it exists
    const oldIndex = indexes.find(i => i.key && i.key.estimateId === 1 && !i.key.realmId);
    if (oldIndex) {
      await mongoose.connection.db.collection('estimates').dropIndex('estimateId_1');
      console.log('🗑️ Dropped old unique index on estimateId');
    } else {
      console.log('✅ No conflicting index on estimateId found');
    }

    // 2. Create the compound unique index
    await Estimate.collection.createIndex(
      { estimateId: 1, realmId: 1 },
      { unique: true }
    );
    console.log('✅ Created compound unique index on { estimateId, realmId }');

    // 3. (Optional) Trigger re-sync logic here
    // await syncQuickBooksData(token.accessToken, token.realmId);

    await mongoose.disconnect();
    console.log('✅ Done.');
  } catch (err) {
    console.error('❌ Error fixing index:', err.message);
    process.exit(1);
  }
})();
