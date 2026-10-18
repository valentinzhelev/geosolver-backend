/**
 * Leica GSI golden fixtures. Every line is written out LITERALLY (word by word, as an instrument writes it) and every expected value
 * in the tests was derived by hand from the GSI word layout - never by running the parser:
 *
 *   word = WI (2) + info (4: pos3, auto index, input mode, unit) + sign (1) + data (8 for GSI-8 / 16 for GSI-16), blank-separated;
 *   GSI-16 lines start with "*". Units: 0 = m (3 decimals), 2 = gon (5), 3 = decimal degrees (5), 4 = DDD.MMSSs (5), 6 = m (4),
 *   8 = m (5); 1 / 7 = feet and 5 = mil are NOT supported.
 *
 * The small `gsi8` / `gsi16` builders are only used to WRITE larger end-to-end files; they format digits, they never read them.
 */

// ---- A. GSI-8, one station (gon, metres) ----------------------------------------------------------------------------------------
// station 101 (E 1000.000, N 2000.000, H 125.000, i 1.550); 102 = orientation candidate (Hz 0, V 100 gon, S 150.000, prism 1.600);
// 201: Hz 50.12340 gon, V 98.76540 gon, S 85.432 m.
const A_GSI8_SINGLE = [
  '110001+00000101 84..10+01000000 85..10+02000000 86..10+00125000 88..10+00001550 ',
  '110002+00000102 21.322+00000000 22.322+10000000 31..00+00150000 87..10+00001600 ',
  '110003+00000201 21.322+05012340 22.322+09876540 31..00+00085432 87..10+00001600 ',
].join('\r\n');

// ---- B. GSI-16, one station (DMS degrees), with the AXIS golden values --------------------------------------------------------
// station 101: E 500000.000, N 4700000.000, H 125.000, i 1.550 -> GeoSolver X = 4700000.000 (north), Y = 500000.000 (east)
// 102: Hz 0, V 90 00'00.0", S 150.000; 201: Hz 45 30'15.0", V 89 59'58.0", S 85.432, target E 500060.408 N 4700060.408 H 125.432
const B_GSI16_SINGLE = [
  '*110001+0000000000000101 84..10+0000000500000000 85..10+0000004700000000 86..10+0000000000125000 88..10+0000000000001550 ',
  '*110002+0000000000000102 21.324+0000000000000000 22.324+0000000009000000 31..00+0000000000150000 87..10+0000000000001600 ',
  '*110003+0000000000000201 21.324+0000000004530150 22.324+0000000008959580 31..00+0000000000085432 87..10+0000000000001600 81..00+0000000500060408 82..00+0000004700060408 83..00+0000000000125432 ',
].join('\n');

// ---- C. multi-station GSI-8: 101 (-> 102), then 102 (-> 101 back, 103 fore) -------------------------------------------------------
const C_MULTI_STATION = [
  '110001+00000101 88..10+00001500 ',
  '110002+00000100 21.322+00000000 22.322+10000000 ',
  '110003+00000102 21.322+12000000 22.322+10000000 31..00+00100000 ',
  '110004+00000102 88..10+00001450 ',
  '110005+00000101 21.322+00000000 22.322+10000000 31..00+00100000 ',
  '110006+00000103 21.322+21000000 22.322+10000000 31..00+00080000 ',
].join('\n');

// ---- E. explicit horizontal distance (32), no slope distance --------------------------------------------------------------------
const E_HORIZONTAL = [
  '110001+00000101 88..10+00001500 ',
  '110002+00000202 21.322+15000000 32..00+00042195 ',
].join('\n');

// ---- F/G. decimal-degree angles, a point code in the record, a standalone code block, remarks ----------------------------------
// 201: Hz 123.45678 deg, V 91.23450 deg, S 10.0000 m (unit 6: 4 decimals), code "H66", remark "FENCE"; then a code block "20"/"OFFICE"
const F_DEGREES_AND_CODES = [
  '110001+00000101 88..10+00001500 ',
  '110002+00000201 21.323+12345678 22.323+09123450 31..06+00100000 41....+00000H66 71....+000FENCE ',
  '410003+00000020 42....+00OFFICE ',
].join('\n');

// ---- I/J/K. unknown optional word, malformed word, unsupported units ------------------------------------------------------------
const I_UNKNOWN_WORD = [
  '110001+00000101 88..10+00001500 ',
  '110002+00000201 21.322+05000000 22.322+10000000 31..00+00012345 99..00+00004711 ',
].join('\n');
const J_MALFORMED_WORD = [
  '110001+00000101 88..10+00001500 ',
  '110002+00000201 21.322+0A000000 22.322+10000000 31..00+00012345 ',
  '110003+00000202 21.322+06000000 22.322+10000000 31..00+00012345 ',
].join('\n');
const K_FEET = [
  '110001+00000101 88..10+00001500 ',
  '110002+00000201 21.322+05000000 22.322+10000000 31..01+00012345 ',
].join('\n');
const K_MIL = [
  '110001+00000101 88..10+00001500 ',
  '110002+00000201 21.325+05000000 22.322+10000000 31..00+00012345 ',
].join('\n');

// ---- L. ambiguous / unsupported files --------------------------------------------------------------------------------------------
const L_MIXED_MARKERS = [
  '*110001+0000000000000101 88..10+0000000000001500 ',
  '110002+00000201 21.322+05000000 22.322+10000000 31..00+00012345 ',
].join('\n');
const L_SIXTEEN_WITHOUT_MARKER = [
  '110001+0000000000000101 88..10+0000000000001500 ',
  '110002+0000000000000201 21.322+0000000005000000 31..00+0000000000012345 ',
].join('\n');
const NOT_GSI = ['Point,X,Y,H', '101,4700000.000,500000.000,125.000', '102,4700100.000,500000.000,126.000'].join('\n');

// ---- builders for end-to-end files -----------------------------------------------------------------------------------------------
const pad = (s, n) => String(s).padStart(n, '0');
const digits = (value, decimals) => Math.round(Math.abs(value) * 10 ** decimals).toString();
const sign = (value) => (value < 0 ? '-' : '+');
function wordBuilder(width) {
  return {
    point: (name, block = 1) => `11${pad(block, 4)}+${pad(name, width)}`,
    gon: (wi, v) => `${wi}.322${sign(v)}${pad(digits(v, 5), width)}`,
    metres: (wi, v, mode = 0) => `${wi}..${mode}0${sign(v)}${pad(digits(v, 3), width)}`,
    text: (wi, t) => `${wi}....+${pad(t, width)}`,
  };
}
const line = (format, words) => `${format === 'GSI-16' ? '*' : ''}${words.join(' ')} `;

module.exports = {
  A_GSI8_SINGLE,
  B_GSI16_SINGLE,
  C_MULTI_STATION,
  E_HORIZONTAL,
  F_DEGREES_AND_CODES,
  I_UNKNOWN_WORD,
  J_MALFORMED_WORD,
  K_FEET,
  K_MIL,
  L_MIXED_MARKERS,
  L_SIXTEEN_WITHOUT_MARKER,
  NOT_GSI,
  gsi8: wordBuilder(8),
  gsi16: wordBuilder(16),
  line,
};
