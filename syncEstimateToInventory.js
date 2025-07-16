// project/syncEstimateToInventory.js
import axios from 'axios';
import { updateItemByQuickBooksId } from './item.js';

export const syncEstimateToInventory = async (accessToken, realmId, estimateId) => {
  try {
    const url = `https://sandbox-quickbooks.api.intuit.com/v3/company/${realmId}/estimate/${estimateId}`;

    const res = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json'
      }
    });

    const estimate = res.data.Estimate;
    console.log(estimate)

    for (const line of estimate.Line) {
      if (line.SalesItemLineDetail) {
        const itemRef = line.SalesItemLineDetail.ItemRef;
        const qty = line.SalesItemLineDetail.Qty;
        const itemId = itemRef.value;

        console.log(`🔍 Estimate includes item ${itemRef.name} x${qty}`);

        // You could reserve stock here or just log it
        // await updateItemByQuickBooksId(db, itemId, {
        //   lastEstimatedQty: qty,
        //   lastEstimatedAt: new Date()
        // });
      }
    }

    console.log(`✅ Estimate ${estimateId} processed`);
  } catch (err) {
    console.error(`❌ Failed to sync estimate ${estimateId}:`, err.response?.data || err.message);
  }
};
