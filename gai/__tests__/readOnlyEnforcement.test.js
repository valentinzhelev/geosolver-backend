/**
 * V1 section 17: "no write tools at all... must be enforceable STRUCTURALLY, not just by prompt wording." This test
 * asserts that structural fact directly against the tool registry the LLM is actually given, rather than trusting
 * the system prompt alone - a future addition to gai/tools/* that names something like createX/updateX/deleteX/
 * confirmX/runX/generateX would fail this test immediately.
 */
const tools = require('../tools');

const WRITE_VERB_PATTERN = /^(create|update|delete|remove|confirm|approve|reject|run|generate|save|write|patch|modify|set|put)/i;

describe('gai/tools registry is structurally read-only', () => {
  it('exports only functions, and none of them is named like a write/mutation action', () => {
    const names = Object.keys(tools);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(typeof tools[name]).toBe('function');
      expect(name).not.toMatch(WRITE_VERB_PATTERN);
    }
  });

  it('gai/service.js never imports anything from mongoose models directly - all data access goes through the read-only tool layer', () => {
    // eslint-disable-next-line global-require
    const serviceSrc = require('fs').readFileSync(require.resolve('../service.js'), 'utf8');
    expect(serviceSrc).not.toMatch(/require\(['"]\.\.\/models\//);
  });
});
