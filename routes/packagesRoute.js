import express from 'express';
import Estimate from '../models/estimate.js';
import Item from '../models/item.js'; // if you want to decrement stock
import Package from '../models/package.js';
import { computeRemainingQuantities, computeRemainingQuantitiesOfEstimate, 
    findItemIdInRaw, 
    findRateInRaw, 
    buildRemainingIndex 
} from '../services/estimateService.js'; // Adjust import path as needed

const router = express.Router();

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
    const estimate = await Estimate.findOne({ estimateId, realmId });
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
        txnDate: estimate.txnDate
      },
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


router.get('/:id', async (req, res) => {
  try {
    const pkg = await Package.findById(req.params.id);
    if (!pkg) return res.status(404).json({ message: 'Not found' });
    res.json({ package: pkg });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

export default router;