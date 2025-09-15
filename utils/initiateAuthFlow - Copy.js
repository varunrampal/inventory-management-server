import crypto from 'crypto';
import Token from '../models/token.js'; // Adjust the path as necessary

const CLIENT_ID = process.env.CLIENT_ID;
const REDIRECT_URI = process.env.REDIRECT_URI;
const SCOPE = 'com.intuit.quickbooks.accounting openid profile email phone address';
const AUTH_URL = 'https://appcenter.intuit.com/connect/oauth2';

export async function initiateAuthFlow(realmId) {
  const state = crypto.randomBytes(16).toString('hex');
  const url = new URL(AUTH_URL);
  url.searchParams.append('client_id', CLIENT_ID);
  url.searchParams.append('redirect_uri', REDIRECT_URI);
  url.searchParams.append('response_type', 'code');
  url.searchParams.append('scope', SCOPE);
  url.searchParams.append('state', state);

  await Token.findOneAndUpdate(
    { realmId },
    {
      realmId,
      state,
      accessToken: '',
      refreshToken: '',
      expiresAt: new Date(0)
    },
    { upsert: true }
  );

  return url.toString();
}