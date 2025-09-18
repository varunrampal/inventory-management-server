// tokens.js
import axios from 'axios';
import dotenv from 'dotenv';
import crypto from 'crypto';
dotenv.config();
import Token from './models/token.js'; // Adjust the path as necessary

const {
QUICKBOOKS_ENV,
QB_PROD_CLIENT_ID,
QB_SANDBOX_CLIENT_ID,
QB_PROD_CLIENT_SECRET,
QB_SANDBOX_CLIENT_SECRET
} = process.env;

const isProd = QUICKBOOKS_ENV === "production";
const CLIENT_ID = isProd ? QB_PROD_CLIENT_ID : QB_SANDBOX_CLIENT_ID;
const CLIENT_SECRET = isProd ? QB_PROD_CLIENT_SECRET : QB_SANDBOX_CLIENT_SECRET;


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
  // if (!tokenDoc) {
  //   console.warn(`⚠️ No token found for realmId: ${realmId}. Initiating auth flow...`);
  //   const tokenEntry = await initiateAuthFlow(realmId); // Must return new token document
  //   if (!tokenEntry) throw new Error('Authorization failed.');
  // }
  

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

/**
 * Creates an OAuth2 authorization URL for QuickBooks and optionally stores a temp token entry.
 * In a real app, you would redirect the user to this URL from the frontend.
 */
export async function initiateAuthFlow(realmId) {

const CLIENT_ID = process.env.CLIENT_ID;
const REDIRECT_URI = process.env.REDIRECT_URI || 'http://localhost:4000/callback'; // Adjust as needed
const SCOPE = 'com.intuit.quickbooks.accounting openid profile email phone address';
const AUTH_URL = 'https://appcenter.intuit.com/connect/oauth2';

  const state = crypto.randomBytes(16).toString('hex');

  const url = new URL(AUTH_URL);
  url.searchParams.append('client_id', CLIENT_ID);
  url.searchParams.append('redirect_uri', REDIRECT_URI);
  url.searchParams.append('response_type', 'code');
  url.searchParams.append('scope', SCOPE);
  url.searchParams.append('state', state);

  // Store the realmId + state mapping temporarily in DB
  await Token.create({
    realmId,
    state,
    accessToken: '',
    refreshToken: '',
    expiresAt: new Date(0)
  });

  console.log(`🔑 Redirect user to authorize QuickBooks realmId=${realmId}`);
  console.log(`🌐 ${url.toString()}`);

  // Optional: Return auth URL to frontend
  return url.toString();
}
