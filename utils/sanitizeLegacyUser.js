const VALID_ROLES = ['student', 'teacher', 'admin'];

/** Fix legacy users saved with invalid role (e.g. role: 'free' from an old registration bug). */
function sanitizeLegacyUser(user) {
  if (!user) return user;
  if (!VALID_ROLES.includes(user.role)) {
    user.role = 'student';
  }
  if (!Array.isArray(user.refreshTokens)) {
    user.refreshTokens = [];
  }
  return user;
}

module.exports = { sanitizeLegacyUser };
