/**
 * Safe text intake for an uploaded instrument file (untrusted input). Pure: bytes in, normalized lines out - no file system path, no
 * shell, no markup interpretation. Refuses rather than guesses:
 *   - size and line limits (config.js);
 *   - BINARY content (NUL bytes or too many control characters) -> BINARY_FILE;
 *   - ENCODING: UTF-8 (with or without BOM) and plain ASCII are accepted. UTF-16 and anything that is not valid UTF-8 (a legacy
 *     8-bit code page) -> UNSUPPORTED_ENCODING, so text is never silently corrupted;
 *   - LINE ENDINGS: CRLF, LF and lone CR are all normalized to one line per record; trailing blanks are kept (they are part of a
 *     GSI word), surrounding empty lines are dropped.
 */
const crypto = require('crypto');
const { InstrumentImportError } = require('./errors');
const { getConfig } = require('./config');

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/** A display-only file name: no path, no control characters, bounded. Never used to read or write anything. */
function safeFileName(name) {
  const base = String(name || '').split(/[\\/]/).pop() || '';
  const clean = base.replace(/[\u0000-\u001f\u007f<>"`]/g, '').trim();
  return clean.slice(0, getConfig().limits.maxFileNameLength) || 'instrument.gsi';
}

/**
 * @param {Buffer} buffer
 * @returns {{ lines: {n: number, text: string}[], sha256: string, bytes: number }}  `n` = 1-based line number in the file
 */
function decodeText(buffer) {
  const { limits } = getConfig();
  if (!buffer || !buffer.length) throw new InstrumentImportError('EMPTY_FILE');
  if (buffer.length > limits.maxBytes) throw new InstrumentImportError('FILE_TOO_LARGE');

  // UTF-16 (either byte order) is a legitimate text encoding, but not one an instrument GSI export uses: refuse it clearly
  if (buffer.length >= 2 && ((buffer[0] === 0xff && buffer[1] === 0xfe) || (buffer[0] === 0xfe && buffer[1] === 0xff))) {
    throw new InstrumentImportError('UNSUPPORTED_ENCODING');
  }
  let body = buffer;
  if (body.length >= 3 && body[0] === 0xef && body[1] === 0xbb && body[2] === 0xbf) body = body.subarray(3); // UTF-8 BOM

  let control = 0;
  for (const b of body) {
    if (b === 0) throw new InstrumentImportError('BINARY_FILE');
    if (b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d && b !== 0x1a) control += 1; // 0x1a = DOS end-of-file mark
  }
  if (control > Math.max(2, body.length * 0.01)) throw new InstrumentImportError('BINARY_FILE');

  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(body);
  } catch {
    throw new InstrumentImportError('UNSUPPORTED_ENCODING');
  }
  text = text.replace(/\u001a/g, '');

  const raw = text.split(/\r\n|\n|\r/);
  if (raw.length > limits.maxLines) throw new InstrumentImportError('TOO_MANY_LINES');
  const lines = [];
  raw.forEach((t, i) => { if (t.trim() !== '') lines.push({ n: i + 1, text: t.length > limits.maxLineLength ? t.slice(0, limits.maxLineLength) : t, truncated: t.length > limits.maxLineLength }); });
  if (!lines.length) throw new InstrumentImportError('EMPTY_FILE');
  return { lines, sha256: sha256(buffer), bytes: buffer.length };
}

module.exports = { decodeText, safeFileName, sha256 };
