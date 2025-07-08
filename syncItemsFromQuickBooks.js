// project/syncItemsFromQuickBooks.js
import axios from 'axios';
import {
  getItemByQuickBooksId,
  createItem,
  updateItemByQuickBooksId
} from './item.js';

export const syncItemsFromQuickBooks = async (accessToken, realmId, db) => {
  try {
    
    const url = `https://sandbox-quickbooks.api.intuit.com/v3/company/${realmId}/query?query=SELECT * FROM Item&minorversion=65`;

    const res = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json'
      }
    });

    const items = res.data.QueryResponse.Item || [];
    console.log(`🔄 Syncing ${items.length} items from QuickBooks...`);

    for (const qbItem of items) {
      const quickbooksId = qbItem.Id;
      const existing = await getItemByQuickBooksId(db, quickbooksId);

      const itemData = {
        quickbooksId,
        name: qbItem.Name,
        sku: qbItem.Sku || '',
        quantity: qbItem.QtyOnHand ?? 0,
        price: qbItem.UnitPrice ?? 0,
        unit: qbItem.UnitAbbreviation || '',
        category: qbItem.Type || 'Uncategorized',
        updatedAt: new Date(),
        lastSyncedAt: new Date()
      };

      if (existing) {
        await updateItemByQuickBooksId(db, quickbooksId, itemData);
        console.log(`🔁 Updated: ${itemData.name}`);
      } else {
        itemData.createdAt = new Date();
        await createItem(db, itemData);
        console.log(`✅ Created: ${itemData.name}`);
      }
    }

    console.log('✅ Item sync complete');
  } catch (err) {
    console.error('❌ Failed to sync items:', err.response?.data || err.message);
  }
};
