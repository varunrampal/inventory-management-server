import axios from 'axios';
import Estimate from '../models/estimate.js'; // Assuming you have an Estimate model defined
import { updateItemByQuickBooksId } from '../item.js'; // Adjust the import path as necessary
import { updateLocalInventory } from './inventoryService.js';
import Item from '../models/item.js'; // Assuming you have an Item model defined
import db from '../db.js'; // your MongoDB connection
const connectedDb = await db.connect();

// This function syncs all estimates from QuickBooks to the local database
// It fetches all estimates and updates or creates them in the local inventory
export async function syncEstimatesToDB(accessToken, realmId) {
    const endpoint = `https://sandbox-quickbooks.api.intuit.com/v3/company/${realmId}/query?query=SELECT * FROM Estimate&minorversion=65`;

    try {
        const response = await axios.get(endpoint, {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                Accept: 'application/json'
            }
        });

        const estimates = response.data.QueryResponse.Estimate || [];
        if (!Array.isArray(estimates)) {
            console.warn('⚠️ No estimates found or response is not an array');
            return; // Stop processing if no valid estimates
        }
        console.log(`✅ Syncing ${estimates.length} estimates`);
        // Save each estimate to the local database
        for (const estimate of estimates) {
            const items = (estimate.Line || [])
                .filter(line => line.SalesItemLineDetail)
                .map(line => {
                    const itemRef = line.SalesItemLineDetail.ItemRef;
                    const qty = line.SalesItemLineDetail.Qty || line.Qty || 1;
                    return {
                        itemId: itemRef?.value,
                        name: itemRef?.name,
                        quantity: qty,
                        rate: line.Amount / qty,
                        amount: line.Amount
                    };
                });

            const status = estimate.status || 'Active'; // Optional field fallback

            await Estimate.findOneAndUpdate(
                { estimateId: estimate.Id, realmId: realmId },
                {
                    $set: {
                        customerName: estimate.CustomerRef?.name,
                        txnDate: estimate.TxnDate,
                        totalAmount: estimate.TotalAmt,
                        status,
                        items,
                        raw: estimate
                    }
                },
                { upsert: true, new: true }
            );
        }

        console.log(`✅ Synced ${estimates.length} estimates`);
    } catch (err) {
        console.error('❌ Error syncing estimates:', err.response?.data || err.message);
        throw err;
    }
}

// This function syncs a specific estimate to the local inventory
// It fetches the estimate details from QuickBooks and updates the local inventory
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
                const itemName = itemRef.name;

                console.log(`🔍 Estimate includes item ${itemName} x${qty}`);

                await updateLocalInventory(itemId, -qty);


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

// This function fetches the details of a specific estimate from QuickBooks
// It returns the estimate object containing all relevant information
export const getEstimateDetails = async (accessToken, realmId, estimateId) => {

    console.log(`Fetching Estimate ${estimateId} for Realm ${realmId} and Access Token ${accessToken}`);
    const url = `https://sandbox-quickbooks.api.intuit.com/v3/company/${realmId}/estimate/${estimateId}`;

    const res = await axios.get(url, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
        },
    });

    return res.data.Estimate;
};

export const saveEstimateInLocalInventory = async (estimate, realmId) => {
    console.log('estimate:', estimate);

    console.log('estimate.Line:', estimate.Line);
    await Estimate.create({
        estimateId: estimate.Id,
        customerName: estimate.CustomerRef?.name || 'Unknown',
        txnDate: estimate.TxnDate,
        totalAmount: estimate.TotalAmt,
        realmId,
        items: Array.isArray(estimate.Line)
            ? estimate.Line
                .filter(line => line.SalesItemLineDetail)
                .map(line => ({
                    name: line.SalesItemLineDetail.ItemRef?.name || 'Unnamed',
                    itemId: line.SalesItemLineDetail.ItemRef?.value,
                    quantity: line.SalesItemLineDetail.Qty || 0,
                    rate: line.SalesItemLineDetail.UnitPrice || 0,
                    amount: line.SalesItemLineDetail.Amount || 0
                }))
            : [],
        raw: estimate
    });


    console.log(`✅ Saved estimate ${estimate.Id} for customer ${estimate.CustomerRef?.name}`);
};

export async function syncUpdatedEstimate(token, realmId, estimateId) {
  const res = await fetch(`https://sandbox-quickbooks.api.intuit.com/v3/company/${realmId}/estimate/${estimateId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json'
    }
  });
  // Check if the response is ok
  if (!res.ok) {
    console.error(`Failed to fetch estimate ${estimateId}:`, await res.text());
    return;
  }
    // Parse the response as JSON
  const estimate = (await res.json()).Estimate;

    // Lookup old estimate from local DB
  const oldEstimate = await Estimate.findOne({ estimateId });

  console.log(`estimate in local db: ${JSON.stringify(oldEstimate)}`);

  // Reverse old quantities
  for (const item of oldEstimate.items) {
    const qty = Number(item.quantity) || 0;
    console.log(`Reversing quantity for item: ${item.name}, quantity: ${qty}`);
    // Update the item quantity in the local inventory
    await connectedDb.collection('item').updateOne({ name: item.name }, { $inc: { quantity: qty} });
  }

  console.log(`Estimate Line from quickbooks: ${JSON.stringify(estimate.Line)}`);
  // Save new estimate & apply new quantities
  const newItems = estimate.Line.filter(line => line.SalesItemLineDetail).map(line => ({
    name: line.SalesItemLineDetail.ItemRef.name,
    quantity: line.SalesItemLineDetail.Qty
  }));

  console.log(`New items to update: ${JSON.stringify(newItems)}`);

  for (const item of newItems) {
     await connectedDb.collection('item').updateOne({ name: item.name }, { $inc: { quantity: -item.quantity } });
  }

  // Update the estimate in the local database
  await Estimate.updateOne({ estimateId }, { $set: { items: newItems } });
}

// This function reverses the quantities of items in an invoice
// It fetches the estimate from the local database and updates the item quantities accordingly
export async function reverseEstimateQuantities(estimateId) {
  const estimate = await  connectedDb.collection('estimates').findOne({ estimateId });

  if (estimate) {
    for (const item of estimate.items) {
      await connectedDb.collection('item').updateOne({ name: item.name }, { $inc: { quantity: item.quantity } });
    }

    await connectedDb.collection('estimates').deleteOne({ estimateId });
  }
}

