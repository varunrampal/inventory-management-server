// routes/admin/estimates.js
import express from 'express';
import { requireAdmin } from '../middleware/auth.js';
import Estimate from '../models/estimate.js'; // your Estimate model
import db from '../db.js'; // your MongoDB connection

const connectedDb = await db.connect();
const router = express.Router();


router.post('/item-by-name/filter', requireAdmin, async (req, res) => {
  const {
    itemName,
    realmId,
    status,
    dateRange,
    customStartDate,
    customEndDate,
    page = 1,
    limit = 5
  } = req.body;

  console.log('Fetching reserved estimates for item:', itemName, 'with status:', status, 'and realmId:', realmId);

  // Build filter for Mongoose
  let filter = {
    'items.name': { $regex: new RegExp(`^${itemName.trim()}$`, 'i') },
    realmId
  };

  if (status && status !== 'All') {
    filter['raw.TxnStatus'] = status;  // ✅ Access nested TxnStatus
  }

  if (dateRange === 'Custom' && customStartDate && customEndDate) {
    filter.txnDate = {
      $gte: new Date(customStartDate),
      $lte: new Date(customEndDate)
    };
  }

  try {
    // Step 1: Count total estimates
    const total = await Estimate.countDocuments(filter);

    // Step 2: Paginated fetch
    const rawEstimates = await Estimate.find(filter)
      .skip((page - 1) * limit)
      .limit(limit)
      .sort({ txnDate: -1 });

    // Step 3: Calculate reserved quantities
    let totalReserved = 0;
    const details = rawEstimates.map(estimate => {
      const item = estimate.items.find(i => i.name?.trim() === itemName.trim());
      const quantity = item?.quantity || 0;
      totalReserved += quantity;

      return {
        estimateId: estimate.estimateId,
        customerName: estimate.customerName,
        quantity,
        txnDate: estimate.txnDate
      };
    });

    res.json({
      totalReserved,
      itemName,
      status: status || 'All',
      details,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      total
    });

  } catch (err) {
    console.error('Error in /item-by-name/filter:', err);
    res.status(500).json({ message: 'Server Error' });
  }
});


// GET /admin/estimates/item/:itemName/reserved?status=Active
router.get('/item-by-name/:itemName/:realmId/reserved', requireAdmin, async (req, res) => {

  const { itemName, realmId } = req.params;
  const { status } = req.query;

  console.log('Fetching reserved estimates for item:', itemName, 'with status:', status, 'and realmId:', realmId);

  try {
    // Step 1: Find matching estimates
    const estimates = await Estimate.find({
      'items.name': { $regex: new RegExp(`^${itemName.trim()}$`, 'i') },  // case-insensitive match
      realmId
    });

    if (!estimates || estimates.length === 0) {
      return res.status(404).json({ message: 'No estimates found for the specified item.' });
    }
    console.log('Estimates: ', estimates);
    // Step 2: Extract quantities and sum them
    let totalReserved = 0;
    const details = [];

    estimates.forEach(estimate => {
      const item = estimate.items.find(i => i.name === itemName);
      console.log('Item in estimate:', item);
      if (item) {
        totalReserved += item.quantity || 0;
        details.push({
          estimateId: estimate.estimateId,
          customerName: estimate.customerName,
          quantity: item.quantity,
          txnDate: estimate.txnDate
        });
      }
    });

    res.json({ totalReserved, itemName, status: status || 'All (except Delivered)', details });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /admin/estimates/item/:itemId/reserved?status=Delivered

router.get('/item-by-id/:itemId/:realmId/reserved', requireAdmin, async (req, res) => {
  const { itemId, realmId } = req.params;
  const { status } = req.query;


  console.log('Fetching reserved estimates for item:', itemId, 'with status:', status, 'and realmId:', realmId);

  try {
    // Step 1: Find matching estimates
    const estimates = await Estimate.find({
      'items.itemId': itemId,
      realmId
    });

    console.log('Estimates: ', estimates);
    // Step 2: Extract quantities and sum them
    let totalReserved = 0;
    const details = [];

    estimates.forEach(estimate => {
      const item = estimate.items.find(i => i.id === itemId);
      console.log('Item in estimate:', item);
      if (item) {
        totalReserved += item.quantity || 0;
        details.push({
          estimateId: estimate.estimateId,
          customerName: estimate.customerName,
          quantity: item.quantity,
          txnDate: estimate.txnDate
        });
      }
    });

    res.json({ totalReserved, status: status || 'All (except Delivered)', details });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});


export default router;
