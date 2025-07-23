// invoiceService.js
import db from '../db.js'; // your MongoDB connection
import Invoice from '../models/invoice.js';
import axios from 'axios';
const connectedDb = await db.connect();

export async function saveInvoiceInLocalInventory(invoiceData) {
  const invoice = new Invoice(invoiceData);
  await connectedDb.collection('invoices').insertOne(invoice);
}

export async function getInvoiceDetails(invoiceId) {
  return await connectedDb.collection('invoices').findOne({ _id: new ObjectId(invoiceId) });
}

// This function syncs all invoices from QuickBooks to the local database
// It fetches all invoices and updates or creates them in the local inventory
export async function syncInvoicesToDB(accessToken, realmId) {
  const url = `https://sandbox-quickbooks.api.intuit.com/v3/company/${realmId}/query?query=SELECT * FROM Invoice&minorversion=65`;

  const response = await axios.get(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json'
    }
  });

  const invoices = response.data.QueryResponse.Invoice || [];

  if (!Array.isArray(invoices)) {
    console.warn('⚠️ No invoices found or response is not an array');
    return; // Stop processing if no valid invoices
  }

  console.log(`✅ Syncing ${invoices.length} invoices for realmId: ${realmId}`);
  // Save each invoice to the local database  
  for (const invoice of invoices) {
  //  await connectedDb.collection('invoices').findOneAndUpdate(
    // await Invoice.findOneAndUpdate(
    //   { invoiceId: invoice.Id, realmId },
    //   {
    //   $set: {
    //     invoiceId: invoice.Id,
    //     customerName: invoice.CustomerRef?.name,
    //     txnDate: invoice.TxnDate,
    //     totalAmount: invoice.TotalAmt,
    //     realmId,
    //     raw: invoice
    //   }
    //   },
    //   { upsert: true, new: true, setDefaultsOnInsert: true}
    // );

     await Invoice.findOneAndUpdate(
      { invoiceId: invoice.Id, realmId: realmId },
      {
      $set: {
        customerName: invoice.CustomerRef?.name,
        txnDate: invoice.TxnDate,
        totalAmount: invoice.TotalAmt,
        raw: invoice
      }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true}
    );
  }
   console.log(`✅ Synced ${invoices.length} invoices for realmId: ${realmId}`);
}