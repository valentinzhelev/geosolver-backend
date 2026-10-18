/**
 * Leica GSI word indices (WI) and unit codes - the SUPPORTED SUBSET, each entry with its documented meaning. Nothing here is guessed:
 *
 *   Sources: Total Open Station, "leica_gsi - GSI" input format documentation (word layout, WI table, unit and input-mode codes);
 *   Leica Geosystems, Map360 "Leica GSI" format page (GSI-8 / GSI-16 sample lines, the "*" prefix of GSI-16 lines). The Leica
 *   GSI-8 sample "21.324+00000000 22.324+08959580 31..00+00156134 81..00+01000000 82..00+01156134" is internally consistent only
 *   with 81 = Easting and 82 = Northing (Hz 0 = north, a ~horizontal 156.134 m shot moves the NORTHING by 156.134) and with unit
 *   code 4 = sexagesimal degrees DDD.MMSSs (89 59'58.0").
 *
 * Categories:
 *   text    - an identifier / free text (point number, code, information)
 *   angle   - an angle; its unit comes from position 6 of the word
 *   length  - a distance, height or coordinate; its unit comes from position 6 of the word
 *   unused  - a documented word GeoSolver does not use (kept, shown in the raw detail, never silently dropped)
 * Any WI not listed is UNKNOWN: kept with its raw code, reported as "Неизвестно поле Leica", never used.
 *
 * Vertical angle (WI 22): the documentation calls it "Vertical angle V" and does NOT say whether it is a zenith angle or an
 * elevation angle - that is an instrument setting. GeoSolver therefore keeps it as the V reading exactly as recorded; the
 * convention (zenith / vertical) is the explicit choice the processing step already asks for.
 */
const WORDS = {
  11: { category: 'text', key: 'pointId', label: 'Номер на точка' },
  12: { category: 'unused', key: 'serialNumber', label: 'Сериен номер на инструмента' },
  13: { category: 'unused', key: 'instrumentType', label: 'Тип инструмент' },
  16: { category: 'unused', key: 'stationNumber', label: 'Номер на станция (служебно)' },
  18: { category: 'unused', key: 'yearSecond', label: 'Година / секунди (служебно)' },
  19: { category: 'unused', key: 'dateTime', label: 'Дата и час' },
  21: { category: 'angle', key: 'hz', label: 'Хоризонтален ъгъл (Hz)' },
  22: { category: 'angle', key: 'v', label: 'Вертикален ъгъл (V)' },
  25: { category: 'unused', key: 'hzDifference', label: 'Разлика на хоризонталния кръг (Hz0 − Hz)' },
  31: { category: 'length', key: 'slopeDistance', label: 'Наклонено разстояние' },
  32: { category: 'length', key: 'horizontalDistance', label: 'Хоризонтално разстояние' },
  33: { category: 'length', key: 'heightDifference', label: 'Превишение' },
  41: { category: 'text', key: 'code', label: 'Код' },
  51: { category: 'unused', key: 'ppmPrism', label: 'PPM и константа на призмата' },
  52: { category: 'unused', key: 'measurementStats', label: 'Брой измервания / стандартно отклонение' },
  53: { category: 'unused', key: 'signal', label: 'Сила на сигнала' },
  58: { category: 'unused', key: 'prismConstant', label: 'Константа на призмата' },
  59: { category: 'unused', key: 'ppm', label: 'PPM' },
  81: { category: 'length', key: 'targetEasting', label: 'Изток на целта (E)' },
  82: { category: 'length', key: 'targetNorthing', label: 'Север на целта (N)' },
  83: { category: 'length', key: 'targetHeight', label: 'Кота на целта (H)' },
  84: { category: 'length', key: 'stationEasting', label: 'Изток на станцията (E0)' },
  85: { category: 'length', key: 'stationNorthing', label: 'Север на станцията (N0)' },
  86: { category: 'length', key: 'stationHeight', label: 'Кота на станцията (H0)' },
  87: { category: 'length', key: 'reflectorHeight', label: 'Височина на рефлектора' },
  88: { category: 'length', key: 'instrumentHeight', label: 'Височина на инструмента' },
};
for (let i = 42; i <= 49; i += 1) WORDS[i] = { category: 'text', key: `info${i - 41}`, label: `Информация ${i - 41}` };
for (let i = 71; i <= 79; i += 1) WORDS[i] = { category: 'text', key: `remark${i - 70}`, label: `Бележка ${i - 70}` };

// 3-digit word indices documented for newer series (atmospherics, date, software, job, operator). Recognised ONLY as service data:
// position 3 of these words is part of the index, which is why they are listed explicitly instead of read from position 3.
const EXTENDED = new Set(['531', '538', '560', '561', '562', '590', '591', '592', '593', '594', '595', '913', '914']);

/** Position 6 of an angle / length word. `decimals` = how many trailing digits are decimals. Feet and mil are NOT supported. */
const UNITS = {
  0: { kind: 'length', unit: 'm', decimals: 3, label: 'метри (1 mm)' },
  1: { kind: 'length', unsupported: true, label: 'футове' },
  2: { kind: 'angle', unit: 'gon', decimals: 5, label: 'гони (400 gon)' },
  3: { kind: 'angle', unit: 'deg', decimals: 5, label: 'градуси (десетични)' },
  4: { kind: 'angle', unit: 'dms', decimals: 5, label: 'градуси (° ′ ″)' },
  5: { kind: 'angle', unsupported: true, label: 'мили (6400)' },
  6: { kind: 'length', unit: 'm', decimals: 4, label: 'метри (0,1 mm)' },
  7: { kind: 'length', unsupported: true, label: 'футове' },
  8: { kind: 'length', unit: 'm', decimals: 5, label: 'метри (0,01 mm)' },
};

const INPUT_MODES = { 0: 'измерено', 1: 'ръчно въведено', 2: 'измерено, Hz корекция вкл.', 3: 'измерено, Hz корекция изкл.', 4: 'резултат от функция' };

module.exports = { WORDS, EXTENDED, UNITS, INPUT_MODES };
