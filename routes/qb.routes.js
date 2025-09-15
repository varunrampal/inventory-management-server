import express from "express";
import OAuthClient from "intuit-oauth"; // <-- add this import
import { newOAuthClient, ENVIRONMENT, baseApiHost } from "../integrations/quickbooks.js";
import QuickBooksConnection from "../models/QuickBooksConnection.js";

const router = express.Router();

// Start OAuth
router.get("/connect", (req, res) => {
  const oauthClient = newOAuthClient();
  const url = oauthClient.authorizeUri({
    scope: [OAuthClient.scopes.Accounting], // <-- use class, not instance
    state: "csrf-" + Math.random().toString(36).slice(2),
  });
  res.redirect(url);
});
// OAuth callback
router.get("/callback", async (req, res) => {
  const oauthClient = newOAuthClient();
  try {
    const authResponse = await oauthClient.createToken(req.url);
    const tokenJson = authResponse.getJson();
    const realmId = oauthClient.getToken().realmId;

    await QuickBooksConnection.findOneAndUpdate(
      { realmId },
      {
        realmId,
        environment: ENVIRONMENT,
        access_token: tokenJson.access_token,
        refresh_token: tokenJson.refresh_token,
        expires_at: Date.now() + tokenJson.expires_in * 1000,
      },
      { upsert: true, new: true }
    );

    const publicBase = process.env.PUBLIC_BASE_URL;
    res.redirect(`${publicBase}/qb/connected?realmId=${encodeURIComponent(realmId)}`);
  } catch (e) {
    console.error("QB callback error", e);
    res.status(400).send("QuickBooks authorization failed.");
  }
});

// Helper: ensure fresh token
async function ensureAccessToken(realmId) {
  const conn = await QuickBooksConnection.findOne({ realmId });
  if (!conn) throw new Error("Not connected to QuickBooks.");

  if (Date.now() < conn.expires_at - 60 * 1000) return conn.access_token;

  const oauthClient = newOAuthClient();
  oauthClient.setToken({
    token_type: "bearer",
    access_token: conn.access_token,
    refresh_token: conn.refresh_token,
    expires_in: Math.floor((conn.expires_at - Date.now()) / 1000),
  });

  const refreshed = await oauthClient.refresh();
  const json = refreshed.getJson();

  conn.access_token = json.access_token;
  conn.refresh_token = json.refresh_token || conn.refresh_token;
  conn.expires_at = Date.now() + json.expires_in * 1000;
  await conn.save();

  return conn.access_token;
}

// Status
router.get("/status", async (req, res) => {
  const anyConn = await QuickBooksConnection.findOne().lean();
  res.json({ environment: ENVIRONMENT, connected: !!anyConn });
});

// Company info
router.get("/company-info", async (req, res) => {
  try {
    const realmId = req.query.realmId;
    if (!realmId) return res.status(400).json({ error: "realmId is required" });

    const access = await ensureAccessToken(realmId);
    const r = await fetch(
      `https://${baseApiHost()}.api.intuit.com/v3/company/${realmId}/companyinfo/${realmId}`,
      { headers: { Authorization: `Bearer ${access}`, Accept: "application/json" } }
    );
    const j = await r.json();
    res.json(j);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to fetch company info." });
  }
});

// Customers
router.get("/customers", async (req, res) => {
  try {
    const realmId = req.query.realmId;
    if (!realmId) return res.status(400).json({ error: "realmId is required" });

    const access = await ensureAccessToken(realmId);
    const r = await fetch(
      `https://${baseApiHost()}.api.intuit.com/v3/company/${realmId}/query?query=select%20*%20from%20Customer%20maxresults%2050`,
      { headers: { Authorization: `Bearer ${access}`, Accept: "application/json" } }
    );
    const j = await r.json();
    res.json(j);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to fetch customers." });
  }
});

export default router;
