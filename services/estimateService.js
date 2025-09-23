import axios from 'axios';
import mongoose from "mongoose";
import Estimate from '../models/estimate.js'; // Assuming you have an Estimate model defined
import Package from '../models/package.js';
import { qbUrl } from '../integrations/quickbooks.js';
import { updateItemByQuickBooksId } from '../item.js'; // Adjust the import path as necessary
import { updateLocalInventory } from './inventoryService.js';
import Item from '../models/item.js'; // Assuming you have an Item model defined
import db from '../db.js'; // your MongoDB connection
const connectedDb = await db.connect();


const QB_BASE_URL =
  process.env.QUICKBOOKS_ENV === "production"
    ? "https://quickbooks.api.intuit.com"
    : "https://sandbox-quickbooks.api.intuit.com";

const MINOR = "65";           // current safe minor version
const PAGE_SIZE = 1000;       // QBO max is 1000 per page

const SHIPPING_ITEM_ID = process.env.QBO_SHIPPING_ITEM_ID || "SHIPPING_ITEM_ID"

// This function syncs all estimates from QuickBooks to the local database
// It fetches all estimates and updates or creates them in the local inventory
// export async function syncEstimatesToDB(accessToken, realmId) {
//     const endpoint = `${QB_BASE_URL}/v3/company/${realmId}/query?query=SELECT * FROM Estimate&minorversion=65`;

//     try {
//         const response = await axios.get(endpoint, {
//             headers: {
//                 Authorization: `Bearer ${accessToken}`,
//                 Accept: 'application/json'
//             }
//         });

//         console.log('Estimate sync started');
//         const estimates = response.data.QueryResponse.Estimate || [];
//         if (!Array.isArray(estimates)) {
//             console.warn('⚠️ No estimates found or response is not an array');
//             return; // Stop processing if no valid estimates
//         }
//         console.log(`✅ Syncing ${estimates.length} estimates`);
//         // Save each estimate to the local database
//         for (const estimate of estimates) {
//             const items = (estimate.Line || [])
//                 .filter(line => line.SalesItemLineDetail)
//                 .map(line => {
//                     const itemRef = line.SalesItemLineDetail.ItemRef;
//                     const qty = line.SalesItemLineDetail.Qty || line.Qty || 1;
//                     return {
//                         itemId: itemRef?.value,
//                         name: itemRef?.name,
//                         quantity: qty,
//                         rate: line.Amount / qty,
//                         amount: line.Amount
//                     };
//                 });

//             const status = estimate.status || 'Active'; // Optional field fallback

//             await Estimate.findOneAndUpdate(
//                 { estimateId: estimate.Id, realmId: realmId },
//                 {
//                     $set: {
//                         customerName: estimate.CustomerRef?.name,
//                         txnDate: estimate.TxnDate,
//                         totalAmount: estimate.TotalAmt,
//                         status,
//                         items,
//                         raw: estimate
//                     }
//                 },
//                 { upsert: true, new: true }
//             );
//         }

//         console.log(`✅ Synced ${estimates.length} estimates`);
//     } catch (err) {
//         console.error('❌ Error syncing estimates:', err.response?.data || err.message);
//         throw err;
//     }
// }

export function extractItemsFromQBOEstimate(est) {
  const lines = Array.isArray(est?.Line) ? est.Line : [];

  return lines
    .filter(l => l?.DetailType === "SalesItemLineDetail")          // only sales items
    .map(l => {
      const d = l.SalesItemLineDetail || {};
      const itemRef = d.ItemRef || {};
      const qty = Number(d.Qty ?? l?.Qty ?? 0);
      const unitPrice = Number(d.UnitPrice ?? 0);
      const amount = Number(l?.Amount ?? ((qty * unitPrice) || 0));
      const itemId = String(itemRef.value ?? "");

      return {
        itemId,
        name: itemRef.name || l?.Description || "",
        quantity: qty,
        rate: unitPrice || (qty ? amount / qty : 0),
        amount,
      };
    })
    .filter(it =>
      it.itemId &&                      // must have id
      it.itemId !== SHIPPING_ITEM_ID && // exclude shipping sentinel
      it.quantity >= 0                  // keep 0 if you need to show, or use > 0
    );
}

