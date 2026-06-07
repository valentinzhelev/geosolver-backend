/** Frontend origin for links in emails (reset password, notifications). */
function getFrontendUrl() {
  const url = process.env.FRONTEND_URL || process.env.APP_URL || process.env.BASE_URL;
  if (url) return url.replace(/\/$/, '');
  return 'http://localhost:3000';
}

/** Public API origin for backend-only links (e.g. email verification). */
function getApiPublicUrl() {
  const url = process.env.API_PUBLIC_URL || process.env.BACKEND_URL;
  if (url) return url.replace(/\/$/, '');
  if (process.env.PORT) return `http://localhost:${process.env.PORT}`;
  return 'http://localhost:5000';
}

module.exports = { getFrontendUrl, getApiPublicUrl };
