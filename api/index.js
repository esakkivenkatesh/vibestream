const app = require('../backend/server');

module.exports = (req, res) => {
  if (!process.env.JAMENDO_CLIENT_ID) {
    console.warn('[VibeStream-Vercel] JAMENDO_CLIENT_ID is not set in process.env!');
  }
  return app(req, res);
};
