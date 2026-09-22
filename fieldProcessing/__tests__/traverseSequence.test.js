const { buildTraverseSequence } = require('../traverseSequence');

let nextRow = 0;
const obs = (target, over = {}) => ({ row: nextRow++, target, hz: { value: 0, unit: 'gon' }, vz: null, distance: null, horizontalDistance: { value: 50, unit: 'm' }, prismHeight: null, excluded: false, cells: [], ...over });
const setup = (index, stationPoint, backsightTarget, observations) => ({
  index,
  station: { point: stationPoint, instrumentHeight: { value: 1.5, unit: 'm' } },
  orientation: backsightTarget ? { target: backsightTarget, direction: null } : null,
  observations,
});

beforeEach(() => { nextRow = 0; });

describe('S. multi-station chain resolves in order (station -> backsight -> foresight identities)', () => {
  it('101 -> 102 -> 103 -> 104 (104 has no own setup, is the known endpoint)', () => {
    const setups = [
      setup(0, '101', '100', [obs('102')]),
      setup(1, '102', '101', [obs('103')]),
      setup(2, '103', '102', [obs('104')]),
    ];
    const r = buildTraverseSequence(setups, { traverseType: 'KNOWN_ENDPOINT', startIdentifier: '101', endIdentifier: '104' });
    expect(r.state).toBe('RESOLVED');
    expect(r.legs).toHaveLength(3);
    expect(r.legs.map((l) => l.toIdentifier)).toEqual(['102', '103', '104']);
    expect(r.legs[2].toSetupIndex).toBeNull(); // 104 is un-occupied, terminal only
    expect(r.reachedKnownEndpoint).toBe(true);
  });
});

describe('R. closed loop with start = end', () => {
  it('a 4-station square returns to the start station and closes', () => {
    const setups = [
      setup(0, '101', '104', [obs('102')]),
      setup(1, '102', '101', [obs('103')]),
      setup(2, '103', '102', [obs('104')]),
      setup(3, '104', '103', [obs('101')]),
    ];
    const r = buildTraverseSequence(setups, { traverseType: 'CLOSED_LOOP', startIdentifier: '101' });
    expect(r.state).toBe('RESOLVED');
    expect(r.legs).toHaveLength(4);
    expect(r.legs[3].toIdentifier).toBe('101');
    expect(r.reachedKnownEndpoint).toBe(true);
  });
});

describe('OPEN traverse', () => {
  it('has no declared endpoint and simply ends when the chain runs out', () => {
    const setups = [setup(0, '101', '100', [obs('102')]), setup(1, '102', '101', [obs('103')]), setup(2, '103', '102', [])];
    const r = buildTraverseSequence(setups, { traverseType: 'OPEN', startIdentifier: '101' });
    expect(r.state).toBe('RESOLVED');
    expect(r.legs).toHaveLength(2);
    expect(r.reachedKnownEndpoint).toBe(false);
  });
});

describe('O. ambiguous sequence', () => {
  it('two distinct, mutually-consistent continuations from the same setup cannot be auto-resolved', () => {
    const setups = [
      setup(0, '101', '100', [obs('102'), obs('102b')]),
      setup(1, '102', '101', [obs('103')]),
      setup(2, '102b', '101', [obs('103b')]),
    ];
    const r = buildTraverseSequence(setups, { traverseType: 'OPEN', startIdentifier: '101' });
    expect(r.state).toBe('AMBIGUOUS');
    expect(r.issue.code).toBe('AMBIGUOUS_CONTINUATION');
    expect(r.issue.candidateIdentifiers.sort()).toEqual(['102', '102b']);
  });
});

describe('P. disconnected: the requested start does not exist in this observation set', () => {
  it('reports DISCONNECTED rather than guessing a start', () => {
    const setups = [setup(0, '101', '100', [obs('102')])];
    const r = buildTraverseSequence(setups, { traverseType: 'OPEN', startIdentifier: '999' });
    expect(r.state).toBe('DISCONNECTED');
    expect(r.issue.code).toBe('START_STATION_NOT_FOUND');
  });
});