export async function syncEstimatesToDB(accessToken, realmId) {
  console.log("Estimate sync started");

  let start = 1;
  let totalSynced = 0;

  while (true) {
    const sql = `SELECT * FROM Estimate STARTPOSITION ${start} MAXRESULTS ${PAGE_SIZE}`;
    const url = qbUrl(realmId, "query", { minorversion: MINOR });
    let data;

    try {
      const res = await axios.post(url, sql, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
          "Content-Type": "application/text; charset=utf-8",
        },
      });
      data = res.data;
    } catch (err) {
      const payload = err?.response?.data;
      if (payload?.fault?.error?.length) {
        const e0 = payload.fault.error[0];
        console.error("❌ QBO Fault:", {
          code: e0?.code,
          message: e0?.message,
          detail: e0?.detail,
          type: payload?.fault?.type,
        });
      } else {
        console.error("❌ Estimate page fetch error:", payload || err.message);
      }
      throw err;
    }

    const estimates = data?.QueryResponse?.Estimate || [];
    if (!Array.isArray(estimates) || estimates.length === 0) break;

    for (const est of estimates) {
      const items = extractItemsFromQBOEstimate(est);
      const txnStatus = est?.TxnStatus || "Pending";

      await Estimate.findOneAndUpdate(
        { estimateId: String(est.Id), realmId: String(realmId) },
        {
          $set: {
            customerName: est?.CustomerRef?.name || "",
            txnDate: est?.TxnDate || null,
            totalAmount: Number(est?.TotalAmt) || 0,
            txnStatus,
            items,
            raw: est,
          },
          $setOnInsert: {
            estimateId: String(est.Id),
            realmId: String(realmId),
          },
        },
        { upsert: true, new: false }
      );

      totalSynced++;
    }

    if (estimates.length < PAGE_SIZE) break;
    start += PAGE_SIZE;
  }

  console.log(`✅ Synced ${totalSynced} estimates`);
}

// export async function syncEstimatesToDB(accessToken, realmId) {
//   console.log("Estimate sync started");

//   let start = 1;
//   let totalSynced = 0;

//   while (true) {
//     // SQL with pagination
//     const sql = `SELECT * FROM Estimate STARTPOSITION ${start} MAXRESULTS ${PAGE_SIZE}`;
//     const url = qbUrl(realmId, "query", { query: sql, minorversion: MINOR });
//     console.log('URL:', url);
//     let data;
//     try {
//       const res = await axios.get(url, {
//         headers: {
//           Authorization: `Bearer ${accessToken}`,
//            Accept: "application/json",
//            "Content-Type": "application/text; charset=utf-8",
//         },
//       });
//       data = res.data;
//     } catch (err) {
//       // Helpful logging in prod
//       const data = err?.response?.data;
//       if (data?.fault?.error?.length) {
//         const e0 = data.fault.error[0];
//         console.error("❌ QBO Fault:", {
//           code: e0?.code,
//           message: e0?.message,
//           detail: e0?.detail,
//           type: data?.fault?.type,
//         });
//       } else {
//         console.error("❌ Estimate page fetch error:", data || err.message);
//       }
//       throw err;
//     }

//     const estimates = data?.QueryResponse?.Estimate || [];
//     if (!Array.isArray(estimates) || estimates.length === 0) break;

//     // Upsert each estimate
//     for (const est of estimates) {
//       const lines = Array.isArray(est.Line) ? est.Line : [];
//       const items = lines
//         .filter(l => l?.SalesItemLineDetail)
//         .map(l => {
//           const qtyRaw =
//             l?.SalesItemLineDetail?.Qty ??
//             l?.Qty ??
//             1;
//           const qty = Number(qtyRaw) > 0 ? Number(qtyRaw) : 1;
//           const amount = Number(l?.Amount) || 0;
//           const itemRef = l?.SalesItemLineDetail?.ItemRef || {};
//           return {
//             itemId: itemRef.value,
//             name: itemRef.name,
//             quantity: qty,
//             rate: qty ? amount / qty : amount, // guard divide-by-zero
//             amount,
//           };
//         });

//       // Map QBO status to your schema enum (defaults to Pending)
//       // QBO field is TxnStatus: e.g., "Accepted", "Closed", "Pending", "Rejected"
//       const txnStatus = est?.TxnStatus || "Pending";

//       await Estimate.findOneAndUpdate(
//         { estimateId: String(est.Id), realmId: String(realmId) },
//         {
//           $set: {
//             customerName: est?.CustomerRef?.name || "",
//             txnDate: est?.TxnDate || null,
//             totalAmount: Number(est?.TotalAmt) || 0,
//             txnStatus,              // <— matches your schema
//             items,
//             raw: est,
//           },
//           $setOnInsert: {
//             estimateId: String(est.Id),
//             realmId: String(realmId),
//           },
//         },
//         { upsert: true, new: false }
//       );

//       totalSynced++;
//     }

//     // next page
//     if (estimates.length < PAGE_SIZE) break;
//     start += PAGE_SIZE;
//   }

//   console.log(`✅ Synced ${totalSynced} estimates`);
// }

export const syncEstimateToInventory = async (accessToken, realmId, estimateId) => {

  if (!accessToken) throw new Error("syncEstimateToInventory: missing accessToken");
  if (!realmId) throw new Error("syncEstimateToInventory: missing realmId");
  if (!estimateId) throw new Error("syncEstimateToInventory: missing estimateId");
  let estimate;
  
  try {
    const url = `${QB_BASE_URL}/v3/company/${realmId}/estimate/${estimateId}?minorversion=${MINOR}`;
    const res = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
      timeout: 20000,
    });

     estimate = res.data?.Estimate;

    if (!estimate) {
      console.warn(`⚠️ No Estimate returned for ${estimateId}`);
      return;
    }

