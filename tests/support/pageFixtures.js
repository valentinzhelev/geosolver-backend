/**
 * Test support: a notebook PAGE as the real Capture pipeline leaves it (OCR words -> reconstruct -> evaluate), without an
 * OCR provider, storage or database. `pageJobFields` returns the fields of a CaptureJob in `needs_review`; the multi-page
 * Field Session tests (merge, API, e2e, races, GAI) all build their pages from it so they exercise the real
 * reconstruction/validation rules instead of hand-written notebooks.
 */
const { layoutNotebook, stripPrivate } = require('./notebookFixtures');
const { reconstructNotebook } = require('../../capture/notebook/reconstruct');
const { evaluateNotebook } = require('../../capture/notebook/validation');
const { getConfig } = require('../../capture/config');

const obs = (target, hz = '10.0000g', extra = {}) => ({ target, hz, vz: '100.0000g', distance: '25.000', prism: '1.500', ...extra });
const station = (name, observations, extra = {}) => ({ station: name, hi: '1.500', orientationTarget: '102', orientationDirection: '0.0000g', observations, ...extra });
const continuation = (observations, extra = {}) => ({ continuation: true, observations, ...extra });

/** The words of a page layout, reconstructed and evaluated exactly as capture/jobService.js#processJob does. */
function evaluatedNotebook(setups, tweak) {
  const layout = layoutNotebook({ setups });
  const { notebook } = reconstructNotebook({ index: 0, width: layout.width, height: layout.height, words: stripPrivate(layout.words) }, { provider: 'fixture' });
  if (!notebook) throw new Error('fixture page was not reconstructed');
  if (tweak) tweak(notebook);
  return evaluateNotebook(notebook, { arbitration: getConfig().arbitration });
}

/**
 * @param {object[]} setups  layoutNotebook setups (see tests/support/notebookFixtures.js)
 * @param {{user: string, project: string, status?: string, tweak?: Function, name?: string}} opts
 */
function pageJobFields(setups, { user, project, status = 'needs_review', tweak, name = 'page.jpg' } = {}) {
  const config = getConfig();
  const base = {
    user, project, mode: 'field-notebook', status,
    pipelineVersion: config.pipelineVersion, recognitionVersion: config.notebookReconstructionVersion,
    arbitrationVersion: config.arbitration.version, validationVersion: config.notebookValidationVersion, notebookVersion: config.notebookValidationVersion,
    source: { originalName: name, assets: { original: 'o', review: 'r', thumbnail: 't' }, review: { width: 800, height: 600 } },
  };
  if (status === 'failed') return { ...base, notebook: null, failure: { code: 'NO_NOTEBOOK_DETECTED', message: 'Не беше разпозната поле-книжка (станция/наблюдения).' } };
  if (status !== 'needs_review' && status !== 'confirmed') return { ...base, notebook: null };
  const ev = evaluatedNotebook(setups, tweak);
  return { ...base, notebook: ev.notebook, validationSummary: ev.summary };
}

const editStation = (setupIdx, field, value) => (nb) => { nb.setups[setupIdx].station[field].userValue = value; };
const editObs = (setupIdx, rowIdx, field, value) => (nb) => {
  const row = nb.setups[setupIdx].observations[rowIdx];
  row.cells[row.cols.findIndex((c) => c.field === field)].userValue = value;
};
const exclude = (setupIdx, rowIdx) => (nb) => { nb.setups[setupIdx].observations[rowIdx].excluded = true; };

module.exports = { obs, station, continuation, evaluatedNotebook, pageJobFields, editStation, editObs, exclude };
