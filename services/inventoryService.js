// inventoryService.js
import db from '../db.js'; // your MongoDB connection
import Invoice from '../models/invoice.js';
const connectedDb = await db.connect();

export const updateLocalInventory = async (itemId, qtyChange) => {
  const collection = connectedDb.collection('item');

  const item = await collection.findOne({ quickbooksId: itemId });

  if (!item) {
    console.warn(`⚠️ Item not found in local inventory: ${itemId}`);
    return;
  }

  const newQty = (item.quantity || 0) + qtyChange;

  await collection.updateOne(
    { quickbooksId: itemId },
    { $set: { quantity: newQty, updatedAt: new Date() } }
  );

  console.log(`✅ Updated ${item.name}: ${item.quantity} → ${newQty}`);
};


  
export const saveInvoiceInLocalInventory = async (invoice,realmId) => {
  console.log('invoice:', invoice);

  console.log('invoice.Line:', invoice.Line);
await Invoice.create({
  invoiceId: invoice.Id,
  customerName: invoice.CustomerRef?.name || 'Unknown',
  txnDate: invoice.TxnDate,
  totalAmount: invoice.TotalAmt,
  realmId,
  items: Array.isArray(invoice.Line)
    ? invoice.Line
        .filter(line => line.SalesItemLineDetail)
        .map(line => ({
          name: line.SalesItemLineDetail.ItemRef?.name || 'Unnamed',
          itemId: line.SalesItemLineDetail.ItemRef?.value,
          quantity: line.SalesItemLineDetail.Qty || 0,
          rate: line.SalesItemLineDetail.UnitPrice  || 0,
          amount: line.SalesItemLineDetail.Amount || 0
        }))
    : [],
  raw: invoice
});


  console.log(`✅ Saved invoice ${invoice.Id} for customer ${invoice.CustomerRef?.name}`);
};

export async function reverseInvoiceQuantities(invoiceId) {
  const invoice = await  connectedDb.collection('invoices').findOne({ invoiceId });

  if (invoice) {
    for (const item of invoice.items) {
      await connectedDb.collection('item').updateOne({ name: item.name }, { $inc: { quantity: item.quantity } });
    }

    await connectedDb.collection('invoices').deleteOne({ invoiceId });
  }
}
