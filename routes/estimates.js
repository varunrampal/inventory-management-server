// routes/admin/estimates.js
import express from 'express';
import { requireAdmin } from '../middleware/auth.js';
import db from '../db.js'; // your MongoDB connection

const connectedDb = await db.connect();
const router = express.Router();

// GET /admin/estimates/item/:itemId/reserved?status=Active
router.get('/item-by-name/:itemName/reserved', requireAdmin, async (req, res) => {
  const { itemName } = req.params;
  const { status } = req.query;

  console.log('Fetching reserved estimates for item:', itemName, 'with status:', status);

  try {
    // Step 1: Find matching estimates
    const estimates = await connectedDb.collection('estimates').find({
         'items.name': { $regex: new RegExp(`^${itemName.trim()}$`, 'i') } // case-insensitive match
    }).toArray();


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

export default router;
