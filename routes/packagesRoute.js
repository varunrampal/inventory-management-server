import express from 'express';
import mongoose from "mongoose";
import { DateTime } from "luxon";
import Estimate from '../models/estimate.js';
import Item from '../models/item.js'; // if you want to decrement stock
import Package from '../models/package.js';
import { computeRemainingQuantities, computeRemainingQuantitiesOfEstimate, 
    findItemIdInRaw, 
    findRateInRaw, 
    buildRemainingIndex,
    recomputeEstimateFulfilled,
    recomputeFulfilledForEstimate,
    recomputeEstimateFulfilledOnDelete
} from '../services/estimateService.js'; // Adjust import path as needed
import { nextWeekRange, getWeekRanges, toAddressString  } from "../utils/commonFunctions.js";
import { requireAdmin } from '../middleware/auth.js';

const router = express.Router();
const escapeRe = (s = "") => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// router.get("/packagelist", requireAdmin, async (req, res) => {
//   try {
//     const {
//       search = "",
//       from,
//       to,
//       page = 1,
//       limit = 20,
//       realmId,
//     } = req.query;

//     const pageNum = Math.max(parseInt(page, 10) || 1, 1);
//     const perPage = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 200);
//     const escapeRe = (s = "") => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

//     const filter = {};
//     if (realmId) filter.realmId = realmId;

//     // Shipping date range (inclusive)
//     if (from || to) {
//       filter.shipmentDate = {};
//       if (from) filter.shipmentDate.$gte = new Date(from);
//       if (to) {
//         // make 'to' inclusive end-of-day
//         const end = new Date(to);
//         end.setHours(23, 59, 59, 999);
//         filter.shipmentDate.$lte = end;
//       }
//     }

//     // Single search box matches customerName OR estimateId
//     if (search && search.trim()) {
//       const term = search.trim();
//       const safe = escapeRe(term);

//       // If looks like a pure number, prefer a startsWith on estimateId
//       const estimateStarts = /^[0-9]+$/.test(term)
//          ? { estimateId: new RegExp("^" + safe, "i") }
//         : { estimateId: new RegExp(safe, "i") };

//       filter.$or = [
//          { "snapshot.customerName": new RegExp(safe, "i") },
//         estimateStarts,
//       ];
//     }

//     // Sort: shipmentDate desc, then packageDate desc, then _id desc
//     const sort = { shipmentDate: -1, packageDate: -1, _id: -1 };

//     const [rows, total] = await Promise.all([
//       Package.find(filter)
//         .sort(sort)
//         .skip((pageNum - 1) * perPage)
//         .limit(perPage)
//         .lean(),
//       Package.countDocuments(filter),
//     ]);

//     res.json({
//       data: rows,
//       page: pageNum,
//       limit: perPage,
//       total,
//       hasMore: pageNum * perPage < total,
//     });
//   } catch (err) {
//     console.error("GET /admin/packages error", err);
//     res.status(500).json({ error: "Failed to fetch packages." });
//   }
// });


router.get("/packagelist", requireAdmin, async (req, res) => {
  try {
    const {
      search = "",
      from,
      to,
      page = 1,
      limit = 20,
      realmId,
    } = req.query;

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const perPage = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 200);

    // Build the same match filter you already had
    const match = {};
    if (realmId) match.realmId = realmId;

    if (from || to) {
      match.shipmentDate = {};
      if (from) match.shipmentDate.$gte = new Date(from);
      if (to) {
        const end = new Date(to);
        end.setHours(23, 59, 59, 999);
        match.shipmentDate.$lte = end;
      }
    }

    if (search && search.trim()) {
      const term = search.trim();
      const safe = escapeRe(term);
      const estMatch = /^[0-9]+$/.test(term)
        ? { estimateId: new RegExp("^" + safe, "i") }
        : { estimateId: new RegExp(safe, "i") };

      match.$or = [
        { "snapshot.customerName": new RegExp(safe, "i") },
        estMatch,
      ];
    }

    // Sort same as before
    const sort = { shipmentDate: -1, packageDate: -1, _id: -1 };

    // Collection name for Estimate (Mongoose pluralizes by default)
    const estimateColl = mongoose.model("Estimate").collection.name; // likely "estimates"

    const pipeline = [
      { $match: match },
      { $sort: sort },
      {
        $facet: {
          data: [
            { $skip: (pageNum - 1) * perPage },
            { $limit: perPage },
            // Lookup the related estimate by estimateId + realmId
            {
              $lookup: {
                from: estimateColl,
                let: { eId: "$estimateId", rId: "$realmId" },
                pipeline: [
                  {
                    $match: {
                      $expr: {
                        $and: [
                          { $eq: ["$estimateId", "$$eId"] },
                          { $eq: ["$realmId", "$$rId"] },
                        ],
                      },
                    },
                  },
                  // Project only what you need
                  {
                    $project: {
                      _id: 1,
                      estimateId: 1,
                      realmId: 1,
                      customerName: 1,
                      txnDate: 1,
                      totalAmount: 1,
                      items: 1,
                      txnStatus: 1,
                      // Project multiple possible address field names:
                      billTo: 1,
                      BillAddr: 1,
                      billAddr: 1,
                      shipTo: 1,
                      ShipAddr: 1,
                      shipAddr: 1,
                      docNumber: "$raw.DocNumber"
                    },
                  },
                ],
                as: "estimate",
              },
            },
            { $unwind: { path: "$estimate", preserveNullAndEmptyArrays: true } },
          ],
          meta: [{ $count: "total" }],
        },
      },
      {
        $project: {
          data: 1,
          total: { $ifNull: [{ $arrayElemAt: ["$meta.total", 0] }, 0] },
        },
      },
    ];

    const agg = await Package.aggregate(pipeline).allowDiskUse(true);
    const rows = agg?.[0]?.data ?? [];
    const total = agg?.[0]?.total ?? 0;

    res.json({
      data: rows, // each row now includes an `estimate` object
      page: pageNum,
      limit: perPage,
      total,
      hasMore: pageNum * perPage < total,
    });
  } catch (err) {
    console.error("GET /packagelist error", err);
    res.status(500).json({ error: "Failed to fetch packages." });
  }
});


