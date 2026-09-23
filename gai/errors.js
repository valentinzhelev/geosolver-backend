class GaiError extends Error {
  constructor(code, message, field) {
    super(message || code);
    this.name = 'GaiError';
    this.code = code;
    this.field = field || null;
    this.status = 400;
  }
}

module.exports = { GaiError };
