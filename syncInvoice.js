import { getInvoiceDetails } from './quickbooksClient.js';
import { updateLocalInventory } from './services/inventoryService.js';

export const syncInvoiceToInventory = async (accessToken, realmId, invoiceId) => {
  try {
    const invoice = await getInvoiceDetails(accessToken, realmId, invoiceId);

    console.log(`🔄 Syncing Invoice ${invoiceId}:`);

    for (const line of invoice.Line) {
      if (line.SalesItemLineDetail) {
        const itemRef = line.SalesItemLineDetail.ItemRef;
        const qty = line.SalesItemLineDetail.Qty;

        const itemId = itemRef.value;  // QuickBooks Item ID
        const itemName = itemRef.name;

        console.log(`- ${itemName} (${itemId}): -${qty}`);

        // 🔁 Update your local inventory
        await updateLocalInventory(itemId, -qty, realmId);
      }
    }
  } catch (error) {
    console.error('❌ Error syncing invoice:', error.response?.data || error.message);
  }
};