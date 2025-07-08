// webhookHandler.js
import crypto from 'crypto';

export const verifyWebhook = (req, res, next) => {
  const signature = req.headers['intuit-signature'];
  const verifierToken = process.env.WEBHOOK_VERIFIER_TOKEN;
   console.log('Webhook signature:', signature);
  const rawBody = JSON.stringify(req.body);
  const hash = crypto.createHmac('sha256', verifierToken)
    .update(rawBody)
    .digest('base64');

  if (hash === signature) {
    return next();
  }

  return res.status(401).send('Webhook signature mismatch');
};


