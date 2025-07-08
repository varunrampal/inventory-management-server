import mongoose from 'mongoose';
const TokenSchema = new mongoose.Schema({
  realmId: { type: String, required: true, unique: true },
  access_token: String,
  refresh_token: String,
  expires_at: Date,
  updatedAt: Date
});

export default mongoose.model('Token', TokenSchema);