describe('N. broken middle leg', () => {
  it('setup 102 expects a backsight from 101, but 101 never recorded a foresight to 102', () => {
    const setups = [
      setup(0, '101', '100', [obs('999')]), // some unrelated side shot, not a link to 102
      setup(1, '102', '101', [obs('103')]),
    ];
    const r = buildTraverseSequence(setups, { traverseType: 'OPEN', startIdentifier: '101' });
    expect(r.state).toBe('INCOMPLETE');
    expect(r.issue.code).toBe('MISSING_FORESIGHT_OBSERVATION');
    expect(r.issue.expectedNextIdentifier).toBe('102');
  });
});

describe('a known-endpoint traverse that never reaches its endpoint', () => {
  it('is INCOMPLETE, not silently truncated as if it were valid', () => {
    const setups = [setup(0, '101', '100', [obs('102')]), setup(1, '102', '101', [])];
    const r = buildTraverseSequence(setups, { traverseType: 'KNOWN_ENDPOINT', startIdentifier: '101', endIdentifier: '999' });
    expect(r.state).toBe('INCOMPLETE');
    expect(r.issue.code).toBe('ENDPOINT_NOT_REACHED');
  });

  it('KNOWN_ENDPOINT with no endIdentifier at all is INCOMPLETE before any walking happens', () => {
    const setups = [setup(0, '101', '100', [obs('102')])];
    const r = buildTraverseSequence(setups, { traverseType: 'KNOWN_ENDPOINT', startIdentifier: '101' });
    expect(r.state).toBe('INCOMPLETE');
    expect(r.issue.code).toBe('END_STATION_NOT_SPECIFIED');
  });
});

describe('data-quality guard: duplicate station identifiers', () => {
  it('two setups claiming the same station name block sequencing entirely', () => {
    const setups = [setup(0, '101', '100', [obs('102')]), setup(1, '101', '100', [obs('102')])];
    const r = buildTraverseSequence(setups, { traverseType: 'OPEN', startIdentifier: '101' });
    expect(r.state).toBe('AMBIGUOUS');
    expect(r.issue.code).toBe('DUPLICATE_STATION_IDENTIFIER_IN_OBSERVATION_SET');
  });
});

describe('observation selection', () => {
  it('an excluded observation is never treated as a traverse candidate', () => {
    const setups = [
      setup(0, '101', '100', [obs('102', { excluded: true })]),
      setup(1, '102', '101', [obs('103')]),
    ];
    const r = buildTraverseSequence(setups, { traverseType: 'OPEN', startIdentifier: '101' });
    expect(r.legs).toHaveLength(0);
    expect(r.state).toBe('INCOMPLETE');
  });

  it('a side/detail observation to an unrelated target is never mistaken for a traverse leg', () => {
    const setups = [
      setup(0, '101', '100', [obs('side-detail-1'), obs('102')]),
      setup(1, '102', '101', [obs('103')]),
      setup(2, '103', '102', [obs('side-detail-2')]),
    ];
    const r = buildTraverseSequence(setups, { traverseType: 'OPEN', startIdentifier: '101' });
    expect(r.state).toBe('RESOLVED');
    expect(r.legs.map((l) => l.toIdentifier)).toEqual(['102', '103']); // the side shots never appear as legs
  });

  it('backsight is never re-selected as its own foresight even if it also appears as an observation row', () => {
    const setups = [
      setup(0, '101', '100', [obs('100'), obs('102')]), // re-sighted the backsight as a check reading
      setup(1, '102', '101', [obs('103')]),
    ];
    const r = buildTraverseSequence(setups, { traverseType: 'OPEN', startIdentifier: '101' });
    expect(r.legs[0].toIdentifier).toBe('102');
  });
});
