class GaiError extends Error {
  constructor(code, message, field, status) {
    super(message || code);
    this.name = 'GaiError';
    this.code = code;
    this.field = field || null;
    this.status = status || 400;
  }
}

module.exports = { GaiError };
