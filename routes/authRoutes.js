import express from 'express';
import { initiateAuthFlow } from '../utils/initiateAuthFlow.js';

const router = express.Router();

// GET /auth/initiate?realmId=123456
router.get('/initiate', async (req, res) => {
  const { realmId } = req.query;

  console.log(`🔄 Initiating auth flow for realmId: ${realmId}`);
  if (!realmId) return res.status(400).json({ error: 'Missing realmId' });

  try {
    const authUrl = await initiateAuthFlow(realmId);
    res.json({ authUrl });
  } catch (err) {
    console.error('❌ Error generating auth URL:', err.message);
    res.status(500).json({ error: 'Failed to initiate auth flow' });
  }
});

export default router;