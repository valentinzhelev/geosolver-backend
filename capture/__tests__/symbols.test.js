const { analyzeCellSymbols, hasSuspiciousSymbol, DEFAULT_SYMBOL_CONFIDENCE_THRESHOLD } = require('../symbols');

const word = (text, confidence, symbols) => ({ text, confidence, symbols });

describe('analyzeCellSymbols: a bad character must not hide behind a good word-level score', () => {
  it('finds the lowest symbol confidence across every word of a cell', () => {
    const words = [
      word('4700030.50', 0.9, [
        { text: '4', confidence: 0.99 }, { text: '7', confidence: 0.98 }, { text: '0', confidence: 0.97 },
        { text: '0', confidence: 0.3 }, { text: '0', confidence: 0.95 }, { text: '3', confidence: 0.96 },
        { text: '0', confidence: 0.94 }, { text: '.', confidence: 0.99 }, { text: '5', confidence: 0.9 }, { text: '0', confidence: 0.92 },
      ]),
    ];
    const { min, suspicious } = analyzeCellSymbols(words);
    expect(min).toBe(0.3);
    expect(suspicious).toEqual([{ word: 0, index: 3, text: '0', confidence: 0.3 }]);
  });

  it('the DEFAULT threshold matches the exported constant', () => {
    const words = [word('12', 0.9, [{ text: '1', confidence: DEFAULT_SYMBOL_CONFIDENCE_THRESHOLD - 0.01 }, { text: '2', confidence: 0.99 }])];
    expect(analyzeCellSymbols(words).suspicious).toHaveLength(1);
    const clean = [word('12', 0.9, [{ text: '1', confidence: DEFAULT_SYMBOL_CONFIDENCE_THRESHOLD }, { text: '2', confidence: 0.99 }])];
    expect(analyzeCellSymbols(clean).suspicious).toHaveLength(0); // exactly at the threshold is not "below" it
  });

  it('spans multiple words in one cell', () => {
    const words = [word('4', 0.99, [{ text: '4', confidence: 0.99 }]), word('7OO', 0.6, [{ text: '7', confidence: 0.9 }, { text: 'O', confidence: 0.2 }, { text: 'O', confidence: 0.25 }])];
    const { min, suspicious } = analyzeCellSymbols(words);
    expect(min).toBe(0.2);
    expect(suspicious.map((s) => s.word)).toEqual([1, 1]);
  });

  it('is safe with no symbol data at all (older/legacy word shape), returning "nothing suspicious", not a crash', () => {
    expect(analyzeCellSymbols([{ text: 'x', confidence: 0.5 }])).toEqual({ min: null, suspicious: [] });
    expect(analyzeCellSymbols([])).toEqual({ min: null, suspicious: [] });
    expect(analyzeCellSymbols(null)).toEqual({ min: null, suspicious: [] });
    expect(analyzeCellSymbols(undefined)).toEqual({ min: null, suspicious: [] });
  });

  it('ignores a symbol confidence that is not a number, rather than treating it as 0', () => {
    const words = [word('ab', 0.9, [{ text: 'a', confidence: null }, { text: 'b', confidence: 0.9 }])];
    expect(analyzeCellSymbols(words)).toEqual({ min: 0.9, suspicious: [] });
  });
});

describe('hasSuspiciousSymbol', () => {
  it('true only when there is at least one suspicious symbol', () => {
    expect(hasSuspiciousSymbol({ min: 0.2, suspicious: [{ word: 0, index: 0, text: 'x', confidence: 0.2 }] })).toBe(true);
    expect(hasSuspiciousSymbol({ min: 0.9, suspicious: [] })).toBe(false);
    expect(hasSuspiciousSymbol(null)).toBe(false);
    expect(hasSuspiciousSymbol(undefined)).toBe(false);
  });
});
