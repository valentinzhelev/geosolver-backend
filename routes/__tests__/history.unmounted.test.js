// Release-security fix: routes/history.js (models/History.js - bare x1/y1/alpha/s/result scratch documents, no
// user/project field at all) was mounted at /api/history with a completely unauthenticated POST (persists
// arbitrary req.body) and GET (returns the last 20 documents to anyone). It is unrelated legacy code, not the
// current Calculation History system (routes/calculations.js + models/Calculation.js), and its one frontend
// caller (src/components/shared/historyService.js) is itself imported nowhere in the frontend. Unmounted rather
// than "fixed" in place, matching the existing routes/submissions.js precedent - see app.js for the restore note.
process.env.JWT_SECRET = 'test-secret-for-jest';

const jwt = require('jsonwebtoken');
const request = require('supertest');
const app = require('../../app');

function tokenFor(id = 'test-user-id', role = 'student') {
  return jwt.sign({ id, role }, process.env.JWT_SECRET, { expiresIn: '15m' });
}

describe('Legacy /api/history is unmounted - anonymous and cross-user access are both impossible', () => {
  it('1. GET /api/history, unauthenticated, is not reachable (404, no route matches)', async () => {
    const res = await request(app).get('/api/history');
    expect(res.status).toBe(404);
  });

  it('2. POST /api/history, unauthenticated, does not execute the legacy write handler', async () => {
    // Deliberately unauthenticated, exactly as the old vulnerable request would have been.
    const res = await request(app).post('/api/history').send({ x1: 1, y1: 2, alpha: 3, s: 4 });
    expect(res.status).toBe(404);
  });

  it('3. GET /api/history with a valid token from ANY user is still not reachable - no route exists to bypass', async () => {
    const res = await request(app).get('/api/history').set('Authorization', `Bearer ${tokenFor('some-other-user')}`);
    expect(res.status).toBe(404);
  });

  it('4. POST /api/history with a valid token from ANY user is still not reachable - no route exists to bypass', async () => {
    const res = await request(app)
      .post('/api/history')
      .set('Authorization', `Bearer ${tokenFor('some-other-user')}`)
      .send({ x1: 1, y1: 2, alpha: 3, s: 4 });
    expect(res.status).toBe(404);
  });

  it('5. the Calculation History system (a completely different route/model) is unaffected', async () => {
    // Smoke check only - routes/__tests__/calculations.*.test.js already covers this route's own behavior in
    // depth. This just proves unmounting /api/history did not accidentally disturb sibling route registration:
    // GET /api/calculations still resolves to its own `auth` middleware (401, not 404 - the router is intact),
    // without needing a live Mongo connection.
    const res = await request(app).get('/api/calculations');
    expect(res.status).toBe(401);
  });
});
