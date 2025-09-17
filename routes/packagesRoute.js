import express from 'express';
import mongoose from "mongoose";
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
router.post('/create', async (req, res) => {
    const {
    estimateId,
    realmId,
    quantities = {},
    notes,
    packageDate,
    shipmentDate,
    driverName
  } = req.body || {};

  if (!realmId) {
    return res.status(400).json({ success: false, message: 'realmId is required' });
  }

  try {
    // 1) Load fresh estimate (DO NOT use .lean() because we may mutate/save)
    //const estimate = await Estimate.findOne({ estimateId, realmId });
    const estimate = await Estimate
  .findOne({ estimateId, realmId });
  

    console.log('========================Loaded estimate======================================:', estimate);
    if (!estimate) {
      return res.status(404).json({ success: false, message: 'Estimate not found' });
    }

    // 2) Build remaining-index that supports lookup by itemId OR by name
    const remainingIndex = buildRemainingIndex(estimate);

    // 3) Iterate user-submitted quantities
    const warnings = [];
    const packageLines = [];

    // normalize keys once
    const entries = Object.entries(quantities || {});
    for (const [rawKey, requestedRaw] of entries) {
      const key = String(rawKey ?? '').trim();
      const requested = Math.max(0, Number(requestedRaw ?? 0));
      if (!key || requested <= 0) continue;

      // Lookup by exact key; then fallback to case-insensitive name
      let entry = remainingIndex.get(key);
      if (!entry) {
        entry = remainingIndex.get(key.toLowerCase());
      }
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
        itemId: lineRef.itemId ?? lineRef.name,   // ensure a reference
        name: lineRef.name,
        quantity: toPack,
        rate,
        amount
      });

      // Update in-memory fulfilled (for snapshot & optional save())
      lineRef.fulfilled = Number(lineRef.fulfilled || 0) + toPack;
    }

    if (packageLines.length === 0) {
      return res.json({ success: false, message: 'No valid quantities to package', warnings });
    }

    // 4) Atomically persist fulfilled increments to avoid race conditions
    const bulkOps = packageLines.map(l => {
      // Prefer itemId when present; fallback to name match
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
      const bulkRes = await Estimate.bulkWrite(bulkOps, { ordered: false });
      // Optional: log results to debug
      // console.log('Estimate bulkWrite:', bulkRes?.nModified ?? bulkRes?.modifiedCount);
    }

    // 5) (Optional) decrement inventory for each packaged line
    //    If you allow negative stock, keep as-is. Otherwise, clamp with an $max pipeline.
    for (const l of packageLines) {
      await Item.updateOne(
        { itemId: l.itemId, realmId },
        { $inc: { quantity: -l.quantity }, $set: { updatedAt: new Date() } },
        { upsert: true }
      );
    }

    // 6) Create Package document with meta (packageDate, shipmentDate, driverName)
    const totals = {
      lines: packageLines.reduce((n, x) => n + x.quantity, 0),
      amount: packageLines.reduce((n, x) => n + (x.amount || 0), 0)
    };

    const pkg = await Package.create({
      estimateId,
      realmId,
      lines: packageLines,
      notes,
      packageDate: packageDate ? new Date(packageDate) : new Date(),
      shipmentDate: shipmentDate ? new Date(shipmentDate) : undefined,
      driverName,
      totals,
      snapshot: {
        customerName: estimate.customerName,
        txnDate: estimate.txnDate,
        billTo: estimate.raw?.BillAddr || null,
        shipTo: estimate.raw?.ShipAddr || null,
      },
      quantities,
      status: 'Created' // later: 'Invoiced' after you create a QB invoice
      // packageCode is auto-generated in Package model pre('save')
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
    //quantities: pkg.quantities,
  });
});

// server/routes/packages.js
router.put("/:id", requireAdmin, async (req, res) => {
  try {
    const pkg = await Package.findById(req.params.id);
    if (!pkg) return res.status(404).send("Not found");

    const { shipmentDate, driverName, notes } = req.body;

    // 1) clean incoming quantities
    const cleaned = Object.fromEntries(
      Object.entries(req.body.quantities || {})
        .filter(([k]) => k && k !== "undefined")
        .map(([k, v]) => [String(k), Number(v || 0)])
    );
   console.log(`Updating package ${pkg._id} with quantities:`, cleaned);
    // 2) assign fields
    if (shipmentDate !== undefined) pkg.shipmentDate = shipmentDate;
    if (driverName !== undefined) pkg.driverName = driverName;
    if (notes !== undefined) pkg.notes = notes;

    // 3) **replace** the whole quantities object (no .set)
    pkg.set("quantities", cleaned);    // ✅ works for Map or Object types

    // If your schema uses plain Object, uncomment the next line in case Mongoose misses changes:
    // pkg.markModified("quantities");

    await pkg.save();

    console.log(`Package ${pkg._id} updated successfully`);

    // (optional) if you recompute estimate fulfillment:
    await recomputeEstimateFulfilled({ estimateId: pkg.estimateId, realmId: pkg.realmId });

    res.json({ ok: true, id: pkg._id });
  } catch (e) {
    res.status(500).send(e.message || "Error");
  }
});

router.delete("/:id", async (req, res) => {
  const session = await mongoose.startSession();
  try {
    console.log('deleting package:', req.params.id);
    await session.withTransaction(async () => {
      const pkg = await Package.findById(req.params.id).session(session);
      if (!pkg) return res.status(404).send("Package not found");

      // SOFT DELETE is safer (keeps history)
      // pkg.deletedAt = new Date();
      // await pkg.save({ session });
      await Package.deleteOne({ _id: req.params.id }).session(session);
     console.log('pkg deleted:', req.params.id); 
      // const estimate = await recomputeFulfilledForEstimate(
      //   { estimateId: pkg.estimateId, realmId: pkg.realmId },
      //   session
      // );

          const estimate = await recomputeEstimateFulfilledOnDelete(
        { estimateId: pkg.estimateId, realmId: pkg.realmId },session
      );
      console.log('estimate adjusted:', pkg.estimateId);
      res.json({ success: true, estimate });
    });
  } catch (e) {
    console.error(e);
    res.status(500).send(e.message);
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