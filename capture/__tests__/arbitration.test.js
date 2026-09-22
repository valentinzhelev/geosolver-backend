const { arbitrateCell, normalizeCandidateValue, ARBITRATION_VERSION } = require('../arbitration');

/** A minimal candidate, defaults matching a clean primary reading. */
const candidate = (over = {}) => ({
  text: '100', normalizedValue: null, provider: 'test', providerVersion: '1', recognitionPass: 0,
  preprocessingVariant: 'primary', confidence: 0.97, bbox: null, symbolConfidence: { min: null, suspicious: [] },
  source: 'primary', ...over,
});
const cellOf = (...candidates) => ({ candidates });

describe('arbitrateCell: semantics and empty cells', () => {
  it('returns null for an untracked semantic (e.g. notes) or a cell with no candidates', () => {
    expect(arbitrateCell(cellOf(candidate()), { semantic: 'notes' })).toBeNull();
    expect(arbitrateCell(cellOf(), { semantic: 'x' })).toBeNull();
  });
});

describe('the single-reading fast path (no re-recognition ran)', () => {
  it('a clean, high-confidence single reading is ACCEPTED (preserves V2.1 behaviour)', () => {
    const result = arbitrateCell(cellOf(candidate({ text: '4700000.25', confidence: 0.97 })), { semantic: 'x' });
    expect(result).toMatchObject({ outcome: 'ACCEPTED', version: ARBITRATION_VERSION });
  });

  it('a very low confidence single reading is UNCERTAIN (blocks until reviewed)', () => {
    const result = arbitrateCell(cellOf(candidate({ confidence: 0.3 })), { semantic: 'x' });
    expect(result.outcome).toBe('UNCERTAIN');
  });

  it('a moderate confidence single reading is REVIEW_SUGGESTED (warns, does not block)', () => {
    const result = arbitrateCell(cellOf(candidate({ confidence: 0.65 })), { semantic: 'x' });
    expect(result.outcome).toBe('REVIEW_SUGGESTED');
  });

  it('a null confidence (provider gave none) is UNCERTAIN, never silently accepted', () => {
    const result = arbitrateCell(cellOf(candidate({ confidence: null })), { semantic: 'x' });
    expect(result.outcome).toBe('UNCERTAIN');
  });

  it('a suspicious low-confidence symbol downgrades an otherwise high-confidence single reading', () => {
    const result = arbitrateCell(cellOf(candidate({ confidence: 0.97, symbolConfidence: { min: 0.2, suspicious: [{ word: 0, index: 3, text: '0', confidence: 0.2 }] } })), { semantic: 'x' });
    expect(result.outcome).not.toBe('ACCEPTED');
  });
});

describe('consensus beats confidence (the core false-accept-prevention rule)', () => {
  it('ADVERSARIAL: a WRONG reading with HIGHER confidence is never accepted just because of that confidence', () => {
    // primary (wrong) at 0.97, a single re-recognition pass (correct) at only 0.55 - no consensus either way
    const cell = cellOf(
      candidate({ text: '4700080.25', confidence: 0.97, source: 'primary', recognitionPass: 0 }),
      candidate({ text: '4700030.25', confidence: 0.55, source: 're-recognition', recognitionPass: 1, preprocessingVariant: 'enhanced' })
    );
    const result = arbitrateCell(cell, { semantic: 'x' });
    expect(result.outcome).not.toBe('ACCEPTED');
    expect(['REVIEW_SUGGESTED', 'UNCERTAIN']).toContain(result.outcome);
  });

  it('ADVERSARIAL: two independent passes agreeing on the CORRECT value outrank one high-confidence wrong primary', () => {
    const cell = cellOf(
      candidate({ text: '4700080.25', confidence: 0.98, source: 'primary', recognitionPass: 0 }),
      candidate({ text: '4700030.25', confidence: 0.6, source: 're-recognition', recognitionPass: 1, preprocessingVariant: 'enhanced' }),
      candidate({ text: '4700030.25', confidence: 0.62, source: 're-recognition', recognitionPass: 2, preprocessingVariant: 'threshold' })
    );
    const result = arbitrateCell(cell, { semantic: 'x' });
    // the primary is CONTRADICTED by a 2-pass consensus: never silently trusted, regardless of its own confidence
    expect(result.outcome).toBe('REVIEW_SUGGESTED');
    expect(result.reason).toBe('CONTRADICTED_BY_CONSENSUS');
    expect(result.alternatives.some((a) => a.normalizedValue === 4700030.25 && a.passCount === 2)).toBe(true);
  });

  it('two independent passes confirming the PRIMARY reading is enough to ACCEPT it', () => {
    const cell = cellOf(
      candidate({ text: '100.5', confidence: 0.8, source: 'primary', recognitionPass: 0 }),
      candidate({ text: '100.5', confidence: 0.7, source: 're-recognition', recognitionPass: 1 }),
      candidate({ text: '100.5', confidence: 0.75, source: 're-recognition', recognitionPass: 2 })
    );
    const result = arbitrateCell(cell, { semantic: 'x' });
    expect(result).toMatchObject({ outcome: 'ACCEPTED', reason: 'CONSENSUS_CONFIRMS_PRIMARY' });
  });

  it('agreement between passes with a suspicious symbol still gets a REVIEW flag, not a silent accept', () => {
    const suspicious = { min: 0.3, suspicious: [{ word: 0, index: 0, text: '4', confidence: 0.3 }] };
    const cell = cellOf(
      candidate({ text: '100.5', confidence: 0.8, source: 'primary', recognitionPass: 0, symbolConfidence: suspicious }),
      candidate({ text: '100.5', confidence: 0.7, source: 're-recognition', recognitionPass: 1, symbolConfidence: suspicious })
    );
    const result = arbitrateCell(cell, { semantic: 'x' });
    expect(result.outcome).toBe('REVIEW_SUGGESTED');
  });

  it('multiple passes that disagree, with neither side reaching consensus, is REVIEW_SUGGESTED with alternatives listed', () => {
    const cell = cellOf(
      candidate({ text: '100.1', confidence: 0.6, source: 'primary', recognitionPass: 0 }),
      candidate({ text: '100.7', confidence: 0.6, source: 're-recognition', recognitionPass: 1 })
    );
    const result = arbitrateCell(cell, { semantic: 'x' });
    expect(result.outcome).toBe('REVIEW_SUGGESTED');
    expect(result.alternatives).toHaveLength(1);
  });
});

