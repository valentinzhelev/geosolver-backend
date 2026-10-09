class GaiError extends Error {
  constructor(code, message, field, status) {
    super(message || code);
    this.name = 'GaiError';
    this.code = code;
    this.field = field || null;
    this.status = status || 400;
  }
}

/**
 * The ONLY messages a client can ever receive for GAI generation failures (V1.0.2). Provider adapters normalise
 * every vendor failure into one of these codes; routes render from this table, never from an error's own message,
 * so no provider payload, HTTP code, vendor name, billing link or stack can reach a user.
 */
const PUBLIC_ERRORS = {
  GAI_DISABLED: { status: 503, message: 'Асистентът временно не е активен.' },
  PROVIDER_NOT_CONFIGURED: { status: 503, message: 'Асистентът не е настроен.' },
  PROVIDER_UNAVAILABLE: { status: 503, message: 'Асистентът временно не е достъпен.' },
  PROVIDER_TIMEOUT: { status: 504, message: 'Отговорът се забави прекалено дълго. Опитайте отново.' },
  PROVIDER_ERROR: { status: 502, message: 'Възникна проблем при генерирането на отговора.' },
};
const GENERIC_ERROR = { status: 500, code: 'INTERNAL', message: 'Възникна проблем при генерирането на отговора.' };

/** A normalised GaiError for a known public code. */
function gaiError(code) {
  const e = PUBLIC_ERRORS[code];
  return new GaiError(code, e.message, null, e.status);
}

/** Maps anything thrown during generation to a safe {status, code, message}. Unknown -> generic, never raw text. */
function toPublicError(err) {
  if (err instanceof GaiError && PUBLIC_ERRORS[err.code]) return { code: err.code, ...PUBLIC_ERRORS[err.code] };
  return { ...GENERIC_ERROR };
}

module.exports = { GaiError, PUBLIC_ERRORS, gaiError, toPublicError };
