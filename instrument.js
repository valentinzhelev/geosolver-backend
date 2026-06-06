// Sentry must be initialized before any other module is required, so that
// the Express / HTTP instrumentation can patch them. This file is required
// at the very top of index.js (after dotenv).
const Sentry = require('@sentry/node');

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0.1),
  });
}

module.exports = Sentry;
