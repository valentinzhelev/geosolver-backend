const { resolvePointByName } = require('../pointResolution');

function fakeModel(points) {
  return {
    find(filter) {
      return {
        select() { return this; },
        lean: async () => points.filter((p) => String(p.projectId) === String(filter.projectId)),
      };
    },
  };
}

const PROJECT = 'proj1';
const pt = (over) => ({ _id: 'id-' + Math.random().toString(36).slice(2), projectId: PROJECT, code: '', x: 0, y: 0, h: 0, ...over });

describe('resolvePointByName: RESOLVED / MISSING / AMBIGUOUS (V2.4.1 section 2)', () => {
  it('RESOLVED: exactly one project point with that name', async () => {
    const model = fakeModel([pt({ name: '101', x: 1000, y: 2000, h: 500 })]);
    const r = await resolvePointByName(model, PROJECT, '101');
    expect(r).toMatchObject({ status: 'RESOLVED', point: { name: '101', x: 1000, y: 2000, h: 500 } });
  });

  it('matching is case-insensitive and trims whitespace, but exact otherwise', async () => {
    const model = fakeModel([pt({ name: 'T1' })]);
    expect((await resolvePointByName(model, PROJECT, ' t1 ')).status).toBe('RESOLVED');
    expect((await resolvePointByName(model, PROJECT, 'T1x')).status).toBe('MISSING');
  });

  it('MISSING: no project point with that name', async () => {
    const model = fakeModel([pt({ name: '999' })]);
    expect(await resolvePointByName(model, PROJECT, '101')).toEqual({ status: 'MISSING' });
  });

  it('MISSING: a blank identifier never resolves', async () => {
    const model = fakeModel([pt({ name: '' })]);
    expect(await resolvePointByName(model, PROJECT, '   ')).toEqual({ status: 'MISSING' });
  });

  it('AMBIGUOUS: more than one project point shares the name - never guessed', async () => {
    const model = fakeModel([pt({ name: '101', code: 'A' }), pt({ name: '101', code: 'B' })]);
    const r = await resolvePointByName(model, PROJECT, '101');
    expect(r.status).toBe('AMBIGUOUS');
    expect(r.candidates).toHaveLength(2);
  });

  it('point CODE alone never resolves identity (a code is a classification, not an identifier)', async () => {
    const model = fakeModel([pt({ name: 'A1', code: '101' })]);
    expect(await resolvePointByName(model, PROJECT, '101')).toEqual({ status: 'MISSING' });
  });

  it('only points of the SAME project are considered', async () => {
    const model = fakeModel([pt({ name: '101', projectId: 'other-project' })]);
    expect(await resolvePointByName(model, PROJECT, '101')).toEqual({ status: 'MISSING' });
  });
});
