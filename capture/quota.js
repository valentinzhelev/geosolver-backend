/**
 * Monthly Capture quota. The limit is CONFIGURATION (CAPTURE_MONTHLY_QUOTA, see capture/config.js); no business number
 * is hard-wired here and no pricing is involved. With no limit configured the check always passes.
 * What counts: jobs of the user this UTC month that actually reached the OCR provider.
 */
const CaptureJob = require('../models/CaptureJob');
const { CaptureError } = require('./errors');

const monthStart = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

async function usedThisMonth(userId, now = new Date()) {
  return CaptureJob.countDocuments({ user: userId, createdAt: { $gte: monthStart(now) }, 'provider.requestedAt': { $exists: true } });
}

async function assertWithinQuota(userId, limit, now = new Date()) {
  if (limit === null || limit === undefined) return { used: null, limit: null };
  const used = await usedThisMonth(userId, now);
  if (used >= limit) throw new CaptureError('QUOTA_EXCEEDED', { used, limit });
  return { used, limit };
}

module.exports = { assertWithinQuota, usedThisMonth, monthStart };
