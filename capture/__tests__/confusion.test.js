const { isDigitConfusionPair, compareDigitStrings, generateLetterDigitAlternatives } = require('../confusion');

describe('digit confusion families', () => {
  it.each([
    ['0', '6'], ['0', '8'], ['0', '9'], ['6', '8'], ['8', '9'],
    ['1', '7'], ['3', '8'], ['4', '9'], ['5', '6'],
  ])('%s and %s are a known confusion pair (order independent)', (a, b) => {
    expect(isDigitConfusionPair(a, b)).toBe(true);
    expect(isDigitConfusionPair(b, a)).toBe(true);
  });

  it.each([['0', '1'], ['2', '3'], ['5', '9'], ['1', '4']])('%s and %s are NOT a known confusion pair', (a, b) => {
    expect(isDigitConfusionPair(a, b)).toBe(false);
  });

  it('a digit is never confusable with itself', () => {
    expect(isDigitConfusionPair('8', '8')).toBe(false);
  });
});

describe('compareDigitStrings', () => {
  it('flags mismatched positions and whether each is a known confusion', () => {
    const { aligned, mismatches } = compareDigitStrings('470003050', '470008050');
    expect(aligned).toBe(true);
    expect(mismatches).toEqual([{ index: 5, from: '3', to: '8', knownConfusion: true }]);
  });

  it('an unrelated mismatch is still reported, just not flagged as a known confusion', () => {
    const { mismatches } = compareDigitStrings('12', '15');
    expect(mismatches).toEqual([{ index: 1, from: '2', to: '5', knownConfusion: false }]);
  });

  it('different-length strings are reported as unaligned, never indexed', () => {
    expect(compareDigitStrings('123', '1234')).toEqual({ aligned: false, mismatches: [] });
    expect(compareDigitStrings(null, '123')).toEqual({ aligned: false, mismatches: [] });
  });
});

describe('generateLetterDigitAlternatives (O<->0, I/l<->1) - bounded, explicit, never silent', () => {
  it('substitutes O -> 0 only when the result is plausibly numeric', () => {
    expect(generateLetterDigitAlternatives('4700O30')).toEqual(['4700030']);
    expect(generateLetterDigitAlternatives('47OO.5O')).toContain('4700.50');
  });

  it('substitutes I and l -> 1', () => {
    expect(generateLetterDigitAlternatives('47000I0')).toEqual(['4700010']);
    expect(generateLetterDigitAlternatives('l00,50')).toEqual(['100,50']);
  });

  it('a text with no look-alike letters has no alternatives', () => {
    expect(generateLetterDigitAlternatives('4700030')).toEqual([]);
    expect(generateLetterDigitAlternatives('')).toEqual([]);
    expect(generateLetterDigitAlternatives(null)).toEqual([]);
  });

  it('does not propose an alternative when the result would still not be numeric (real text, not a look-alike)', () => {
    expect(generateLetterDigitAlternatives('Observation')).toEqual([]); // full of letters, not "almost numeric"
    expect(generateLetterDigitAlternatives('CODE-O1')).toEqual([]); // still has non-numeric letters after substitution
  });

  it('never touches a digit family (0/6/8/9 etc): only the specific letter look-alikes are substituted', () => {
    // "8" is never turned into "0"/"6"/"9" here - that is a DIFFERENT concern (digit confusion), not this function
    expect(generateLetterDigitAlternatives('4700830')).toEqual([]);
  });

  it('is bounded: proposes at most maxAlternatives readings even with many look-alike letters', () => {
    const alts = generateLetterDigitAlternatives('OIOIOIOIOI', { maxAlternatives: 3 });
    expect(alts.length).toBeLessThanOrEqual(3);
  });
});
