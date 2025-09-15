// project/syncItemsFromQuickBooks.js
import axios from 'axios';
import Item from '../models/item.js'
import {
  getItemByQuickBooksId,
  createItem,
  updateItemByQuickBooksId,
  createOrUpdateItemInDB,
  deleteItemByQuickBooksId
} from '../item.js';

  const QB_BASE_URL =
      process.env.QUICKBOOKS_ENV === "production"
        ? "https://quickbooks.api.intuit.com"
        : "https://sandbox-quickbooks.api.intuit.com";

const DEFAULT_PAGE_SIZE = 1000;     // QBO max per page
const DEFAULT_MINOR_VERSION = 65;   // adjust if needed
const MAX_RETRIES = 3;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));


/**
 * Low-level POST to QBO /query with retries on 429/5xx
 */
async function qboQuery({ baseUrl, headers, sql, attempt = 0 }) {
  try {
    const { data } = await axios.post(baseUrl, sql, {
      headers,
      timeout: 30000,
      // IMPORTANT: body must be plain text, not JSON
    });
    return data?.QueryResponse?.Item ?? [];
  } catch (err) {
    const status = err.response?.status;
    const body = err.response?.data;
    console.error("QBO QUERY FAILED", {
      status,
      sql,
      body: typeof body === "object" ? JSON.stringify(body) : body,
    });

    // Retry on throttling or transient server errors
    if ((status === 429 || (status >= 500 && status < 600)) && attempt < MAX_RETRIES) {
      const delay = Math.pow(2, attempt) * 400 + Math.random() * 200;
      console.warn(`Retrying QBO query in ${Math.round(delay)}ms (attempt ${attempt + 1})`);
      await sleep(delay);
      return qboQuery({ baseUrl, headers, sql, attempt: attempt + 1 });
    }
    throw err;
  }
}

/**
 * Map a QBO Item to your Item schema fields (no 'location' set here).
 */
function toItemDoc(qb, realmId) {
  return {
    itemId: String(qb.Id),
    realmId,
    name: qb.Name || "",
    sku: qb.Sku || qb.FullyQualifiedName || "",
    description: qb.Description || "",
    quantity: typeof qb.QtyOnHand === "number" ? qb.QtyOnHand : 0,
    unitPrice: qb.UnitPrice ?? qb.SalesPrice ?? qb.Price ?? 0,
    type: qb.Type || "NonInventory",       // fits your enum
    active: qb.Active !== false,           // default true
    raw: qb,                               // keep full source
    updatedAt: new Date(),                 // your schema has timestamps; this is harmless
  };
}

/**
 * Pulls all QBO Items (paged) and upserts into MongoDB.
 * @param {string} accessToken - OAuth bearer token
 * @param {string} realmId     - QBO company ID
 * @param {object} opts
 * @param {boolean} [opts.includeInactive=true] - include inactive items too
 * @param {number}  [opts.pageSize=1000]        - up to 1000
 * @param {number}  [opts.minorVersion=65]      - QBO minorversion
 * @returns {{ total: number }} count of processed items
 */
export async function syncItemsFromQuickBooks(
  accessToken,
  realmId,
  { includeInactive = true, pageSize = DEFAULT_PAGE_SIZE, minorVersion = DEFAULT_MINOR_VERSION } = {}
) {
  if (!accessToken || !realmId) {
    throw new Error("accessToken and realmId are required");
  }

  // Ensure QB_BASE_URL is defined in your environment or module scope.
  const baseUrl = `${QB_BASE_URL}/v3/company/${realmId}/query?minorversion=${minorVersion}`;
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
    "Content-Type": "application/text; charset=utf-8",
  };

  // ---- 1) Probe with a minimal one-liner to surface auth/header/parser issues early
  await qboQuery({
    baseUrl,
    headers,
    sql: "SELECT Id, Name FROM Item STARTPOSITION 1 MAXRESULTS 1",
  });

  // ---- 2) Paginated fetch + bulk upsert loop
  let start = 1;
  let total = 0;

  while (true) {
    // Build SQL as a single line (avoids hidden newline/whitespace parser issues)
    let sql = ["SELECT * FROM Item", `STARTPOSITION ${start}`, `MAXRESULTS ${pageSize}`].join(" ");

    let items;
    try {
      items = await qboQuery({ baseUrl, headers, sql });
    } catch (_) {
      // Parser fallback: add explicit boolean clause (some tenants are picky)
      sql = includeInactive
        ? ["SELECT * FROM Item", "WHERE Active IN (true,false)", `STARTPOSITION ${start}`, `MAXRESULTS ${pageSize}`].join(" ")
        : ["SELECT * FROM Item", "WHERE Active = true", `STARTPOSITION ${start}`, `MAXRESULTS ${pageSize}`].join(" ");
      items = await qboQuery({ baseUrl, headers, sql });
    }

    if (!items.length) break;

    // Prepare bulk upserts
    const ops = items.map(qb => {
      const doc = toItemDoc(qb, realmId);
      return {
        updateOne: {
          filter: { itemId: doc.itemId, realmId: doc.realmId },
          update: { $set: doc, $setOnInsert: { createdAt: new Date() } },
          upsert: true,
        },
      };
    });

    if (ops.length) {
      await Item.bulkWrite(ops, { ordered: false });
    }

    total += items.length;
    start += items.length;               // advance by actual count returned
    if (items.length < pageSize) break;  // last page reached
    // Optional courtesy delay to be nice to the API:
    // await sleep(150);
  }

  console.log(`✅ Item sync complete. Total processed: ${total}`);
  return { total };
}

