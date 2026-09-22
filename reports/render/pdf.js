/**
 * Deterministic server-side PDF generation (V2.5 section 8): pdfmake over pdfkit, no headless browser, no
 * screenshot of any page - a docDefinition object in, a PDF Buffer out, nothing else involved.
 */
const pdfMake = require('pdfmake');
const { FONTS } = require('./fonts');

let configured = false;
function ensureConfigured() {
  if (configured) return;
  pdfMake.setFonts(FONTS);
  // Only our own bundled font files under node_modules are ever passed as local paths - never user input.
  pdfMake.setLocalAccessPolicy(() => true);
  // Reports never reference a remote resource (no images, no external assets).
  pdfMake.setUrlAccessPolicy(() => false);
  configured = true;
}

/** @param {object} docDefinition a pdfmake document definition @returns {Promise<Buffer>} */
async function generatePdfBuffer(docDefinition) {
  ensureConfigured();
  return pdfMake.createPdf(docDefinition).getBuffer();
}

module.exports = { generatePdfBuffer };
