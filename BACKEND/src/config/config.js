/**
 * App configuration.
 * FILE: src/config/config.js
 *
 * WHAT CHANGED:
 *   - Removed JWT_SECRET check (old — never existed in this project)
 *   - JWT is validated by env.js using JWT_ACCESS_SECRET + JWT_REFRESH_SECRET
 */

import dotenv from 'dotenv';
dotenv.config();

if (!process.env.PORT) {
  throw new Error('PORT not found in environment variables');
}

if (!process.env.MONGODB_URI) {
  throw new Error('MONGODB_URI not found in environment variables');
}

const config = {
  PORT:        process.env.PORT || 4000,
  MONGODB_URI: process.env.MONGODB_URI,
  NODE_ENV:    process.env.NODE_ENV || 'development',
  // The backend's own PUBLIC-facing URL -- used to construct the real Meta
  // webhook URL (/api/whatsapp/webhooks/meta/:tenantId) shown in Settings.
  // NOT the same as CLIENT_URL (that's the frontend's origin) and NOT
  // derivable from a browser request (the frontend only knows ITS OWN
  // origin, not the backend's -- which could be an ngrok tunnel or a
  // separate production domain entirely). Falls back to localhost for
  // local dev, but that fallback genuinely won't work as a real webhook
  // target -- Meta can't reach localhost. Set this explicitly (e.g. your
  // ngrok URL, or your real domain) for the webhook to actually function.
  API_BASE_URL: process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 4000}`,
};

if (!process.env.API_BASE_URL) {
  console.warn(
    '\n⚠️  API_BASE_URL is not set.' +
    '\n   Falling back to http://localhost:' + (process.env.PORT || 4000) + ' -- Meta cannot reach this.' +
    '\n   Set API_BASE_URL to your public URL (ngrok tunnel or real domain) for the WhatsApp webhook to work.\n'
  );
}

export default config;