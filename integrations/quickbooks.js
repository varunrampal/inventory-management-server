import OAuthClient from "intuit-oauth";
import dotenv from "dotenv";
dotenv.config();

const {
  QUICKBOOKS_ENV = "sandbox",
  QB_SANDBOX_CLIENT_ID,
  QB_SANDBOX_CLIENT_SECRET,
  QB_PROD_CLIENT_ID,
  QB_PROD_CLIENT_SECRET,
  QB_REDIRECT_URI,
} = process.env;

const isProd = QUICKBOOKS_ENV === "production";


const QB_BASE_URL = isProd
  ? "https://quickbooks.api.intuit.com"
  : "https://sandbox-quickbooks.api.intuit.com";

export const ENVIRONMENT = isProd ? "production" : "sandbox";
export const CLIENT_ID = isProd ? QB_PROD_CLIENT_ID : QB_SANDBOX_CLIENT_ID;
export const CLIENT_SECRET = isProd ? QB_PROD_CLIENT_SECRET : QB_SANDBOX_CLIENT_SECRET;
export const REDIRECT_URI = isProd
  ? process.env.QB_PROD_REDIRECT_URI
  : process.env.QB_SANDBOX_REDIRECT_URI;

export function newOAuthClient() {
  return new OAuthClient({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    environment: ENVIRONMENT,
    redirectUri: REDIRECT_URI,
  });
}

export function baseApiHost() {
  return ENVIRONMENT === "production" ? "quickbooks" : "sandbox-quickbooks";
}

export function qbUrl(realmId, path, params = {}) {
  const url = new URL(`${QB_BASE_URL}/v3/company/${realmId}/${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.append(k, String(v)));
  return url.toString();
}