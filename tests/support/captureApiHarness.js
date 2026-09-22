/**
 * Shared helpers for the Capture API tests. The test files themselves declare the jest.mock() calls (they must be
 * hoisted per file); this module holds everything else: users, projects, tokens, the fixture OCR provider, images.
 */
const jwt = require('jsonwebtoken');
const request = require('supertest');
const { layoutTable, renderTableImage, stripPrivate } = require('./captureFixtures');

const OWNER = '507f1f77bcf86cd799439011';
const OTHER = '507f1f77bcf86cd799439022';
const PROJECT = '507f1f77bcf86cd799439aaa';
const OTHER_PROJECT = '507f1f77bcf86cd799439bbb';
const SHARED_PROJECT = '507f1f77bcf86cd799439ccc';

const token = (id = OWNER, role = 'teacher') => jwt.sign({ id, role }, process.env.JWT_SECRET, { expiresIn: '15m' });
const authed = (app, method, url, id = OWNER) => request(app)[method](url).set('Authorization', `Bearer ${token(id)}`);

/** Configure the mocked User / project / workspace models. `plan` per user id; projects by id. */
function configureAccess({ User, FieldBookProject, Workspace }, { crs = 'EPSG:7800', plans = { [OWNER]: 'pro', [OTHER]: 'pro' } } = {}) {
  User.findById.mockImplementation((id) => ({ select: async () => (plans[String(id)] ? { plan: plans[String(id)], subscriptionStatus: 'free' } : null) }));
  const projects = {
    [PROJECT]: { _id: PROJECT, user: OWNER, workspace: null, crs },
    [OTHER_PROJECT]: { _id: OTHER_PROJECT, user: OTHER, workspace: null, crs },
    [SHARED_PROJECT]: { _id: SHARED_PROJECT, user: OTHER, workspace: 'ws1', crs },
  };
  FieldBookProject.findById.mockImplementation(async (id) => projects[String(id)] || null);
  Workspace.findById.mockImplementation(async () => ({ _id: 'ws1', owner: OTHER, members: [{ user: OWNER, role: 'viewer' }] }));
}

/**
 * A deterministic OCR provider that "reads" exactly the words of a fixture layout. Crop-aware (V2.2): a request
 * carrying `dims.crop` (capture/rerecognition.js re-recognition passes) returns the TRUE words inside that crop
 * rectangle, in crop-local coordinates, ignoring `mutate` - a focused re-read of the real pixels, not the
 * injected whole-page misread. `mutateCrop` can override that for tests that want a misread crop too.
 */
function fixtureProvider(layout, { mutate, mutateCrop } = {}) {
  return {
    name: 'fixture',
    version: 'test',
    recognize: jest.fn(async (buffer, dims) => {
      let words = stripPrivate(layout.words);
      if (dims && dims.crop) {
        const { x, y, w, h } = dims.crop;
        words = words
          .filter((word) => {
            const cx = word.bbox.x + word.bbox.w / 2;
            const cy = word.bbox.y + word.bbox.h / 2;
            return cx >= x && cx <= x + w && cy >= y && cy <= y + h;
          })
          .map((word) => ({ ...word, bbox: { ...word.bbox, x: word.bbox.x - x, y: word.bbox.y - y } }));
        if (mutateCrop) words = mutateCrop(words, dims.crop);
      } else if (mutate) {
        words = mutate(words);
      }
      return { provider: { name: 'fixture', version: 'test' }, page: { index: 0, width: dims.width, height: dims.height, words } };
    }),
  };
}

async function makeCapture(headers, rows, opts = {}) {
  const layout = layoutTable({ headers, rows, ...opts });
  const image = await renderTableImage(layout);
  return { layout, image };
}

const upload = (app, image, { projectId = PROJECT, id = OWNER, filename = 'table.png' } = {}) =>
  request(app).post('/api/capture/jobs').set('Authorization', `Bearer ${token(id)}`).field('projectId', projectId).attach('image', image, filename);

module.exports = { OWNER, OTHER, PROJECT, OTHER_PROJECT, SHARED_PROJECT, token, authed, configureAccess, fixtureProvider, makeCapture, upload };
