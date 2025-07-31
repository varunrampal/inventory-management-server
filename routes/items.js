import express from 'express';
import Item from '../models/item.js'; 
import { requireAdmin } from '../middleware/auth.js';
import { ObjectId } from 'mongodb';
import db from '../db.js'; // your MongoDB connection

const connectedDb = await db.connect();
const router = express.Router();
// GET /admin/items/:id
router.get('/:id',requireAdmin,async (req, res) => {
  try {

    console.log('Fetching item with ID:', req.params.id);
    const item = await connectedDb.collection('items').findOne({ _id: new ObjectId(req.params.id) });
    if (!item) return res.status(404).json({ message: 'Item not found' });
   // console.log('Fetched item:', item);
    res.json(item);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /admin/items/:id
router.get('/:id/:realmId',requireAdmin,async (req, res) => {
  try {

    console.log('Fetching item with ID:', req.params.id + ' and Realm ID:', req.params.realmId); ;
    const item = await connectedDb.collection('items').findOne({ _id: new ObjectId(req.params.id), realmId: req.params.realmId });
    if (!item) return res.status(404).json({ message: 'Item not found' });
   // console.log('Fetched item:', item);
    res.json(item);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;