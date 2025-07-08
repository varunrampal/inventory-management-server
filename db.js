import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
dotenv.config();
let dbInstance;


// Initialize MongoDB client
// Ensure you have the MONGO_URI set in your .env file
const uri = process.env.MONGO_URI;
const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 5000,
  connectTimeoutMS: 10000
});

// Check if the connection is successful

const connect = async () => {
  if (!dbInstance) {
    await client.connect();
    dbInstance = client.db('pnpinventoryDB'); // Update name if needed
    console.log('✅ Connected to MongoDB');
  }
  return dbInstance;
};

const get = () => {
  if (!dbInstance) {
    throw new Error('❌ DB not connected. Call db.connect() first.');
  }
  return dbInstance;
};

const close = async () => {
  if (client && client.topology && client.topology.isConnected()) {
    await client.close();
    dbInstance = null;
    console.log('🔌 MongoDB connection closed');
  }
};

export default {
  connect,
  get,
  close
};