describe('the letter/digit look-alike path (O<->0, I/l<->1): a generated alternative never reaches ACCEPTED', () => {
  it('an unparseable primary with a plausible letter-digit alternative becomes REVIEW_SUGGESTED, with the alternative listed', () => {
    const cell = cellOf(candidate({ text: '4700O30', confidence: 0.9 }));
    const result = arbitrateCell(cell, { semantic: 'x' });
    expect(result.outcome).toBe('REVIEW_SUGGESTED');
    expect(result.reason).toBe('GENERATED_ALTERNATIVE_FROM_LOOKALIKE');
    expect(result.alternatives[0]).toMatchObject({ text: '4700030', normalizedValue: 4700030, source: 'generated-alternative' });
  });

  it('an unparseable primary with NO plausible letter-digit alternative is INVALID', () => {
    const cell = cellOf(candidate({ text: 'not a number', confidence: 0.9 }));
    const result = arbitrateCell(cell, { semantic: 'x' });
    expect(result.outcome).toBe('INVALID');
  });

  it('a generated alternative alone, even if many re-recognition passes exist, cannot become ACCEPTED', () => {
    const cell = cellOf(
      candidate({ text: '47OO030', confidence: 0.9, source: 'primary', recognitionPass: 0 }),
      candidate({ text: '47OO030', confidence: 0.9, source: 're-recognition', recognitionPass: 1 }),
      candidate({ text: '47OO030', confidence: 0.9, source: 're-recognition', recognitionPass: 2 })
    );
    const result = arbitrateCell(cell, { semantic: 'x' });
    expect(result.outcome).not.toBe('ACCEPTED');
  });
});

describe('point / code (identifier) cells use exact text, not numeric parsing', () => {
  it('two passes agreeing on the identifier text ACCEPT it', () => {
    const cell = cellOf(
      candidate({ text: 'P1', confidence: 0.7, source: 'primary', recognitionPass: 0 }),
      candidate({ text: 'P1', confidence: 0.7, source: 're-recognition', recognitionPass: 1 })
    );
    expect(arbitrateCell(cell, { semantic: 'point' }).outcome).toBe('ACCEPTED');
  });

  it('is case/whitespace-insensitive for grouping but never invents letters', () => {
    expect(normalizeCandidateValue({ text: ' p1 ' }, 'point', null)).toMatchObject({ key: 'p1', status: 'ok' });
    expect(normalizeCandidateValue({ text: '' }, 'code', null)).toMatchObject({ status: 'empty' });
  });
});

describe('numeric style is respected (column/document decimal convention)', () => {
  it('parses candidates using the given numeric style, so a comma-decimal column groups correctly', () => {
    const cell = cellOf(
      candidate({ text: '100,50', confidence: 0.9, source: 'primary', recognitionPass: 0 }),
      candidate({ text: '100,50', confidence: 0.6, source: 're-recognition', recognitionPass: 1 })
    );
    const result = arbitrateCell(cell, { semantic: 'x', numericStyle: { decimalSep: ',' } });
    expect(result.outcome).toBe('ACCEPTED');
  });
});
