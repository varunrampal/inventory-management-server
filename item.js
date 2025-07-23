// project/items.js

import Item from './models/item.js';
export const createItem = async (item) => {

const now = new Date();
const newItem = new Item({
    ...item,
    itemId: item.quickbooksId,
    realmId: item.realmId,
    name: item.name,
    sku: item.sku || '',
    description: item.description || '',
    quantity: item.quantity || 0,
    price: item.price || 0,
    unit: item.unit || '',
    category: item.category || 'Uncategorized',
    type: item.type || 'Inventory',
    location: item.location || '',
    active: item.active !== undefined ? item.active : true,
    lastSyncedAt: now,  
    updatedAt: now,
    // Ensure createdAt is set only when creating a new item
    createdAt: now,
    updatedAt: now
  });

  const result = await newItem.save();
  return result._id;
};

export const getItemById = async (id) => {
  return await Item.findOne({ _id: new ObjectId(id) });
};

export const getItemByQuickBooksId = async (quickbooksId, realmId) => {
  return await Item.findOne({ itemId: quickbooksId, realmId: realmId });
};

export const getAllItems = async (db) => {
  return await Item.find().sort({ updatedAt: -1 }).toArray();
};

export const updateItemByQuickBooksId = async (quickbooksId, updates) => {
  updates.updatedAt = new Date();

  const result = await Item.updateOne(
    { itemId: quickbooksId, realmId: updates.realmId },
    { $set: updates }
  );

  return result.modifiedCount > 0;
};

export const deleteItemByQuickBooksId = async (quickbooksId) => {
  const result = await Item.deleteOne({ quickbooksId });
  return result.deletedCount > 0;
};
