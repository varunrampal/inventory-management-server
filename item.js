// project/items.js
export const createItem = async (db, item) => {
  item.createdAt = new Date();
  item.updatedAt = new Date();

  const result = await db.collection('item').insertOne(item);
  return result.insertedId;
};

export const getItemById = async (db, id) => {
  return await db.collection('item').findOne({ _id: new ObjectId(id) });
};

export const getItemByQuickBooksId = async (db, quickbooksId) => {
  return await db.collection('item').findOne({ quickbooksId });
};

export const getAllItems = async (db) => {
  return await db.collection('item').find().sort({ updatedAt: -1 }).toArray();
};

export const updateItemByQuickBooksId = async (db, quickbooksId, updates) => {
  updates.updatedAt = new Date();

  const result = await db.collection('item').updateOne(
    { quickbooksId },
    { $set: updates }
  );

  return result.modifiedCount > 0;
};

export const deleteItemByQuickBooksId = async (db, quickbooksId) => {
  const result = await db.collection('item').deleteOne({ quickbooksId });
  return result.deletedCount > 0;
};
