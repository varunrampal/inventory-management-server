// inventoryService.js
import db from '../db.js'; // your MongoDB connection
import Invoice from '../models/invoice.js';
import Item from '../models/item.js';
// const connectedDb = await db.connect();

export const updateLocalInventory = async (itemId, qtyChange, realmId) => {
  // const collection = connectedDb.collection('items');
  //const item = await collection.findOne({ itemId: itemId, realmId: realmId });
  const item = await Item.findOne({ itemId: itemId, realmId: realmId });

  // if (!item) {
  //   console.warn(`⚠️ Item not found in local inventory: ${itemId}`);
  //   return;
  // }

 if (!item) {
  console.warn(`⚠️ Item not found in local inventory: ${itemId}`);
// ✅ Create new item with qtyChange as starting quantity
    // const newItem = new Item({
    //   itemId,
    //   realmId,
    //   name: 'Unnamed Item', // or use external metadata if available
    //   quantity: qtyChange,
    //   createdAt: now,
    //   updatedAt: now
    // });

    // await newItem.save();
    return null;

    console.log(`➕ Created new item ${itemId} with quantity ${qtyChange}`);
  }else{

      const newQty = (item.quantity || 0) + qtyChange;

  await Item.updateOne(
    { itemId: itemId, realmId: realmId },
    { $set: { quantity: newQty, updatedAt: new Date() } }
  );


//  await collection.updateOne(
//     { itemId: itemId, realmId: realmId },
//     { $set: { quantity: newQty, updatedAt: new Date() } }
//   );


  console.log(`✅ Updated ${item.name}: ${item.quantity} → ${newQty}`);
}
}

export const saveInvoiceInLocalInventory = async (invoice, realmId) => {
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

// This function reverses the quantities of items in an invoice
// It finds the invoice by its ID and realmId, then updates the quantities of each item
export async function reverseInvoiceQuantities(invoiceId, realmId) {
  //const invoice = await  connectedDb.collection('invoices').findOne({ invoiceId, realmId });
   const invoice = await  Invoice.findOne({ invoiceId, realmId });

  if (invoice) {
    for (const item of invoice.items) {
      //await connectedDb.collection('items').updateOne({ itemId: item.itemId, realmId: realmId }, { $inc: { quantity: item.quantity } });
      await Item.updateOne({ itemId: item.itemId, realmId: realmId }, { $inc: { quantity: item.quantity } });
    }
    //await connectedDb.collection('invoices').deleteOne({ invoiceId });
    await Invoice.deleteOne({ invoiceId });
  }
}
