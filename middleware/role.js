/**
 * @param {...string} allowedRoles - e.g. requireRole('teacher') or requireRole('student')
 * Admin always passes (full Edu / panel access).
 */
module.exports = function requireRole(...allowedRoles) {
  const roles = allowedRoles.flat();
  return (req, res, next) => {
    if (!req.userRole) {
      return res.status(403).json({ success: false, message: 'Нямате достъп.' });
    }
    if (req.userRole === 'admin') {
      return next();
    }
    if (!roles.includes(req.userRole)) {
      return res.status(403).json({ success: false, message: 'Нямате достъп.' });
    }
    next();
  };
}; 