import db from './db.js'; // your MongoDB connection
const connectedDb = await db.connect();

export async function syncUpdatedInvoice(token, realmId, invoiceId) {
  const res = await fetch(`https://sandbox-quickbooks.api.intuit.com/v3/company/${realmId}/invoice/${invoiceId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json'
    }
  });
  // Check if the response is ok
  if (!res.ok) {
    console.error(`Failed to fetch invoice ${invoiceId}:`, await res.text());
    return;
  }
    // Parse the response as JSON
  const invoice = (await res.json()).Invoice;

    // Lookup old invoice from local DB
  const oldInvoice = await connectedDb.collection('invoices').findOne({ invoiceId });

  console.log(`invoice in local db: ${JSON.stringify(oldInvoice)}`);

  // Reverse old quantities
  for (const item of oldInvoice.items) {
    const qty = Number(item.quantity) || 0;
    console.log(`Reversing quantity for item: ${item.name}, quantity: ${qty}`);
    // Update the item quantity in the local inventory    
    await connectedDb.collection('item').updateOne({ name: item.name }, { $inc: { quantity: qty} });
  }


  console.log(`Invoice Line from quickbooks: ${JSON.stringify(invoice.Line)}`);
  // Save new invoice & apply new quantities
  const newItems = invoice.Line.filter(line => line.SalesItemLineDetail).map(line => ({
    name: line.SalesItemLineDetail.ItemRef.name,
    quantity: line.SalesItemLineDetail.Qty
  }));

  console.log(`New items to update: ${JSON.stringify(newItems)}`);

  for (const item of newItems) {
    await connectedDb.collection('item').updateOne({ name: item.name }, { $inc: { quantity: -item.quantity } });
  }

  await connectedDb.collection('invoices').updateOne({ invoiceId }, { $set: { items: newItems } });
}