/**
 * Create a package for an estimate.
 * Body: { realmId, quantities: { [itemId]: number }, notes? }
 */
router.post('/createeeee', async (req, res) => {
    const { estimateId, realmId, quantities = {}, notes, packageDate, shipmentDate, driverName } = req.body;

    if (!realmId) return res.status(400).json({ success: false, message: 'realmId is required' });

    try {
        // 1) Reload estimate fresh to ensure up-to-date remaining
        const estimate = await Estimate.findOne({ estimateId, realmId });
        if (!estimate) return res.status(404).json({ success: false, message: 'Estimate not found' });

        // 2) Compute remaining per line
        const remainingMap = computeRemainingQuantitiesOfEstimate(estimate);
        console.log('Remaining map:', remainingMap);


        // 3) Build package lines by clamping to remaining
        const warnings = [];
        const lines = [];


        // const info = remainingMap.get(String(key).trim())
        // if (!info) {
        //     warnings.push(`Item not found on estimate; skipping.`);
        //     return;
        // }

        for (const lineRef of estimate.items || []) {
            const keyId = lineRef.itemId ? String(lineRef.itemId) : null;
            const keyName = String(lineRef.name || '').trim();

            // read quantity: prefer id, fallback to name
            const requestedRaw = keyId != null
                ? quantities[keyId]
                : quantities[keyName];

            const requested = Math.max(0, Number(requestedRaw ?? 0));
            if (!requested) continue;

            const ordered = Number(lineRef.quantity || 0);
            const fulfilled = Number(lineRef.fulfilled || 0);
            const remaining = Math.max(0, ordered - fulfilled);

            if (remaining <= 0) {
                warnings.push(`Item "${lineRef.name}" is already fully fulfilled; skipping.`);
                continue;
            }

            const toPack = Math.min(requested, remaining);
            if (requested > remaining) {
                warnings.push(`Requested ${requested} of "${lineRef.name}" but only ${remaining} remaining. Packaging ${toPack}.`);
            }

            const itemIdForPackage = keyId ?? findItemIdInRaw(estimate.raw, keyName); // last resort
            const unitRate = Number(lineRef.rate ?? findRateInRaw(estimate.raw, keyName) ?? 0);

            lines.push({
                itemId: itemIdForPackage ?? keyName,        // ensure we always have something to reference
                name: lineRef.name,
                quantity: toPack,
                rate: unitRate,
                amount: unitRate * toPack
            });

            // update fulfilled in-memory
            lineRef.fulfilled = fulfilled + toPack;
        }

        // Object.entries(quantities).forEach(([itemId, requestedRaw]) => {
        //   const requested = Math.max(0, Number(requestedRaw || 0));
        //   if (requested <= 0) return;

        //   const info = remainingMap.get(itemId);
        //   if (!info) {
        //     warnings.push(`Item ${itemId} not found on estimate; skipping.`);
        //     return;
        //   }

        //   const { remaining, lineRef } = info;
        //   if (remaining <= 0) {
        //     warnings.push(`Item "${lineRef.name}" is already fully fulfilled; skipping.`);
        //     return;
        //   }

        //   const toPack = Math.min(requested, remaining);
        //   if (requested > remaining) {
        //     warnings.push(`Requested ${requested} of "${lineRef.name}" but only ${remaining} remaining. Packaging ${toPack}.`);
        //   }

        //   const amount = Number(lineRef.rate || 0) * toPack;

        //   // push to package lines
        //   lines.push({
        //     itemId,
        //     name: lineRef.name,
        //     quantity: toPack,
        //     rate: lineRef.rate,
        //     amount
        //   });
        //   console.log(`Packaging ${toPack} of "${lineRef.name}" (itemId: ${itemId})`);
        //   // update fulfilled on the estimate line
        //   lineRef.fulfilled = Number(lineRef.fulfilled || 0) + toPack;
        // });

        if (lines.length === 0) {
            return res.json({ success: false, message: 'No valid quantities to package', warnings });
        }

        // 4) Persist estimate updates (fulfilled)
        await estimate.save();

        // 5) (Optional) decrement inventory for each packaged line
        // If you want negative allowed, keep as-is; otherwise clamp at 0
        for (const l of lines) {
            await Item.updateOne(
                { itemId: l.itemId, realmId },
                { $inc: { quantity: -l.quantity }, $set: { updatedAt: new Date() } },
                { upsert: true }
            );
        }

        // 6) Create and save Package document
        const totals = {
            lines: lines.reduce((n, l) => n + l.quantity, 0),
            amount: lines.reduce((n, l) => n + (l.amount || 0), 0)
        };

        const pkg = await Package.create({
            estimateId,
            realmId,
            lines,
            notes,
            totals,
            snapshot: {
                customerName: estimate.customerName,
                txnDate: estimate.txnDate
            },
            status: 'Created',
            packageDate: packageDate ? new Date(packageDate) : new Date(),
            shipmentDate: shipmentDate ? new Date(shipmentDate) : undefined,
            driverName
        });

        console.log('Created package:', pkg._id);

        // (Optional) you could immediately create an invoice here, or keep as a separate step

        return res.status(201).json({
            success: true,
            packageId: pkg._id,
            packageCode: pkg.packageCode,
            totals,
            warnings
        });
    } catch (err) {
        console.error('Create package error:', err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});


/**
 * POST /admin/estimates/:estimateId/packages
 * Body: {
 *   realmId: string,
 *   quantities: { [itemIdOrName]: number },
 *   notes?: string,
 *   packageDate?: string(YYYY-MM-DD),
 *   shipmentDate?: string(YYYY-MM-DD),
 *   driverName?: string
 * }
 */
// router.post('/create', async (req, res) => {
//     const {
//     estimateId,
//     realmId,
//     quantities = {},
//     notes,
//     packageDate,
//     shipmentDate,
//     driverName
//   } = req.body || {};

//   if (!realmId) {
//     return res.status(400).json({ success: false, message: 'realmId is required' });
//   }

//   try {
//     // 1) Load fresh estimate (DO NOT use .lean() because we may mutate/save)
//     //const estimate = await Estimate.findOne({ estimateId, realmId });
//     const estimate = await Estimate
//   .findOne({ estimateId, realmId });
  

//     console.log('========================Loaded estimate======================================:', estimate);
//     if (!estimate) {
//       return res.status(404).json({ success: false, message: 'Estimate not found' });
//     }

//     // 2) Build remaining-index that supports lookup by itemId OR by name
//     const remainingIndex = buildRemainingIndex(estimate);

//     // 3) Iterate user-submitted quantities
//     const warnings = [];
//     const packageLines = [];

//     // normalize keys once
//     const entries = Object.entries(quantities || {});
//     for (const [rawKey, requestedRaw] of entries) {
//       const key = String(rawKey ?? '').trim();
//       const requested = Math.max(0, Number(requestedRaw ?? 0));
//       if (!key || requested <= 0) continue;

//       // Lookup by exact key; then fallback to case-insensitive name
//       let entry = remainingIndex.get(key);
//       if (!entry) {
//         entry = remainingIndex.get(key.toLowerCase());
//       }
//       if (!entry) {
//         warnings.push(`Item "${key}" not found on estimate; skipping.`);
//         continue;
//       }

//       const { lineRef, remaining } = entry;
//       if (remaining <= 0) {
//         warnings.push(`Item "${lineRef.name}" is already fully fulfilled; skipping.`);
//         continue;
//       }

//       const toPack = Math.min(requested, remaining);
//       if (requested > remaining) {
//         warnings.push(`Requested ${requested} of "${lineRef.name}" but only ${remaining} remaining. Packaging ${toPack}.`);
//       }

//       const rate = Number(lineRef.rate ?? 0);
//       const amount = rate * toPack;

//       packageLines.push({
//         itemId: lineRef.itemId ?? lineRef.name,   // ensure a reference
//         name: lineRef.name,
//         quantity: toPack,
//         rate,
//         amount
//       });

//       // Update in-memory fulfilled (for snapshot & optional save())
//       lineRef.fulfilled = Number(lineRef.fulfilled || 0) + toPack;
//     }

//     if (packageLines.length === 0) {
//       return res.json({ success: false, message: 'No valid quantities to package', warnings });
//     }

//     // 4) Atomically persist fulfilled increments to avoid race conditions
//     const bulkOps = packageLines.map(l => {
//       // Prefer itemId when present; fallback to name match
//       const filter = (l.itemId && l.itemId !== l.name)
//         ? { _id: estimate._id, 'items.itemId': l.itemId }
//         : { _id: estimate._id, 'items.name': l.name };

//       return {
//         updateOne: {
//           filter,
//           update: { $inc: { 'items.$.fulfilled': l.quantity } }
//         }
//       };
//     });

//     if (bulkOps.length) {
//       const bulkRes = await Estimate.bulkWrite(bulkOps, { ordered: false });
//       // Optional: log results to debug
//       // console.log('Estimate bulkWrite:', bulkRes?.nModified ?? bulkRes?.modifiedCount);
//     }

//     // 5) (Optional) decrement inventory for each packaged line
//     //    If you allow negative stock, keep as-is. Otherwise, clamp with an $max pipeline.
//     for (const l of packageLines) {
//       await Item.updateOne(
//         { itemId: l.itemId, realmId },
//         { $inc: { quantity: -l.quantity }, $set: { updatedAt: new Date() } },
//         { upsert: true }
//       );
//     }

//     // 6) Create Package document with meta (packageDate, shipmentDate, driverName)
//     const totals = {
//       lines: packageLines.reduce((n, x) => n + x.quantity, 0),
//       amount: packageLines.reduce((n, x) => n + (x.amount || 0), 0)
//     };

//     const pkg = await Package.create({
//       estimateId,
//       realmId,
//       lines: packageLines,
//       notes,
//       packageDate: packageDate ? new Date(packageDate) : new Date(),
//       shipmentDate: shipmentDate ? new Date(shipmentDate) : undefined,
//       driverName,
//       totals,
//       snapshot: {
//         customerName: estimate.customerName,
//         txnDate: estimate.txnDate,
//         billTo: estimate.raw?.BillAddr || null,
//         shipTo: estimate.raw?.ShipAddr || null,
//       },
//       quantities,
//       status: 'Created' // later: 'Invoiced' after you create a QB invoice
//       // packageCode is auto-generated in Package model pre('save')
//     });

//     return res.status(201).json({
//       success: true,
//       packageId: String(pkg._id),
//       packageCode: pkg.packageCode,
//       estimateId: pkg.estimateId,
//       totals,
//       warnings
//     });
//   } catch (err) {
//     console.error('Create package error:', err);
//     res.status(500).json({ success: false, message: err.message });
//   }
// });
router.post('/create', async (req, res) => {
  const {
    estimateId,
    realmId,
    quantities = {},
    notes,
    packageDate,
    shipmentDate,
    driverName,
    // NEW: optional fields coming from the client
    siteContact = {},           // { name?: string, phone?: string }
    shippingAddress = ""        // editable multiline string
  } = req.body || {};

  if (!realmId) {
    return res.status(400).json({ success: false, message: 'realmId is required' });
  }

  try {
    // 1) Load fresh estimate
    const estimate = await Estimate.findOne({ estimateId, realmId });
    console.log('========================Loaded estimate======================================:', estimate);
    if (!estimate) {
      return res.status(404).json({ success: false, message: 'Estimate not found' });
    }

    // 2) Build remaining-index
    const remainingIndex = buildRemainingIndex(estimate);

    // 3) Iterate user-submitted quantities
    const warnings = [];
    const packageLines = [];

    const entries = Object.entries(quantities || {});
    for (const [rawKey, requestedRaw] of entries) {
      const key = String(rawKey ?? '').trim();
      const requested = Math.max(0, Number(requestedRaw ?? 0));
      if (!key || requested <= 0) continue;

      let entry = remainingIndex.get(key) || remainingIndex.get(key.toLowerCase());
      if (!entry) {
        warnings.push(`Item "${key}" not found on estimate; skipping.`);
        continue;
      }

      const { lineRef, remaining } = entry;
      if (remaining <= 0) {
        warnings.push(`Item "${lineRef.name}" is already fully fulfilled; skipping.`);
        continue;
      }

      const toPack = Math.min(requested, remaining);
      if (requested > remaining) {
        warnings.push(`Requested ${requested} of "${lineRef.name}" but only ${remaining} remaining. Packaging ${toPack}.`);
      }

      const rate = Number(lineRef.rate ?? 0);
      const amount = rate * toPack;

      packageLines.push({
        itemId: lineRef.itemId ?? lineRef.name,
        name: lineRef.name,
        quantity: toPack,
        rate,
        amount
      });

      // update in-memory fulfilled
      lineRef.fulfilled = Number(lineRef.fulfilled || 0) + toPack;
    }

    if (packageLines.length === 0) {
      return res.json({ success: false, message: 'No valid quantities to package', warnings });
    }

    // 4) Atomically persist fulfilled increments
    const bulkOps = packageLines.map(l => {
      const filter = (l.itemId && l.itemId !== l.name)
        ? { _id: estimate._id, 'items.itemId': l.itemId }
        : { _id: estimate._id, 'items.name': l.name };
      return {
        updateOne: {
          filter,
          update: { $inc: { 'items.$.fulfilled': l.quantity } }
        }
      };
    });

    if (bulkOps.length) {
      await Estimate.bulkWrite(bulkOps, { ordered: false });
    }

    // 5) Decrement inventory (optional)
    for (const l of packageLines) {
      await Item.updateOne(
        { itemId: l.itemId, realmId },
        { $inc: { quantity: -l.quantity }, $set: { updatedAt: new Date() } },
        { upsert: true }
      );
    }

    // 6) Create Package doc (now with siteContact + editable shipping address)
    const totals = {
      lines: packageLines.reduce((n, x) => n + x.quantity, 0),
      amount: packageLines.reduce((n, x) => n + (x.amount || 0), 0)
    };

    const originalShipTo = estimate.raw?.ShipAddr || null;
    // If client sent an edited string, use it; else derive string from QBO object
    const shipToString = String(shippingAddress ?? "").trim() || toAddressString(originalShipTo);

    const pkg = await Package.create({
      estimateId,
      realmId,
      lines: packageLines,
      notes,
      packageDate: packageDate ? new Date(packageDate) : new Date(),
      shipmentDate: shipmentDate ? new Date(shipmentDate) : undefined,
      driverName,
      totals,
      // NEW: persist optional contact + editable address
      siteContact: {
        name: (siteContact.name || "").trim(),
        phone: (siteContact.phone || "").trim()
      },
      shippingAddress: shipToString, // a single editable multiline field

      // keep both for audits/printing
      snapshot: {
        customerName: estimate.customerName,
        txnDate: estimate.txnDate,
        billTo: estimate.raw?.BillAddr || null,
        shipToOriginal: originalShipTo || null, // NEW: original structured address from QBO
        shipToString: shipToString               // NEW: the string that will be shown/printed
      },
      quantities,
      status: 'Created'
    });

    return res.status(201).json({
      success: true,
      packageId: String(pkg._id),
      packageCode: pkg.packageCode,
      estimateId: pkg.estimateId,
      totals,
      warnings
    });
  } catch (err) {
    console.error('Create package error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});


/**
 * List packages for an estimate
 */
router.get('/list/:estimateId/packages', async (req, res) => {
    const { estimateId, realmId, page = 1, limit = 10 } = req.body;

    if (!realmId) return res.status(400).json({ success: false, message: 'realmId is required' });

    const skip = (Number(page) - 1) * Number(limit);

    try {
        const [rows, total] = await Promise.all([
            Package.find({ estimateId, realmId })
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(Number(limit)),
            Package.countDocuments({ estimateId, realmId })
        ]);

        res.json({
            success: true,
            packages: rows,
            page: Number(page),
            limit: Number(limit),
            total,
            totalPages: Math.ceil(total / Number(limit))
        });
    } catch (err) {
        console.error('List packages error:', err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// router.get("/weeks", async (req, res) => {
//   try {
//     const realmId = String(req.query.realmId || req.user?.realmId || "").trim();
//     if (!realmId) return res.status(400).send("Missing realmId");

//     const tz = "America/Vancouver";
//     const { current, next } = getWeekRanges(tz);

//     const rangeMatch = (fromDT, toDT) => ({
//       realmId,
//       shipmentDate: { $gte: fromDT.toJSDate(), $lt: toDT.toJSDate() },
//     });

//     const groupByDay = [
//       {
//         $addFields: {
//           shipDay: {
//             $dateToString: { format: "%Y-%m-%d", date: "$shipmentDate", timezone: tz },
//           },
//         },
//       },
//       { $sort: { shipmentDate: 1, createdAt: 1 } },
//       {
//         $group: {
//           _id: "$shipDay",
//           count: { $sum: 1 },
//           packages: {
//             $push: {
//               _id: "$_id",
//               packageCode: "$packageCode",
//               estimateId: "$estimateId",
//               docNumber: "$docNumber",
//               customerName: "$customerName",
//               shipmentDate: "$shipmentDate",
//               status: "$status",
//               totals: "$totals",
//               notes: "$notes",
//             },
//           },
//         },
//       },
//       { $project: { _id: 0, shipDay: "$shipDay", count: 1, packages: 1 } },
//       { $sort: { shipDay: 1 } },
//     ];

//     const [result] = await Package.aggregate([
//       {
//         $facet: {
//           current: [{ $match: rangeMatch(current.from, current.to) }, ...groupByDay],
//           next:    [{ $match: rangeMatch(next.from, next.to) },       ...groupByDay],
//         },
//       },
//     ]);

//     const total = (arr) => arr.reduce((s, g) => s + (g?.count || 0), 0);

//     res.json({
//       current: {
//         range: { from: current.from.toISODate(), to: current.to.toISODate() }, // [from, to)
//         grouped: result.current,
//         total: total(result.current),
//       },
//       next: {
//         range: { from: next.from.toISODate(), to: next.to.toISODate() },
//         grouped: result.next,
//         total: total(result.next),
//       },
//     });
//   } catch (err) {
//     console.error("weeks endpoint error:", err);
//     res.status(500).send("Failed to load weekly packages");
//   }
// });

router.get("/weeks", async (req, res) => {
  try {
    const realmId = String(req.query.realmId || req.user?.realmId || "").trim();
    if (!realmId) return res.status(400).send("Missing realmId");

    const tz = "America/Vancouver";
    const { current, next } = getWeekRanges(tz);

    const base = (fromDT, toDT) => ([
      { $match: { realmId, shipmentDate: { $gte: fromDT.toJSDate(), $lt: toDT.toJSDate() } } },

      // 🔎 Pull customerName & DocNumber from Estimate (match by realmId + estimateId)
      {
        $lookup: {
          from: "estimates",
          let: { eId: "$estimateId", rId: "$realmId" },
          pipeline: [
            { $match: { $expr: { $and: [
              { $eq: ["$estimateId", "$$eId"] },
              { $eq: ["$realmId",   "$$rId"] },
            ] } } },
            { $project: {
              _id: 0,
              customerName: 1,
              docNumber: 1,
              rawDocNumber: "$raw.DocNumber", // in case you only stored it in raw
            } }
          ],
          as: "est"
        }
      },
      { $addFields: { est: { $first: "$est" } } },

      // ✅ Resolved fields with sensible fallbacks
      { $addFields: {
          customerNameResolved: {
            $ifNull: [
              "$est.customerName",
              { $ifNull: ["$snapshot.customerName", "$customerName"] }
            ]
          },
          docNumberResolved: {
            $ifNull: [
              "$est.docNumber",
              { $ifNull: ["$est.rawDocNumber", "$docNumber"] }
            ]
          },
          shipDay: {
            $dateToString: { format: "%Y-%m-%d", date: "$shipmentDate", timezone: tz }
          }
        }
      },

      { $sort: { shipmentDate: 1, createdAt: 1 } },
      {
        $group: {
          _id: "$shipDay",
          count: { $sum: 1 },
          packages: {
            $push: {
              _id: "$_id",
              packageCode: "$packageCode",
              estimateId: "$estimateId",
              docNumber: "$docNumberResolved",     // 👈 from Estimate
              customerName: "$customerNameResolved", // 👈 from Estimate
              shipmentDate: "$shipmentDate",
              status: "$status",
              totals: "$totals",
              notes: "$notes",
            }
          }
        }
      },
      { $project: { _id: 0, shipDay: "$_id", count: 1, packages: 1 } },
      { $sort: { shipDay: 1 } },
    ]);

    const [result] = await Package.aggregate([
      { $facet: {
          current: base(current.from, current.to),
          next:    base(next.from,    next.to),
        }
      }
    ]);

    const sum = (a) => a.reduce((s, g) => s + (g.count || 0), 0);

    res.json({
      current: {
        range: { from: current.from.toISODate(), to: current.to.toISODate() },
        grouped: result.current,
        total: sum(result.current),
      },
      next: {
        range: { from: next.from.toISODate(), to: next.to.toISODate() },
        grouped: result.next,
        total: sum(result.next),
      },
    });
  } catch (err) {
    console.error("weeks endpoint error:", err);
    res.status(500).send("Failed to load weekly packages");
  }
});

router.get("/upcoming", async (req, res) => {
  try {
    const realmId = String(req.query.realmId || req.user?.realmId || "").trim();
    if (!realmId) return res.status(400).send("Missing realmId");

    const tz = "America/Vancouver";

    // Optional override via query (?from=YYYY-MM-DD&to=YYYY-MM-DD)
    let from, to;
    if (req.query.from && req.query.to) {
      from = new Date(`${req.query.from}T00:00:00-07:00`); // handled by PST/PDT offset at runtime
      to   = new Date(`${req.query.to}T00:00:00-07:00`);
    } else {
      const r = nextWeekRange(tz);
      from = r.from.toJSDate();
      to   = r.to.toJSDate();
    }


    console.log('From Date:'+ from);
    // Some of your docs may store shipmentDate as an ISO string "YYYY-MM-DD".
    // This $or handles both Date and string storage safely.
    const match = {
      realmId,
      $or: [
        { shipmentDate: { $gte: from, $lt: to } },                 // if Date type
        { shipmentDate: { $type: "string", $regex: /^\d{4}-\d{2}-\d{2}$/ } }, // strings
      ],
    };

    // If you have mixed types, we’ll match strings by converting the from/to into YYYY-MM-DD:
    const toYMD = (d) => new Date(d.getTime() - d.getTimezoneOffset()*60000).toISOString().slice(0,10);
    const fromY = toYMD(from);
    const toY   = toYMD(to);

    const pipeline = [
      { $match: {
          realmId,
          $or: [
            { shipmentDate: { $gte: from, $lt: to } },                        // Date
            { $and: [                                                         // String: "YYYY-MM-DD"
                { shipmentDate: { $type: "string" } },
                { shipmentDate: { $gte: fromY, $lt: toY } },
            ]},
          ],
        }
      },
      // Normalize to YYYY-MM-DD in Vancouver time
      { $addFields: {
          shipDay: {
            $cond: [
              { $eq: [{ $type: "$shipmentDate" }, "date"] },
              { $dateToString: { format: "%Y-%m-%d", date: "$shipmentDate", timezone: tz } },
              "$shipmentDate"
            ]
          }
        }
      },
      { $sort: { shipDay: 1, createdAt: 1 } },
      { $group: {
          _id: "$shipDay",
          count: { $sum: 1 },
          packages: { $push: {
            _id: "$_id",
            packageCode: "$packageCode",
            estimateId: "$estimateId",
            customerName: "$customerName",
            shipmentDate: "$shipmentDate",
            notes: "$notes",
            totals: "$totals", // whatever you store (e.g., total items)
          } }
        }
      },
      { $sort: { _id: 1 } },
      { $project: { shipDay: "$_id", _id: 0, count: 1, packages: 1 } },
    ];

    console.log(pipeline);

    const grouped = await Package.aggregate(pipeline);

    // Also return the absolute range so the UI can show it
    res.json({
      range: { from: fromY, to: toY }, // [from, to)
      grouped,                         // [{ shipDay, count, packages: [...] }, ...]
    });
  } catch (err) {
    console.error("Upcoming packages error:", err);
    res.status(500).send("Failed to load upcoming packages");
  }
});

// router.get('/:id', async (req, res) => {
//   try {
//     const pkg = await Package.findById(req.params.id).lean();
// // res.json({ ...pkg, id: String(pkg._id) });;
//     if (!pkg) return res.status(404).json({ message: 'Not found' });

// const estimate = await Estimate.findOne({ estimateId: pkg.estimateId, realmId: pkg.realmId }).lean();

// // Return items from the estimate so UI can show ordered & fulfilled
//   res.json({ ...pkg, items: estimate?.items ?? [], estimateId: estimate?.estimateId, customerName: estimate?.customerName });
//     //res.json({ ...pkg, id: String(pkg._id) });
//   } catch (e) {
//     res.status(500).json({ message: e.message });
//   }
// });

router.get("/:id", requireAdmin, async (req, res) => {
  const pkg = await Package.findById(req.params.id).lean();
  if (!pkg) return res.status(404).send("Not found");

  const estimate = await Estimate.findOne({
    estimateId: pkg.estimateId,
    realmId: pkg.realmId,
  }).lean();

  const keyOf = (row) =>
    String(row?.itemId ?? row?.ItemRef?.value ?? row?.name ?? "");

  // lines index (so we can grab per-package qty defaults if you want)
  const lineByKey = Object.fromEntries(
    (pkg.lines || []).map((ln) => {
      const k = keyOf(ln);
      return [k, { ...ln, itemId: k }];
    })
  );

  // normalize estimate items with a real key
  const items = (estimate?.items || []).map((it) => {
    const k = keyOf(it);
    return {
      itemId: k,
      name: it.name,
      quantity: Number(it.quantity ?? 0),   // ordered
      fulfilled: Number(it.fulfilled ?? 0), // global fulfilled
    };
  });

  // normalize quantities map for THIS package
  const quantities = {};
  // choose source of truth: pkg.quantities map, else fall back to pkg.lines qty
  for (const it of items) {
    const k = it.itemId;
    const qFromPkg = pkg.quantities?.[k];
    const qFromLines = lineByKey[k]?.quantity;
    quantities[k] = Number(
      qFromPkg ?? (Number.isFinite(qFromLines) ? qFromLines : 0)
    );
  }

  res.json({
    _id: pkg._id,
    packageCode: pkg.packageCode,
    estimateId: estimate?.estimateId ?? pkg.estimateId,
    docNumber: estimate.raw?.DocNumber ?? null,
    realmId: pkg.realmId,
    customerName: estimate?.customerName ?? pkg.snapshot?.customerName,
    packageDate: pkg.packageDate,
    shipmentDate: pkg.shipmentDate,
    driverName: pkg.driverName,
    notes: pkg.notes,
    items,        // <- now each has itemId
    quantities,   // <- map keyed by itemId
    totals: pkg.totals,
    status: pkg.status,
    snapshot: pkg.snapshot,
    lines: Object.values(lineByKey), // normalized too (optional)
    createdAt: pkg.createdAt,
    updatedAt: pkg.updatedAt,
    siteContact: pkg.siteContact || {},       // { name, phone }
    //quantities: pkg.quantities,
  });
});

// server/routes/packages.js
// router.put("/:id", requireAdmin, async (req, res) => {
//   try {
//     const pkg = await Package.findById(req.params.id);
//     if (!pkg) return res.status(404).send("Not found");

//     const { shipmentDate, driverName, notes, siteContact, shippingAddress } = req.body;

//     // 1) clean incoming quantities
//     const cleaned = Object.fromEntries(
//       Object.entries(req.body.quantities || {})
//         .filter(([k]) => k && k !== "undefined")
//         .map(([k, v]) => [String(k), Number(v || 0)])
//     );
//    console.log(`Updating package ${pkg._id} with quantities:`, cleaned);
//     // 2) assign fields
//     if (shipmentDate !== undefined) pkg.shipmentDate = shipmentDate;
//     if (driverName !== undefined) pkg.driverName = driverName;
//     if (notes !== undefined) pkg.notes = notes;

//     // 3) **replace** the whole quantities object (no .set)
//     pkg.set("quantities", cleaned);    // ✅ works for Map or Object types

//     // If your schema uses plain Object, uncomment the next line in case Mongoose misses changes:
//     // pkg.markModified("quantities");

//     await pkg.save();

//     console.log(`Package ${pkg._id} updated successfully`);

//     // (optional) if you recompute estimate fulfillment:
//     await recomputeEstimateFulfilled({ estimateId: pkg.estimateId, realmId: pkg.realmId });

//     res.json({ ok: true, id: pkg._id });
//   } catch (e) {
//     res.status(500).send(e.message || "Error");
//   }
// });

router.put("/:id", requireAdmin, async (req, res) => {
  try {
    const pkg = await Package.findById(req.params.id);
    if (!pkg) return res.status(404).send("Not found");

    const {
      shipmentDate,
      driverName,
      notes,
      siteContact,        // { name?: string, phone?: string }
      shippingAddress,    // string (multiline)
      quantities
    } = req.body || {};

    // 1) Clean incoming quantities (replace whole map)
    const cleaned = Object.fromEntries(
      Object.entries(quantities || {})
        .filter(([k]) => k && k !== "undefined")
        .map(([k, v]) => [String(k), Number(v || 0)])
    );
    console.log(`Updating package ${pkg._id} with quantities:`, cleaned);

    // 2) Assign simple fields
    if (shipmentDate !== undefined) {
      // allow clearing by passing empty string/undefined
      pkg.shipmentDate = shipmentDate ? new Date(shipmentDate) : undefined;
    }
    if (driverName !== undefined) pkg.driverName = driverName;
    if (notes !== undefined) pkg.notes = notes;

    // 3) Optional: siteContact (both fields optional)
    if (siteContact !== undefined) {
      pkg.siteContact = {
        name: (siteContact?.name ?? "").trim(),
        phone: (siteContact?.phone ?? "").trim(),
      };
      // If you want to validate phone server-side, do it here (optional)
      // if (pkg.siteContact.phone && !/^[0-9+()\-\s]{7,}$/.test(pkg.siteContact.phone)) {
      //   return res.status(400).send("Invalid phone format.");
      // }
    }

    // 4) Optional: editable shipping address (and keep printable snapshot in sync)
    if (shippingAddress !== undefined) {
      pkg.shippingAddress = String(shippingAddress || "");
      pkg.snapshot = pkg.snapshot || {};
      pkg.snapshot.shipToString = pkg.shippingAddress; // keep printable in sync
      // NOTE: don't touch snapshot.shipToOriginal (keep original QBO address)
    }

    // 5) Replace the whole quantities object (works for Map or Object types)
    pkg.set("quantities", cleaned);
    // If your schema uses plain object for quantities, uncomment:
    // pkg.markModified("quantities");

    await pkg.save();
    console.log(`Package ${pkg._id} updated successfully`);

    // Keep estimate.fulfilled in sync with total packages
    await recomputeEstimateFulfilled({ estimateId: pkg.estimateId, realmId: pkg.realmId });

    res.json({ ok: true, id: pkg._id });
  } catch (e) {
    console.error("PUT /admin/packages/:id error:", e);
    res.status(500).send(e.message || "Error");
  }
});


// router.delete("/:id", async (req, res) => {
//   const session = await mongoose.startSession();
//   try {
//     console.log('deleting package:', req.params.id);
//     await session.withTransaction(async () => {
//       const pkg = await Package.findById(req.params.id).session(session);
//       if (!pkg) return res.status(404).send("Package not found");

//       // SOFT DELETE is safer (keeps history)
//       // pkg.deletedAt = new Date();
//       // await pkg.save({ session });
//       await Package.deleteOne({ _id: req.params.id }).session(session);
//      console.log('pkg deleted:', req.params.id); 
//       // const estimate = await recomputeFulfilledForEstimate(
//       //   { estimateId: pkg.estimateId, realmId: pkg.realmId },
//       //   session
//       // );

//           const estimate = await recomputeEstimateFulfilledOnDelete(
//         { estimateId: pkg.estimateId, realmId: pkg.realmId },session
//       );
//       console.log('estimate adjusted:', pkg.estimateId);
//       res.json({ success: true, estimate });
//     });
//   } catch (e) {
//     console.error(e);
//     res.status(500).send(e.message);
//   } finally {
//     session.endSession();
//   }
// });

router.delete("/:id", async (req, res) => {
  const session = await mongoose.startSession();

  try {
    let result = null; // we’ll fill this inside the txn

    await session.withTransaction(async () => {
      const id = req.params.id;
      console.log("deleting package:", id);

      // 1) Load identifiers BEFORE hard delete
      const pkg = await Package.findById(id).session(session);
      if (!pkg) {
        // Don’t send the response from inside the txn; just throw to exit cleanly
        const err = new Error("Package not found");
        err.status = 404;
        throw err;
      }

      // 2) Hard delete with the SAME session
      await Package.deleteOne({ _id: id }, { session });
      console.log("pkg deleted:", id);

 // 2) ⬇️ PASTE THIS DIAGNOSTIC BLOCK RIGHT HERE ⬇️
      const totals = await Package.aggregate([
        { $match: {
            estimateId: String(pkg.estimateId),
            realmId: String(pkg.realmId),
            // only active packages remain (we just deleted one)
          }
        },
        { $project: { pairs: { $objectToArray: { $ifNull: ["$quantities", {}] } } } },
        { $unwind: "$pairs" },
        { $group: {
            _id: "$pairs.k",
            total: {
              $sum: {
                $convert: { input: "$pairs.v", to: "double", onError: 0, onNull: 0 }
              }
            }
          }
        },
      ]).session(session);

      console.log(
        "ACTIVE TOTALS AFTER DELETE:",
        totals.map(t => [String(t._id), t.total])
      );
      // 2) ⬆️ END DIAGNOSTIC BLOCK ⬆️



      // 3) Recompute using SAME session (so agg sees the delete)
      const estimate = await recomputeEstimateFulfilledOnDelete(
        {
          estimateId: String(pkg.estimateId),
          realmId: String(pkg.realmId),
        },
        session
      );

      // IMPORTANT: make sure recompute returns a resolved doc, e.g. .lean()
      result = estimate; // capture to send after commit
    }, { writeConcern: { w: "majority" }, readConcern: { level: "snapshot" } });

    // 4) Now we’re safely committed; send the response
    return res.json({ success: true, estimate: result });
  } catch (e) {
    console.error(e);
    const code = e.status || 500;
    return res.status(code).send(e.message || "Delete failed");
  } finally {
    session.endSession();
  }
});


/**
 * GET /admin/packages
 * Query params:
 *   search        - string; matches customerName (icontains) OR estimateId (startsWith / icontains)
 *   from          - ISO date (inclusive); filters by shipmentDate
 *   to            - ISO date (inclusive end-of-day)
 *   page          - number (1-based)
 *   limit         - number (default 20)
 *   realmId       - string (if you silo data by realm)
 *
 * Always sorted by shipmentDate desc (fallback to packageDate desc, then _id desc).
 */





// UPDATE package
// router.put("/:id", requireAdmin, async (req, res) => {
//   try {
//     const { shipmentDate, driverName, notes, quantities } = req.body;
//     console.log(`Updating package ${req.params.id} with data:`, req.body);
//     const pkg = await Package.findById(req.params.id);
//     if (!pkg) return res.status(404).send("Not found");

//     if (shipmentDate !== undefined) pkg.shipmentDate = shipmentDate;
//     if (driverName !== undefined) pkg.driverName = driverName;
//     if (notes !== undefined) pkg.notes = notes;

//     // Store only per-package quantities here (source of truth for this package)
//     if (quantities && typeof quantities === "object") {
//       // ensure numbers
//       for (const [k, v] of Object.entries(quantities)) {
//       //  pkg.quantities.set(k, Number(v || 0)); // if using Map; adjust if plain object
//          pkg.set(`quantities.${k}`, v);
//       }
//     }

//     await pkg.save();
//     console.log(`Package ${pkg._id} updated successfully`);

//     // Important: recompute Estimate items.fulfilled (global view)
//     await recomputeEstimateFulfilled({ estimateId: pkg.estimateId, realmId: pkg.realmId });
//     console.log(`Recomputed fulfilled for estimate ${pkg.estimateId} in realm ${pkg.realmId}`);
//     res.json({ ok: true, id: pkg._id });
//   } catch (e) {
//     res.status(500).send(e.message || "Error");
//   }
// });


// router.put("/:id", requireAdmin, async (req, res) => {
//   try {
//     const { shipmentDate, driverName, notes, quantities } = req.body;

//     const pkg = await Package.findById(req.params.id);
//     if (!pkg) return res.status(404).send("Not found");

//     if (shipmentDate !== undefined) pkg.shipmentDate = shipmentDate;
//     if (driverName !== undefined) pkg.driverName = driverName;
//     if (notes !== undefined) pkg.notes = notes;

//     // Update fulfilled quantities per item
//     if (quantities && typeof quantities === "object") {
//       // pkg.items: [{ itemId, name, quantity, fulfilled }]
//       pkg.items = (pkg.items || []).map((it) => {
//         const nextFulfilled = Number(quantities[it.itemId] ?? it.fulfilled ?? 0);
//         return { ...it, fulfilled: nextFulfilled };
//       });
//       pkg.markModified("items");
//     }

//     await pkg.save();
//     res.json({ ok: true, id: pkg._id });
//   } catch (e) {
//     res.status(500).send(e.message || "Error");
//   }
// });




export default router;