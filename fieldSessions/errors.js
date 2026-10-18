/**
 * Field Session errors. Like capture/errors.js, every client-visible message is a fixed Bulgarian sentence chosen
 * here by code - never derived from an input value, a database error or a stack.
 */
const PUBLIC = {
  INVALID_REQUEST: { status: 400, message: 'Невалидна заявка.' },
  NOT_FOUND: { status: 404, message: 'Теренната сесия не е намерена.' },
  FORBIDDEN: { status: 403, message: 'Нямате права за този проект.' },
  SESSION_CONFIRMED: { status: 409, message: 'Сесията е потвърдена и не може да се променя. Създайте ревизия, за да направите корекции.' },
  NOT_CONFIRMED: { status: 409, message: 'Сесията още не е потвърдена.' },
  REVISION_CONFLICT: { status: 409, message: 'Сесията е променена от друго устройство. Презаредете и опитайте отново.' },
  VALIDATION_ERRORS: { status: 422, message: 'В сесията има грешки, които трябва да се поправят преди потвърждаване.' },
  SOURCE_CONFLICT: { status: 409, message: 'Сесията вече има друг източник на данни.' },
  CAPTURE_NOT_FOUND: { status: 404, message: 'Заснемането не е намерено.' },
  CAPTURE_NOT_NOTEBOOK: { status: 400, message: 'Към сесия може да се добави само заснет полеви карнет.' },
  CAPTURE_ALREADY_ATTACHED: { status: 409, message: 'Това заснемане вече е добавено към друга сесия.' },
  CAPTURE_FAILED: { status: 409, message: 'Неуспешно заснемане не може да се добави към сесия.' },
  CONFIRM_IN_PROGRESS: { status: 409, message: 'Потвърждаването вече е в ход.' },
  CONFIRM_FAILED: { status: 500, message: 'Потвърждаването не успя. Опитайте отново.' },
  // 503, recoverable: the evidence store is not ready for session-origin sets yet (the one-time index migration has not
  // been applied). The claim is released and nothing is lost - the same confirm succeeds once the migration has run.
  CONFIRM_UNAVAILABLE: { status: 503, message: 'Потвърждаването временно не е налично – системата се обновява. Сесията е запазена, опитайте отново след малко.' },
  CAPTURE_CONFIRMED: { status: 409, message: 'Потвърдено заснемане не може да се добави като страница – то вече е записано като данни.' },
  PAGE_LIMIT_REACHED: { status: 409, message: 'Сесията е достигнала максималния брой страници. Създайте нова сесия за останалите.' },
  PAGE_NOT_FOUND: { status: 404, message: 'Страницата не е намерена в тази сесия.' },
  PAGE_DUPLICATE: { status: 409, message: 'Тази страница вече е в сесията.' },
  PAGES_NOT_READY: { status: 409, message: 'Някои страници още не са готови. Изчакайте обработката или ги премахнете.' },
  NOTHING_TO_SUBMIT: { status: 422, message: 'Добавете поне едно наблюдение, преди да изпратите за проверка.' },
  USE_CAPTURE_REVIEW: { status: 409, message: 'Тази сесия се потвърждава от прегледа на заснемането.' },
};

class FieldSessionError extends Error {
  constructor(code, extra = {}) {
    const def = PUBLIC[code] || PUBLIC.INVALID_REQUEST;
    super(def.message);
    this.name = 'FieldSessionError';
    this.code = PUBLIC[code] ? code : 'INVALID_REQUEST';
    this.status = def.status;
    this.extra = extra;
  }
}

const isFieldSessionError = (e) => e instanceof FieldSessionError;

module.exports = { FieldSessionError, isFieldSessionError, PUBLIC_MESSAGES: PUBLIC };
