/**
 * Instrument Import errors and issue messages. Every client-visible text is a fixed Bulgarian sentence chosen here by code - never
 * derived from the file's content, a parser exception or a stack.
 *
 * FILE-level errors (InstrumentImportError) refuse the whole file. RECORD-level issues are attached to the record they concern and
 * never stop the rest of the file from being reviewed.
 */
const FILE_ERRORS = {
  NO_FILE: { status: 400, message: 'Не е избран файл.' },
  EMPTY_FILE: { status: 422, message: 'Файлът е празен.' },
  FILE_TOO_LARGE: { status: 413, message: 'Файлът е твърде голям за импорт от инструмент.' },
  TOO_MANY_LINES: { status: 413, message: 'Файлът съдържа твърде много редове.' },
  TOO_MANY_RECORDS: { status: 413, message: 'Файлът съдържа твърде много записа.' },
  TOO_MANY_SETUPS: { status: 413, message: 'Файлът съдържа твърде много станции.' },
  BINARY_FILE: { status: 422, message: 'Файлът не е текстов. Очаква се текстов файл на Leica GSI.' },
  UNSUPPORTED_ENCODING: { status: 422, message: 'Кодировката на файла не се поддържа. Очаква се ASCII / UTF-8 текст.' },
  UNSUPPORTED_FORMAT: { status: 422, message: 'Форматът не е разпознат.' },
  AMBIGUOUS_GSI_FORMAT: { status: 422, message: 'Форматът не може да бъде определен еднозначно (GSI-8 или GSI-16). Проверете настройките на експорта.' },
};

const ISSUES = {
  INVALID_RECORD: 'Редът не е валиден запис на Leica GSI.',
  MALFORMED_NUMBER: 'Стойността не е валидно число.',
  UNSUPPORTED_UNIT: 'Мерната единица не се поддържа (поддържат се метри, гони и градуси).',
  UNKNOWN_WORD: 'Неизвестно поле Leica – запазено е, но не се използва.',
  MISSING_STATION: 'Наблюденията нямат станционен запис. Задайте станцията изрично или ги изключете.',
  MISSING_TARGET: 'Наблюдението няма номер на точка (цел).',
  MISSING_DIRECTION: 'Наблюдението няма хоризонтален ъгъл (Hz).',
  MISSING_DISTANCE: 'Наблюдението няма разстояние (наклонено или хоризонтално). Изключете го или го изберете за ориентир.',
  NON_POSITIVE_DISTANCE: 'Разстоянието трябва да е по-голямо от нула.',
  NEGATIVE_HEIGHT: 'Височината не може да бъде отрицателна.',
  TARGET_IS_STATION: 'Целта съвпада със станцията.',
  COINCIDENT_ORIENTATION: 'Ориентирът съвпада със станцията.',
  DUPLICATE_OBSERVATION: 'Повтарящо се наблюдение към същата цел в тази станция. Изключете излишното.',
  AXIS_MAPPING_UNRESOLVED: 'Координатите в записа са непълни (липсва изток или север) и не се използват.',
  MISSING_ORIENTATION: 'Не е избран ориентир за тази станция.',
  INVALID_DECISION: 'Изборът не съответства на записите във файла.',
  DUPLICATE_FILE: 'Същият файл вече е импортиран в този проект.',
  NO_OBSERVATIONS: 'Във файла няма наблюдения за потвърждаване.',
};

class InstrumentImportError extends Error {
  constructor(code, extra = {}) {
    const def = FILE_ERRORS[code] || FILE_ERRORS.UNSUPPORTED_FORMAT;
    super(def.message);
    this.name = 'InstrumentImportError';
    this.code = FILE_ERRORS[code] ? code : 'UNSUPPORTED_FORMAT';
    this.status = def.status;
    this.extra = extra;
  }
}

const isInstrumentImportError = (e) => e instanceof InstrumentImportError;

module.exports = { InstrumentImportError, isInstrumentImportError, FILE_ERRORS, ISSUES };
