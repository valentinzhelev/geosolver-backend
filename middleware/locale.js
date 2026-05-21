const { resolveLang, localizeBody } = require('../utils/i18n');

/**
 * Sets req.lang and localizes JSON response message/error fields for English clients.
 */
module.exports = function localeMiddleware(req, res, next) {
  req.lang = resolveLang(req);

  const originalJson = res.json.bind(res);
  res.json = function localizedJson(body) {
    return originalJson(localizeBody(body, req.lang));
  };

  next();
};