// Helpful high-level log
  console.log("🔗 Processing Estimate", {
    realmId: String(realmId),
    estimateId: String(estimateId),
    docNumber: estimate.DocNumber || null,
    customer: estimate?.CustomerRef?.name || null,
    status: estimate?.TxnStatus || null,
    shipDate: estimate?.ShipDate || null,
  });

    const lines = Array.isArray(estimate.Line) ? estimate.Line : [];
    
  //let touched = 0;

  for (const ln of lines) {
    const detailType = ln?.DetailType;

    // Skip non sales lines
    if (detailType !== "SalesItemLineDetail") continue;

    const d = ln.SalesItemLineDetail || {};
    const itemRef = d.ItemRef || {};
    const itemId = String(itemRef.value ?? "");

    // Skip “shipping item” rows if you model shipping as an Item
    if (!itemId || itemId === SHIPPING_ITEM_ID) continue;

    // Qty & rate safety
    // Sometimes QBO may omit Qty or UnitPrice; only Qty matters for inventory
    const qty = Number(d.Qty ?? 0);

    // Skip zero/neg quantities
    if (!Number.isFinite(qty) || qty <= 0) continue;

    const itemName = itemRef.name || ln.Description || itemId;

    try {
      // Decrement local inventory by the estimated quantity
      await updateLocalInventory(itemId, -qty, realmId);
     // touched++;
      console.log(`📦 Reserved (estimate) ${qty} of ${itemName} [${itemId}]`);
    } catch (e) {
      console.error(`❌ Local inventory update failed for ${itemId} (${itemName})`, e?.message || e);
      // Continue with others
    }
  }

    console.log(`✅ Estimate ${estimateId} processed`);
  } catch (err) {
    console.error(`❌ Failed to sync estimate ${estimateId}:`, err.response?.data || err.message);
    return 0;
  }finally {
    const docNo = estimate?.DocNumber || String(estimateId);
    console.log(`✅ Estimate ${docNo} processed for Realm ${realmId}`);
  }
};




// This function syncs a specific estimate to the local inventory
// It fetches the estimate details from QuickBooks and updates the local inventory
// export const syncEstimateToInventory = async (accessToken, realmId, estimateId) => {
//   try {
//     const url = `${QB_BASE_URL}/v3/company/${realmId}/estimate/${estimateId}`;

//     const res = await axios.get(url, {
//       headers: {
//         Authorization: `Bearer ${accessToken}`,
//         Accept: 'application/json'
//       },
//     });

//     const estimate = res.data.Estimate;
//     console.log(estimate)

//     for (const line of estimate.Line) {
//       if (line.SalesItemLineDetail) {
//         const itemRef = line.SalesItemLineDetail.ItemRef;
//         const qty = line.SalesItemLineDetail.Qty;
//         const itemId = itemRef.value;
//         const itemName = itemRef.name;

//         console.log(`🔍 Estimate includes item ${itemName} x${qty}`);

//         await updateLocalInventory(itemId, -qty);


//         // You could reserve stock here or just log it
//         // await updateItemByQuickBooksId(db, itemId, {
//         //   lastEstimatedQty: qty,
//         //   lastEstimatedAt: new Date()
//         // });
//       }
//     }

//     console.log(`✅ Estimate ${estimateId} processed`);
//   } catch (err) {
//     console.error(`❌ Failed to sync estimate ${estimateId}:`, err.response?.data || err.message);
//   }
// };

// This function fetches the details of a specific estimate from QuickBooks
// It returns the estimate object containing all relevant information
export const getEstimateDetails = async (accessToken, realmId, estimateId) => {

  console.log(`Fetching Estimate ${estimateId} for Realm ${realmId} and Access Token ${accessToken}`);
  const url = `${QB_BASE_URL}/v3/company/${realmId}/estimate/${estimateId}`;

  const res = await axios.get(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });

  return res.data.Estimate;
};

// export const saveEstimateInLocalInventory = async (estimate, realmId) => {
//   console.log('estimate:', estimate);

//   console.log('estimate.Line:', estimate.Line);
//   await Estimate.create({
//     estimateId: estimate.Id,
//     customerName: estimate.CustomerRef?.name || 'Unknown',
//     txnDate: estimate.TxnDate,
//     totalAmount: estimate.TotalAmt,
//     realmId,
//     items: Array.isArray(estimate.Line)
//       ? estimate.Line
//         .filter(line => line.SalesItemLineDetail)
//         .map(line => ({
//           name: line.SalesItemLineDetail.ItemRef?.name || 'Unnamed',
//           itemId: line.SalesItemLineDetail.ItemRef?.value,
//           quantity: line.SalesItemLineDetail.Qty || 0,
//           rate: line.SalesItemLineDetail.UnitPrice || 0,
//           amount: line.SalesItemLineDetail.Amount || 0
//         }))
//       : [],
//     raw: estimate
//   });


