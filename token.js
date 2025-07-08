// tokens.js
import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();
import Token from './models/token.js'; // Adjust the path as necessary

const {
  CLIENT_ID,
  CLIENT_SECRET
} = process.env;

/**
 * Save or update QuickBooks tokens in MongoDB
 * @param {Object} db - MongoDB database instance
 * @param {string} realmId - QuickBooks company ID
 * @param {Object} tokenData - { access_token, refresh_token, expires_in }
 */


export const saveTokenToMongo = async (realmId, tokenData) => {
  const { access_token, refresh_token, expires_in } = tokenData;

  const expires_at = new Date(Date.now() + expires_in * 1000); // 1 hr from now

  await Token.updateOne(
    { realmId },
    {
      $set: {
        access_token,
        refresh_token,
        expires_at,
        updatedAt: new Date()
      }
    },
    { upsert: true }
  );

  console.log(`✅ Tokens saved for realmId: ${realmId}`);
};

/**
 * Get a valid access token (refresh if expired)
 * @param {string} realmId
 * @param {Object} db - MongoDB db instance
 * @returns {Promise<string>} access_token
 */
export const getValidAccessToken = async (realmId) => {
  const tokenDoc = await Token.findOne({ realmId });

  if (!tokenDoc) throw new Error(`❌ No token found for realmId: ${realmId}`);

  const now = new Date();

  // Access token is still valid
  if (now < new Date(tokenDoc.expires_at)) {
    return tokenDoc.access_token;
  }

  console.log('🔁 Access token expired. Refreshing...');

  // Refresh token request
  const res = await axios.post(
    'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokenDoc.refresh_token
    }),
    {
      headers: {
        Authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    }
  );

  const { access_token, refresh_token, expires_in } = res.data;
  const newExpiresAt = new Date(Date.now() + expires_in * 1000);

  // Save updated token
  await Token.updateOne(
    { realmId },
    {
      $set: {
        access_token,
        refresh_token: refresh_token || tokenDoc.refresh_token,
        expires_at: newExpiresAt,
        updatedAt: new Date()
      }
    }
  );

  console.log('✅ Access token refreshed.');
  return access_token;
};

/**
 * Get token document (optional, for debugging or admin)
 * @param {string} realmId
 * @param {Object} db
 * @returns {Promise<Object>}
 */
export const getTokenDoc = async (realmId, db) => {
  return await Token.findOne({ realmId });
};
