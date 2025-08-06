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
    customerName,
    page = 1,
    limit = 5
  } = req.body;

  const now = new Date();
  let startDate, endDate;

  console.log('Fetching reserved estimates for item:', itemName, 'with status:', status, 'and realmId:', realmId);

  // Build filter for Mongoose
  let filter = {
    'items.name': { $regex: new RegExp(`^${itemName.trim()}$`, 'i') },
    realmId
  };

  if (status && status !== 'All') {
    filter['raw.TxnStatus'] = status;  // ✅ Access nested TxnStatus
  }
// 🔹 Customer Name (partial, case-insensitive)
    if (customerName && customerName.trim() !== '') {
      filter.customerName = { $regex: new RegExp(customerName.trim(), 'i') };
    }
  const formatDate = (d) => d.toISOString().split('T')[0];

switch (dateRange) {
  case 'Today':
    startDate = new Date(now.setHours(0, 0, 0, 0));
    endDate = new Date(now.setHours(23, 59, 59, 999));
    break;

  case 'Yesterday':
    const yesterday = new Date();
    yesterday.setDate(now.getDate() - 1);
    startDate = new Date(yesterday.setHours(0, 0, 0, 0));
    endDate = new Date(yesterday.setHours(23, 59, 59, 999));
    break;

  case 'This Week':
    const thisWeekStart = new Date(now);
    thisWeekStart.setDate(now.getDate() - now.getDay()); // Sunday
    startDate = new Date(thisWeekStart.setHours(0, 0, 0, 0));
    endDate = new Date(); // Now
    break;

  case 'Last Week':
    const lastWeekStart = new Date();
    lastWeekStart.setDate(now.getDate() - now.getDay() - 7);
    const lastWeekEnd = new Date(lastWeekStart);
    lastWeekEnd.setDate(lastWeekStart.getDate() + 6);
    startDate = new Date(lastWeekStart.setHours(0, 0, 0, 0));
    endDate = new Date(lastWeekEnd.setHours(23, 59, 59, 999));
    break;

  case 'This Month':
    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    break;

  case 'Last Month':
    startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    endDate = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    break;

  case 'This Year':
    startDate = new Date(now.getFullYear(), 0, 1);
    endDate = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
    break;

  case 'Last Year':
    startDate = new Date(now.getFullYear() - 1, 0, 1);
    endDate = new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59, 999);
    break;

  case 'Custom':
    if (customStartDate && customEndDate) {
      startDate = new Date(customStartDate);
      endDate = new Date(customEndDate);
    }
    break;
}

if (startDate && endDate) {
  filter.txnDate = {
   $gte: formatDate(startDate),
    $lte: formatDate(endDate)
  };
}

console.log(filter.txnDate, 'Filter Date Range:', startDate, endDate);
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

//get all estimates with pagination
router.get('/estimates/:realmId', async (req, res) => {
  const { realmId } = req.params;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const skip = (page - 1) * limit;

  try {
    const [estimates, total] = await Promise.all([
      Estimate.find({ realmId })
        .sort({ txnDate: -1 })
        .skip(skip)
        .limit(limit),
      Estimate.countDocuments()
    ]);

    res.json({
      estimates,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    });
  } catch (err) {
    console.error('Error fetching estimates:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /estimates/filter
// This route filters estimates based on various criteria
router.post('/filter', async (req, res) => {
  try {
    const {
      realmId,
      status,
      estimateId,
      customerName,
      dateRange,
      customStartDate,
      customEndDate,
      page = 1,
      limit = 10
    } = req.body;

    const skip = (page - 1) * limit;
    const filter = {};
    const formatDate = (d) => d.toISOString().split('T')[0];
 const now = new Date();
  let startDate, endDate;

    // 🔹 RealmId
    if (realmId) {
      filter.realmId = realmId;
    }

    // 🔹 Estimate ID (exact match)
    if (estimateId && estimateId.trim() !== '') {
      filter.estimateId = estimateId.trim();
    }

    // 🔹 Customer Name (partial, case-insensitive)
    if (customerName && customerName.trim() !== '') {
      filter.customerName = { $regex: new RegExp(customerName.trim(), 'i') };
    }

    // 🔹 TxnStatus
    if (status && status !== 'All') {
      filter.txnStatus = status;
    }

    // 🔹 Date filtering
    if (dateRange && dateRange !== 'All') {
      let start, end;
      const today = new Date();
      const y = today.getFullYear();
      const m = today.getMonth();

 switch (dateRange) {
  case 'Today':
    startDate = new Date(now.setHours(0, 0, 0, 0));
    endDate = new Date(now.setHours(23, 59, 59, 999));
    break;

  case 'Yesterday':
    const yesterday = new Date();
    yesterday.setDate(now.getDate() - 1);
    startDate = new Date(yesterday.setHours(0, 0, 0, 0));
    endDate = new Date(yesterday.setHours(23, 59, 59, 999));
    break;

  case 'This Week':
    const thisWeekStart = new Date(now);
    thisWeekStart.setDate(now.getDate() - now.getDay()); // Sunday
    startDate = new Date(thisWeekStart.setHours(0, 0, 0, 0));
    endDate = new Date(); // Now
    break;

  case 'Last Week':
    const lastWeekStart = new Date();
    lastWeekStart.setDate(now.getDate() - now.getDay() - 7);
    const lastWeekEnd = new Date(lastWeekStart);
    lastWeekEnd.setDate(lastWeekStart.getDate() + 6);
    startDate = new Date(lastWeekStart.setHours(0, 0, 0, 0));
    endDate = new Date(lastWeekEnd.setHours(23, 59, 59, 999));
    break;

  case 'This Month':
    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    break;

  case 'Last Month':
    startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    endDate = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    break;

  case 'This Year':
    startDate = new Date(now.getFullYear(), 0, 1);
    endDate = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
    break;

  case 'Last Year':
    startDate = new Date(now.getFullYear() - 1, 0, 1);
    endDate = new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59, 999);
    break;

  case 'Custom':
    if (customStartDate && customEndDate) {
      startDate = new Date(customStartDate);
      endDate = new Date(customEndDate);
    }
    break;
}

if (startDate && endDate) {
  filter.txnDate = {
   $gte: formatDate(startDate),
    $lte: formatDate(endDate)
  };
}
    }

    console.log('Filter criteria:', filter);

    // 🔹 Query DB
    const [estimates, total] = await Promise.all([
      Estimate.find(filter).sort({ txnDate: -1 }).skip(skip).limit(limit),
      Estimate.countDocuments(filter)
    ]);

    res.json({
      estimates,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    });
  } catch (err) {
    console.error('Error filtering estimates:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;