//   console.log(`✅ Saved estimate ${estimate.Id} for customer ${estimate.CustomerRef?.name}`);
// };


// saveEstimateInLocalInventory.js
// export const saveEstimateInLocalInventory = async (estimate, realmId, { shippingItemId } = {}) => {
//   // Defensive parsing
//   const lines = Array.isArray(estimate?.Line) ? estimate.Line : [];

//   // Sales item lines only
//   const salesLines = lines.filter(l => l?.DetailType === 'SalesItemLineDetail');

//   // Build items array (use top-level line.Amount; Qty/UnitPrice from detail)
//   const items = salesLines.map(line => {
//     const d = line.SalesItemLineDetail || {};
//     const ref = d.ItemRef || {};
//     return {
//       name: ref.name || line.Description || 'Unnamed',
//       itemId: ref.value,
//       quantity: Number(d.Qty ?? 0),
//       rate: Number(d.UnitPrice ?? 0),
//       amount: Number(line.Amount ?? 0),
//     };
//   });

//   // Identify shipping lines
//   const isShippingLine = (line) => {
//     const d = line.SalesItemLineDetail || {};
//     const ref = d.ItemRef || {};
//     const nm = (ref.name || line.Description || '').toString();
//     if (shippingItemId && String(ref.value) === String(shippingItemId)) return true;
//     return /shipping|freight|delivery/i.test(nm);
//   };

//   const shippingLines = salesLines.filter(isShippingLine);
//   const shippingAmount = shippingLines.reduce((sum, ln) => sum + Number(ln.Amount ?? 0), 0);

//   // Derive shipping tax (only when a single rate applies)
//   let shippingTax = 0;
//   const taxDetail = estimate?.TxnTaxDetail;
//   if (taxDetail && Array.isArray(taxDetail.TaxLine) && taxDetail.TaxLine.length === 1) {
//     const rate = Number(taxDetail.TaxLine[0]?.TaxLineDetail?.RateValue ?? NaN);
//     if (Number.isFinite(rate)) {
//       shippingTax = Number((shippingAmount * rate / 100).toFixed(2));
//     }
//   }

//   await Estimate.create({
//     estimateId: estimate.Id,
//     realmId,
//     customerName: estimate.CustomerRef?.name || 'Unknown',
//     txnDate: estimate.TxnDate,
//     totalAmount: Number(estimate.TotalAmt ?? 0),
//     txnStatus: estimate.TxnStatus || 'Pending',
//     shippingAmount,
//     shippingTax,
//     items,
//     raw: estimate,
//   });

//   console.log(`✅ Saved estimate ${estimate.Id} for customer ${estimate.CustomerRef?.name}; shipping: $${shippingAmount.toFixed(2)}, tax: $${shippingTax.toFixed(2)}`);
// };


export const saveEstimateInLocalInventory = async (
  estimate,
  realmId,
  { shippingItemId } = {}
) => {
  // Defensive parsing
  const lines = Array.isArray(estimate?.Line) ? estimate.Line : [];

  // Sales item lines only
  const salesLines = lines.filter(l => l?.DetailType === 'SalesItemLineDetail');

  // Helper: identify shipping lines
  const isShippingLine = (line) => {
    const d = line.SalesItemLineDetail || {};
    const ref = d.ItemRef || {};
    const nm = (ref.name || line.Description || '').toString();

    // If a shippingItemId is provided, treat exact ID match as shipping
    if (shippingItemId && String(ref.value) === String(shippingItemId)) return true;

    // Fallback: match by common shipping keywords
    return /shipping|freight|delivery/i.test(nm);
  };

  // Partition into shipping vs non-shipping
  const shippingLines = salesLines.filter(isShippingLine);
  const productLines  = salesLines.filter(l => !isShippingLine(l));

  // Compute shipping amount (sum of shipping lines' top-level Amounts)
  const shippingAmount = shippingLines.reduce(
    (sum, ln) => sum + Number(ln.Amount ?? 0), 0
  );

  // Build items array from non-shipping lines only
  const items = productLines.map(line => {
    const d = line.SalesItemLineDetail || {};
    const ref = d.ItemRef || {};
    return {
      name: ref.name || line.Description || 'Unnamed',
      itemId: ref.value,
      quantity: Number(d.Qty ?? 0),
      rate: Number(d.UnitPrice ?? 0),
      amount: Number(line.Amount ?? 0),
    };
  });

  // Derive shipping tax (simple case: single tax rate on the txn)
  let shippingTax = 0;
  const taxDetail = estimate?.TxnTaxDetail;
  if (taxDetail && Array.isArray(taxDetail.TaxLine) && taxDetail.TaxLine.length === 1) {
    const rate = Number(taxDetail.TaxLine[0]?.TaxLineDetail?.RateValue ?? NaN);
    if (Number.isFinite(rate)) {
      shippingTax = Number((shippingAmount * rate / 100).toFixed(2));
    }
  }

  await Estimate.create({
    estimateId: estimate.Id,
    realmId,
    customerName: estimate.CustomerRef?.name || 'Unknown',
    txnDate: estimate.TxnDate,
    totalAmount: Number(estimate.TotalAmt ?? 0),
    txnStatus: estimate.TxnStatus || 'Pending',
    shippingAmount,
    shippingTax,
    items,
    raw: estimate,
  });

  console.log(
    `✅ Saved estimate ${estimate.Id} for ${estimate.CustomerRef?.name}; ` +
    `shipping: $${shippingAmount.toFixed(2)}, tax: $${shippingTax.toFixed(2)}, ` +
    `items: ${items.length}`
  );
};



