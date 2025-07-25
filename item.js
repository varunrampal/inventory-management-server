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

// Create or update item based on QuickBooks data
// This function will be used to handle both creation and updates in one go
export const createOrUpdateItemInDB = async (itemData, realmId) => {
  // 3. Validate and map fields
    if (!itemData?.Id || !itemData?.Name) {
      console.warn('⚠️ Invalid item from QuickBooks');
      return;
    }

    // 4. Create or upsert the item in local DB
    await Item.updateOne(
      { itemId: itemData.Id, realmId: realmId },
      {
        $set: {
          name: itemData.Name,
          sku: itemData.Sku || '',
          type: itemData.Type,
          active: itemData.Active,
          quantity: itemData.QtyOnHand ?? 0,
          price: itemData.UnitPrice ?? 0,
          description: itemData.Description || '',
          syncTime: new Date(itemData.MetaData?.LastUpdatedTime),
          raw: itemData,
          updatedAt: new Date(),
          createdAt: new Date()
        }
      },
      { upsert: true }
    );

   
  };

