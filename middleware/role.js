module.exports = function requireRole(role) {
  return (req, res, next) => {
    if (!req.userRole || req.userRole !== role) {
      return res.status(403).json({ message: 'Нямате достъп.' });
    }
    next();
  };
}; 