export async function syncUpdatedEstimate(token, realmId, estimateId) {
  const res = await fetch(`${QB_BASE_URL}/v3/company/${realmId}/estimate/${estimateId}`, {
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

  //console.log(`✅ Fetched updated estimate ${JSON.stringify(await res.json())} from QuickBooks`);
  // Parse the response as JSON
  const estimate = (await res.json()).Estimate;

  //console.log( `Updating estimate ${estimate} in local inventory...`);

  // Lookup old estimate from local DB
  const oldEstimate = await Estimate.findOne({ estimateId, realmId });

  //console.log(`estimate in local db: ${JSON.stringify(oldEstimate)}`);

  // Reverse old quantities
  for (const item of oldEstimate.items) {
    const qty = Number(item.quantity) || 0;
    console.log(`Reversing quantity for item: ${item.name}, quantity: ${qty}`);
    // Update the item quantity in the local inventory
    await connectedDb.collection('items').updateOne({ name: item.name, realmId }, { $inc: { quantity: qty } });
  }

  //console.log(`Estimate Line from quickbooks: ${JSON.stringify(estimate.Line)}`);
  // Save new estimate & apply new quantities
  const newItems = estimate.Line.filter(line => line.SalesItemLineDetail).map(line => ({
    name: line.SalesItemLineDetail.ItemRef.name,
    quantity: line.SalesItemLineDetail.Qty
  }));

  console.log(`New items to update: ${JSON.stringify(newItems)}`);

  for (const item of newItems) {
    await connectedDb.collection('items').updateOne({ name: item.name, realmId }, { $inc: { quantity: -item.quantity } });
  }

  // Update the estimate in the local database
  await Estimate.updateOne(
    { estimateId, realmId },
    {
      $set: {
        items: newItems,
        txnStatus: estimate.TxnStatus,
        'raw.TxnStatus': estimate.TxnStatus,
        totalAmount: estimate.TotalAmt,
        updatedAt: new Date()
      }
    }
  );
}

// This function reverses the quantities of items in an invoice
// It fetches the estimate from the local database and updates the item quantities accordingly
export async function reverseEstimateQuantities(estimateId) {
  const estimate = await connectedDb.collection('estimates').findOne({ estimateId });

  if (estimate) {
    for (const item of estimate.items) {
      await connectedDb.collection('items').updateOne({ name: item.name, realmId: estimate.realmId }, { $inc: { quantity: item.quantity } });
    }

    await connectedDb.collection('estimates').deleteOne({ estimateId });
  }
}

export function computeRemainingQuantities(estimate) {
  // returns Map<itemId, {remaining, lineRef}>
  const map = new Map();
  for (const line of estimate.items || []) {
    const ordered = Number(line.quantity || 0);
    const fulfilled = Number(line.fulfilled || 0);
    map.set(line.itemId, {
      remaining: Math.max(0, ordered - fulfilled),
      lineRef: line
    });
  }
  return map;
}

export function computeRemainingQuantitiesOfEstimate(estimateDoc) {
  const map = new Map();

  const items = Array.isArray(estimateDoc?.items) ? estimateDoc.items : [];
  for (const line of items) {
    const ordered = Number(line?.quantity ?? 0);
    const fulfilled = Number(line?.fulfilled ?? 0);
    const remaining = Math.max(0, ordered - fulfilled);

    // Prefer itemId; fall back to name so older docs still work
    const key = line?.itemId != null ? String(line.itemId) : String(line?.name ?? '').trim();
    if (!key) continue; // skip totally malformed rows

    map.set(key, { remaining, lineRef: line });
  }
  return map;
}


export function findItemIdInRaw(raw, itemName) {
  const ln = (raw?.Line || []).find(
    l => l.DetailType === 'SalesItemLineDetail' &&
      String(l.SalesItemLineDetail?.ItemRef?.name || '').trim() === itemName
  );
  return ln?.SalesItemLineDetail?.ItemRef?.value ? String(ln.SalesItemLineDetail.ItemRef.value) : null;
}
export function findRateInRaw(raw, itemName) {
  const ln = (raw?.Line || []).find(
    l => l.DetailType === 'SalesItemLineDetail' &&
      String(l.SalesItemLineDetail?.ItemRef?.name || '').trim() === itemName
  );
  return ln?.SalesItemLineDetail?.UnitPrice;
}


// **
//  * Builds a Map to look up an estimate line by:
//  *  - itemId (exact string)
//  *  - item name (case-insensitive)
//  * Returns: Map key -> { remaining, lineRef }

export function buildRemainingIndex(estimate) {
  const map = new Map();
  const items = Array.isArray(estimate?.items) ? estimate.items : [];

  for (const line of items) {
    const ordered = Number(line?.quantity ?? 0);
    const fulfilled = Number(line?.fulfilled ?? 0);
    const remaining = Math.max(0, ordered - fulfilled);
    const name = String(line?.name ?? '').trim();
    const itemId = (line?.itemId != null) ? String(line.itemId) : null;

    const value = { remaining, lineRef: line };

    // key by itemId (exact) if present
    if (itemId) map.set(itemId, value);

    // key by lowercased name for fallback
    if (name) map.set(name.toLowerCase(), value);
  }
  return map;
}


// export async function recomputeEstimateFulfilled({ estimateId, realmId }) {
//   // Sum this estimate's package quantities by item key
//   const totals = await Package.aggregate([
//     { $match: { estimateId, realmId } },
//     { $project: { pairs: { $objectToArray: "$quantities" } } },
//     { $unwind: "$pairs" },
//     { $group: { _id: "$pairs.k", total: { $sum: { $toDouble: "$pairs.v" } } } },
//   ]);
//   const totalsByKey = Object.fromEntries(totals.map(t => [String(t._id), t.total]));
//   console.log(`Recomputing fulfilled quantities for estimate ${estimateId} in realm ${realmId}`);
//   const est = await Estimate.findOne({ estimateId, realmId });
//   if (!est) return;

//   let changed = false;

//   for (const it of est.items || []) {
//     // 🔒 ensure itemId exists (temporary fallback to name)
//     if (!it.itemId) { it.itemId = it.name; changed = true; }

//     const key = String(it.itemId);
//     const summed = Number(totalsByKey[key] || 0);
//     const ordered = Number(it.quantity ?? Infinity);

//     console.log(`Ordered quantity for item ${key}:`, ordered);
//     console.log(`Summed quantity for item ${key}:`, summed);

//     const nextFulfilled = Math.min(summed, ordered);
//     console.log(`Next fulfilled quantity for item ${key}:`, nextFulfilled);
//     if (it.fulfilled !== nextFulfilled) {
//       it.fulfilled = nextFulfilled;
//       changed = true;
//     }
//   }
//   console.log(changed ? 'Changes detected in fulfilled quantities.' : 'No changes in fulfilled quantities.');
//   console.log(`Recomputed fulfilled quantities for estimate ${estimateId}:`, est.items);

//   if (changed) est.markModified("items");
//   // Guard right before save
//   for (const [i, it] of (est.items || []).entries()) {
//     if (!it.itemId) throw new Error(`Estimate items missing itemId at index ${i}`);
//   }

//   console.log(`Saving updated estimate ${estimateId} in realm ${realmId}`);
//   await est.save();
// }


export async function recomputeEstimateFulfilled({ estimateId, realmId }) {
  // 1) Sum this estimate's package quantities by item key (string keys)
  const totals = await Package.aggregate([
    { $match: { estimateId, realmId } },
    { $project: { pairs: { $objectToArray: "$quantities" } } },
    { $unwind: "$pairs" },
    { $group: { _id: { $toString: "$pairs.k" }, total: { $sum: { $toDouble: "$pairs.v" } } } },
  ]);
  const totalsByKey = Object.fromEntries(totals.map(t => [String(t._id), Number(t.total || 0)]));

  console.log(`Recomputing fulfilled for estimate ${estimateId} / realm ${realmId}`);

  const est = await Estimate.findOne({ estimateId, realmId });
  if (!est) return;

  let changed = false;
  let repaired = false;

  // 2) Heal/clean items list BEFORE computing fulfilled
  // - ensure each item has itemId (prefer raw ItemRef.value, then existing itemId, then name)
  // - ensure name present (from raw or fallback to itemId)
  // - drop truly corrupt blanks (no itemId and no name)
  const healed = [];
  for (const [idx, rawIt] of (est.items || []).entries()) {
    if (!rawIt || typeof rawIt !== "object") {
      console.warn(`[heal] Dropping non-object item at index ${idx}:`, rawIt);
      repaired = true;
      continue;
    }

    const itemRefVal =
      rawIt?.raw?.SalesItemLineDetail?.ItemRef?.value ??
      rawIt?.SalesItemLineDetail?.ItemRef?.value; // in case raw was flattened

    let itemId = rawIt.itemId ?? itemRefVal ?? rawIt.name ?? null;
    let name =
      rawIt.name ??
      rawIt?.raw?.SalesItemLineDetail?.ItemRef?.name ??
      rawIt?.SalesItemLineDetail?.ItemRef?.name ??
      (itemId != null ? String(itemId) : null);

    if (!itemId && !name) {
      console.warn(`[heal] Dropping empty item at index ${idx}:`, rawIt);
      repaired = true;
      continue;
    }

    // normalize
    itemId = String(itemId);
    if (!rawIt.itemId) repaired = true;
    if (!rawIt.name) repaired = true;

    const it = {
      ...rawIt,
      itemId,
      name: name ?? itemId,
      quantity: Number(rawIt.quantity ?? 0),
      fulfilled: Number(rawIt.fulfilled ?? 0),
    };

    healed.push(it);
  }

  if (healed.length !== (est.items || []).length) repaired = true;
  if (repaired) {
    est.items = healed;
    est.markModified("items");
  }

  // 3) Compute fulfilled with caps
  for (const it of est.items) {
    const key = String(it.itemId);
    const summed = Number(totalsByKey[key] || 0);
    const ordered = Number(it.quantity ?? 0);

    // if ordered is missing or non-finite, treat as uncapped
    const hasCap = Number.isFinite(ordered) && ordered > 0;
    const nextFulfilled = hasCap ? Math.min(summed, ordered) : summed;

    if (it.fulfilled !== nextFulfilled) {
      console.log(`[set] item ${key}: ordered=${ordered} summed=${summed} -> fulfilled=${nextFulfilled}`);
      it.fulfilled = nextFulfilled;
      changed = true;
    }
  }

  // 4) Final guard (after healing) — should not trip now
  for (const [i, it] of (est.items || []).entries()) {
    if (!it.itemId) {
      console.error(`Still missing itemId at index ${i} after healing`, it);
      throw new Error(`Estimate items missing itemId at index ${i}`);
    }
  }

  if (changed || repaired) {
    console.log(`Saving updated estimate ${estimateId} (changed=${changed}, repaired=${repaired})`);
    await est.save();
  } else {
    console.log("No changes to save.");
  }
}


export async function recomputeFulfilledForEstimate({ estimateId, realmId }, session) {
  // 1) Sum quantities from non-deleted packages
  const sums = await Package.aggregate([
    { $match: { estimateId, realmId, deletedAt: { $exists: false } } },
    { $unwind: "$items" },
    { $group: { _id: "$items.itemId", total: { $sum: "$items.quantity" } } },
  ]).session(session);

  const sumMap = new Map(sums.map(s => [String(s._id), s.total]));

  // 2) Load estimate (as a Mongoose doc)
  const estimate = await Estimate.findOne({ estimateId, realmId }).session(session);
  if (!estimate) throw new Error("Estimate not found");

  // Optional: quick sanity check so you can clean data later if needed
  const missingIdx = [];
  estimate.items.forEach((it, idx) => {
    if (it.itemId === undefined || it.itemId === null || it.itemId === "") missingIdx.push(idx);
  });
  if (missingIdx.length) {
    console.warn(`Estimate ${estimateId} has items missing itemId at indexes:`, missingIdx);
    // We still proceed; those lines will get fulfilled=0
  }

  // 3) Build a $set object with per-index fulfilled values
  const setPaths = {};
  estimate.items.forEach((it, idx) => {
    const summed = sumMap.get(String(it.itemId)) || 0;
    const nextFulfilled = Math.min(summed, it.quantity ?? summed);
    setPaths[`items.${idx}.fulfilled`] = nextFulfilled;
  });

  // 4) Update only the needed fields to avoid full validation of required paths
  await Estimate.updateOne(
    { _id: estimate._id },
    { $set: setPaths },
    { session, runValidators: false } // <-- bypass full doc validation
  );

  // 5) Return the fresh doc
  return Estimate.findById(estimate._id).session(session);
}


export async function recomputeEstimateFulfilledOnDelete(
  { estimateId, realmId, alsoUpdateStatus = true },
  session = null
) {
  const match = {
    estimateId: String(estimateId),
    realmId: String(realmId),
  };

  // 1) Sum qty per itemId across all remaining packages (hard delete already removed doc)
  const pipeline = [
    { $match: match },
    { $project: { pairs: { $objectToArray: { $ifNull: ["$quantities", {}] } } } },
    { $unwind: "$pairs" },
    {
      $group: {
        _id: "$pairs.k", // item key stored in Package.quantities
        total: {
          $sum: {
            $convert: { input: "$pairs.v", to: "double", onError: 0, onNull: 0 },
          },
        },
      },
    },
  ];
  const agg = Package.aggregate(pipeline);
  if (session) agg.session(session);
  const totals = await agg;

  const totalsByKey = new Map(totals.map(t => [String(t._id), Number(t.total || 0)]));
  const hasTotals = totalsByKey.size > 0; // true if any packages remain

  // 2) Load estimate
  const findQ = Estimate.findOne({ estimateId: String(estimateId), realmId: String(realmId) });
  if (session) findQ.session(session);
  const est = await findQ;
  if (!est) return null;

  // 3) Build minimal $set
  const setPaths = {};
  let allMet = true;

  const toNum = (v, d = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
  };

  (est.items || []).forEach((it, idx) => {
    const ordered = toNum(it?.quantity, 0);

    // Prefer itemId; fall back to name (optional, so we can map future cycles)
    let key = null;
    if (it?.itemId != null) key = String(it.itemId);
    else if (it?.name) {
      key = String(it.name);
      // Optional: backfill itemId for future consistency
      setPaths[`items.${idx}.itemId`] = key;
    }

    let next;
    if (hasTotals) {
      // If there are packages left, only update lines we can map
      if (!key || !totalsByKey.has(key)) {
        // Can't map this row to any package total—leave fulfilled as-is.
        const current = toNum(it?.fulfilled, 0);
        const lineMet = ordered <= 0 ? true : current >= ordered;
        allMet = allMet && lineMet;
        return;
      }
      const summed = toNum(totalsByKey.get(key), 0);
      next = Math.max(0, Math.min(summed, ordered));
    } else {
      // No packages left → zero everything
      next = 0;
    }

    if (toNum(it?.fulfilled, 0) !== next) {
      setPaths[`items.${idx}.fulfilled`] = next;
    }

    const lineMet = ordered <= 0 ? true : next >= ordered;
    allMet = allMet && lineMet;
  });

  // 4) Optional status sync
  if (alsoUpdateStatus && typeof est.txnStatus === "string") {
    const nextStatus = allMet && est.txnStatus !== "Declined" ? "Closed" : est.txnStatus;
    if (nextStatus !== est.txnStatus) setPaths["txnStatus"] = nextStatus;
  }

  if (Object.keys(setPaths).length) {
    await Estimate.updateOne(
      { _id: est._id },
      { $set: setPaths },
      { session, runValidators: false }
    );
  }

  const reloadQ = Estimate.findById(est._id);
  if (session) reloadQ.session(session);
  return await reloadQ.lean();
}



//working previously
// export async function recomputeFulfilledForEstimate({ estimateId, realmId }, session) {
//   // Sum quantities per item from all *active* (non-deleted) packages for this estimate
//   const sums = await Package.aggregate([
//     { $match: { estimateId, realmId, deletedAt: { $exists: false } } },
//     { $unwind: "$items" },
//     { $group: { _id: "$items.itemId", total: { $sum: "$items.quantity" } } },
//   ]).session(session);

//   const sumMap = new Map(sums.map(s => [String(s._id), s.total]));

//   const estimate = await Estimate.findOne({ estimateId, realmId }).session(session);
//   if (!estimate) throw new Error("Estimate not found");

//   estimate.items = estimate.items.map(it => {
//     const summed = sumMap.get(String(it.itemId)) || 0;
//     // Clamp to not exceed ordered quantity if you want
//     const fulfilled = Math.min(summed, it.quantity ?? summed);
//     return { ...it.toObject?.() ?? it, fulfilled };
//   });

//   await estimate.save({ session });
//   return estimate;
// }

// deletes estimate + all its packages atomically
export async function deleteLocalEstimate(estimateId, realmId) {
  const session = await mongoose.startSession();
  try {
    let result = { deletedEstimate: 0, deletedPackages: 0 };

    await session.withTransaction(async () => {
      const est = await Estimate.findOne({ estimateId: String(estimateId), realmId: String(realmId) })
        .session(session);

      if (!est) {
        // Throw inside txn so we abort cleanly
        const err = new Error(`Estimate ${estimateId} not found for realm ${realmId}`);
        err.status = 404;
        throw err;
      }

      // First delete all packages tied to this estimate
      const pkgRes = await Package.deleteMany({
        estimateId: String(estimateId),
        realmId: String(realmId),
      }).session(session);

      // Then delete the estimate itself
      const estRes = await Estimate.deleteOne({
        estimateId: String(estimateId),
        realmId: String(realmId),
      }).session(session);

      result.deletedPackages = pkgRes.deletedCount || 0;
      result.deletedEstimate = estRes.deletedCount || 0;
    });

    console.log(`🗑️ Deleted estimate ${estimateId} and ${result.deletedPackages} package(s) in realm ${realmId}`);
    return result;
  } catch (err) {
    // If we threw a 404 above, keep the status for the route to use
    if (!err.status) err.status = 500;
    console.error("Delete estimate failed:", err);
    throw err;
  } finally {
    session.endSession();
  }
}

