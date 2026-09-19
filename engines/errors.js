/**
 * Structured, machine-readable engine failure. Thrown by normalization, validation and
 * computation; the route turns it into a 400 { error, code, field? } — a validation failure
 * must never become a 500. `message` is user-facing Bulgarian (the same wording the frontend
 * domain layer uses); `code` is the stable contract callers should branch on.
 */
class EngineError extends Error {
  constructor(code, message, field) {
    super(message);
    this.name = 'EngineError';
    this.code = code;
    if (field !== undefined) this.field = field;
    this.status = 400;
  }

  toResponseBody() {
    const body = { error: this.message, code: this.code };
    if (this.field !== undefined) body.field = this.field;
    return body;
  }
}

const isEngineError = (e) => e instanceof EngineError;

module.exports = { EngineError, isEngineError };
