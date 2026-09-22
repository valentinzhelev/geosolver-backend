/**
 * Cyrillic-capable font registration for pdfmake (V2.5 section 7/8). WOFF (not WOFF2) files are used deliberately
 * - fontkit (pdfkit's font-parsing dependency, which pdfmake uses internally) fails to embed this family's WOFF2
 * variant ("Offset is outside the bounds of the DataView") but embeds the WOFF variant of the SAME font cleanly;
 * verified end-to-end by extracting text back out of a generated PDF (reports/render/__tests__).
 */
const path = require('path');

const FONT_DIR = path.join(__dirname, '..', '..', 'node_modules', '@openfonts', 'noto-sans_cyrillic', 'files');
const f = (name) => path.join(FONT_DIR, name);

const FONTS = {
  NotoSans: {
    normal: f('noto-sans-cyrillic-400.woff'),
    bold: f('noto-sans-cyrillic-700.woff'),
    italics: f('noto-sans-cyrillic-400-italic.woff'),
    bolditalics: f('noto-sans-cyrillic-700-italic.woff'),
  },
};

module.exports = { FONTS };
