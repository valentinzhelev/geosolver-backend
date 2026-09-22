/**
 * Errors of the Capture domain. `message` is ALWAYS safe to send to a client (fixed Bulgarian text): it never contains
 * provider messages, OCR text, file content, paths or credentials. Internal detail is kept out of the object entirely;
 * callers log only the `code`.
 */
const MESSAGES = {
  INVALID_IMAGE: 'Файлът не е валидно изображение.',
  UNSUPPORTED_MEDIA_TYPE: 'Поддържат се само JPG, PNG и WebP изображения.',
  IMAGE_TOO_LARGE: 'Изображението е твърде голямо.',
  IMAGE_TOO_MANY_PIXELS: 'Изображението има твърде много пиксели.',
  IMAGE_TOO_SMALL: 'Изображението е твърде малко за разпознаване.',
  NO_FILE: 'Не е избран файл.',
  PROJECT_REQUIRED: 'Изберете проект.',
  PROJECT_FORBIDDEN: 'Нямате права за този проект.',
  QUOTA_EXCEEDED: 'Достигнахте месечния лимит за сканирания.',
  PROVIDER_NOT_CONFIGURED: 'Услугата за разпознаване не е налична.',
  PROVIDER_UNAVAILABLE: 'Разпознаването временно не е възможно. Опитайте отново по-късно.',
  PREPROCESS_FAILED: 'Изображението не можа да бъде обработено.',
  NO_TABLE_DETECTED: 'Не беше открита таблица с координати. Опитайте с по-ясна снимка.',
  NO_NOTEBOOK_DETECTED: 'Не беше разпозната поле-книжка (станция/наблюдения). Опитайте с по-ясна снимка.',
  NOT_FOUND: 'Сканирането не е намерено.',
  INVALID_STATE: 'Действието не е възможно в текущото състояние на сканирането.',
  INVALID_REQUEST: 'Невалидна заявка.',
  REVISION_CONFLICT: 'Данните са променени междувременно. Презаредете и опитайте отново.',
  VALIDATION_ERRORS: 'Има неразрешени грешки в таблицата.',
  POINT_CONFLICTS: 'Някои точки вече съществуват в проекта.',
  CONFIRM_IN_PROGRESS: 'Импортирането вече се изпълнява.',
  IMPORT_FAILED: 'Импортирането не беше завършено. Нищо не е записано.',
  IMAGE_EXPIRED: 'Изображението вече не се съхранява.',
};

const STATUS = {
  INVALID_IMAGE: 400, UNSUPPORTED_MEDIA_TYPE: 415, IMAGE_TOO_LARGE: 413, IMAGE_TOO_MANY_PIXELS: 413, IMAGE_TOO_SMALL: 400,
  NO_FILE: 400, PROJECT_REQUIRED: 400, PROJECT_FORBIDDEN: 403, QUOTA_EXCEEDED: 429, PROVIDER_NOT_CONFIGURED: 503,
  PROVIDER_UNAVAILABLE: 502, PREPROCESS_FAILED: 422, NO_TABLE_DETECTED: 422, NO_NOTEBOOK_DETECTED: 422, NOT_FOUND: 404, INVALID_STATE: 409,
  INVALID_REQUEST: 400, REVISION_CONFLICT: 409, VALIDATION_ERRORS: 422, POINT_CONFLICTS: 409, CONFIRM_IN_PROGRESS: 409,
  IMPORT_FAILED: 500, IMAGE_EXPIRED: 404,
};

class CaptureError extends Error {
  constructor(code, extra = {}) {
    super(MESSAGES[code] || 'Грешка.');
    this.name = 'CaptureError';
    this.code = code;
    this.status = STATUS[code] || 500;
    this.extra = extra; // structured, non-sensitive detail (e.g. conflicts) that is safe to return
  }
}

const isCaptureError = (e) => e instanceof CaptureError;

module.exports = { CaptureError, isCaptureError, MESSAGES };
