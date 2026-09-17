// Regression tests for the Milestone-0.5 follow-up: routes/submissions.js
// (legacy, schema-incompatible, previously had an unauthenticated upload
// endpoint and an unauthenticated file-serving endpoint) must no longer be
// reachable at all. The file, models/Submission.js, and any existing
// uploads/database documents are untouched — only the HTTP mount is gone.
process.env.JWT_SECRET = 'test-secret-for-jest';

const jwt = require('jsonwebtoken');
const request = require('supertest');
const app = require('../../app');

function tokenFor(role) {
  return jwt.sign({ id: 'test-user-id', role }, process.env.JWT_SECRET, { expiresIn: '15m' });
}

describe('Legacy /api/submissions is unmounted', () => {
  it('1. GET /api/submissions is not reachable (404, no route matches)', async () => {
    const res = await request(app)
      .get('/api/submissions')
      .set('Authorization', `Bearer ${tokenFor('teacher')}`);

    expect(res.status).toBe(404);
  });

  it('2. POST /api/submissions does not execute the legacy upload handler (no auth, multipart body)', async () => {
    // Deliberately unauthenticated, exactly as the old vulnerable request
    // would have been — the old handler had no `auth` middleware at all.
    const res = await request(app)
      .post('/api/submissions')
      .field('studentId', 'forged-student-id')
      .field('assignmentId', 'forged-assignment-id')
      .field('teacherId', 'forged-teacher-id')
      .attach('files', Buffer.from('not a real image'), 'evil.png');

    // A reachable legacy handler would have responded 400 ("No files
    // uploaded" is impossible here since we attached one) or 500/201 from
    // Submission.save(). 404 proves Express never found a route to run it.
    expect(res.status).toBe(404);
  });

  it('3. GET /api/submissions/file/:filename does not expose files', async () => {
    const res = await request(app).get('/api/submissions/file/anything.png');
    expect(res.status).toBe(404);
    // Must not be the legacy handler's own 404 ({ message: 'File not found' })
    // — that would mean the route is still mounted and just didn't find the
    // file. It must be Express's routing-level 404 instead.
    expect(res.body).not.toEqual({ message: 'File not found' });
  });

  it('does not load routes/submissions.js as a dependency of the app at all', () => {
    // If app.js ever re-adds the require, this becomes true and the
    // assumption behind the tests above (no route registered) no longer
    // holds — this guards against a silent partial revert.
    expect(require.cache[require.resolve('../submissions')]).toBeUndefined();
  });
});

describe('Current classroom submission path is unaffected', () => {
  it('4. POST /api/student/assignments/assignments/:id/submit is still mounted (reachable past routing, rejected by auth, not 404)', async () => {
    const res = await request(app)
      .post('/api/student/assignments/assignments/000000000000000000000000/submit')
      .send({ answers: {} });

    // No token supplied: a still-mounted route rejects with 401 (missing
    // token) — NOT 404, which would mean the route no longer exists.
    expect(res.status).toBe(401);
  });

  it('4b. the same endpoint is reachable by a student token past the role gate (runs real handler logic, not a 404 fallthrough)', async () => {
    // Body deliberately fails the handler's own input check (missing
    // variantIndex) so it returns 400 from application logic *before*
    // touching Mongoose — proving the route is registered and executing,
    // without needing a live database connection in this test.
    const res = await request(app)
      .post('/api/student/assignments/assignments/000000000000000000000000/submit')
      .set('Authorization', `Bearer ${tokenFor('student')}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.message).toBeTruthy();
  });
});