// export async function syncItemsFromQuickBooks(accessToken, realmId) {
//   try {

//     console.log('AccessToken:', accessToken);

//     // const url = `https://sandbox-quickbooks.api.intuit.com/v3/company/${realmId}/query?query=SELECT * FROM Item&minorversion=65`;

//    const url = `${QB_BASE_URL}/v3/company/${realmId}/query?query=SELECT * FROM Item&minorversion=65`;

//    const res = await axios.get(url, {
//       headers: {
//         Authorization: `Bearer ${accessToken}`,
//         Accept: 'application/json'
//       }
//     });

//     const items = res.data.QueryResponse.Item || [];
//     console.log(`🔄 Syncing ${items.length} items from QuickBooks...`);

//     for (const qbItem of items) {
//       const quickbooksId = qbItem.Id;
//       const existing = await getItemByQuickBooksId(quickbooksId, realmId);

//       const itemData = {
//         quickbooksId,
//         realmId,
//         name: qbItem.Name,
//         sku: qbItem.Sku || '',
//         quantity: qbItem.QtyOnHand ?? 0,
//         price: qbItem.UnitPrice ?? 0,
//         unit: qbItem.UnitAbbreviation || '',
//         category: qbItem.Type || 'Uncategorized',
//         updatedAt: new Date(),
//         lastSyncedAt: new Date()
//       };

//       if (existing) {
//         await updateItemByQuickBooksId(quickbooksId, itemData);
//         console.log(`🔁 Updated: ${itemData.name}`);
//       } else {
//         itemData.createdAt = new Date();
//         await createItem(itemData);
//         console.log(`✅ Created: ${itemData.name}`);
//       }
//     }

//     console.log('✅ Item sync complete');
//   } catch (err) {
//     console.error('❌ Failed to sync items:', err.response?.data || err.message);
//   }
// };

// export async function syncItemsFromQuickBooks(accessToken, realmId) {
//   const base = `${QB_BASE_URL}/v3/company/${realmId}/query?minorversion=65`;
//   let start = 1;
//   let total = 0;

//   try {
//     while (true) {
//       const sql = `SELECT * FROM Item WHERE Active IN (true, false) STARTPOSITION ${start} MAXRESULTS ${QBO_PAGE_SIZE}`;
//        const { data } = await axios.post(base, sql, {
//         headers: {
//           Authorization: `Bearer ${accessToken}`,
//           Accept: "application/json",
//           "Content-Type": "text/plain",
//         },
//         timeout: 30000,
//       });

//       const items = data?.QueryResponse?.Item ?? [];
//       if (items.length === 0) break;

//       const ops = items.map(qb => {
//         const doc = {
//           itemId: String(qb.Id),
//           realmId,
//           name: qb.Name || "",
//           sku: qb.Sku || qb.FullyQualifiedName || "",
//           description: qb.Description || "",
//           quantity: typeof qb.QtyOnHand === "number" ? qb.QtyOnHand : 0,
//           unitPrice: qb.UnitPrice ?? qb.SalesPrice ?? 0,
//           type: qb.Type || "NonInventory",
//           active: qb.Active !== false,
//           raw: qb,
//           updatedAt: new Date(),
//           lastSyncedAt: new Date(),
//         };
//         return {
//           updateOne: {
//             filter: { itemId: doc.itemId, realmId: doc.realmId },
//             update: { $set: doc, $setOnInsert: { createdAt: new Date() } },
//             upsert: true,
//           },
//         };
//       });

//       await Item.bulkWrite(ops, { ordered: false });
//       total += items.length;

//       if (items.length < QBO_PAGE_SIZE) break;
//       start += items.length;
//       // Optional courtesy backoff:
//       // await new Promise(r => setTimeout(r, 150));
//     }

//     console.log(`✅ Item sync complete. Total processed: ${total}`);
//   } catch (err) {
//     //console.error("❌ Failed to sync items:", err.response?.data || err.message);
//     if (err.response) {
//     console.error("QBO ERROR status:", err.response.status);
//     console.error("QBO ERROR body:", JSON.stringify(err.response.data, null, 2));
//   } else {
//     console.error("QBO ERROR:", err.message);
//   }
//   }
// }


export const getItemDetailsFromQB = async (accessToken, realmId, itemId) => {

  console.log(`Fetching Item ${itemId} for Realm ${realmId} and Access Token ${accessToken}`);
  const url = `${QB_BASE_URL}/v3/company/${realmId}/item/${itemId}`;

  const res = await axios.get(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });

  const qbItem = res.data?.Item;
  console.log(`Fetched Item: ${qbItem}`);
  return qbItem;
};

export const createOrUpdateItem = async (itemDetails, realmId) => {

  await createOrUpdateItemInDB(itemDetails, realmId);

  console.log(`✅ Item "${itemDetails.Name}" created/updated in local DB.`);
};

export const deleteItem = async (quickbooksId) => {
  try {
    await deleteItemByQuickBooksId(quickbooksId);
    console.log(`✅ Item with QuickBooks ID ${quickbooksId} deleted from local DB.`);
  } catch (err) {
    console.error(`❌ Failed to delete item with QuickBooks ID ${quickbooksId}:`, err.message);
  }
}
