/**
 * Storage abstraction for generated Report PDFs (V2.5) - mirrors capture/storage/index.js's interface exactly
 * (put/get), so the domain code only ever calls this:
 *
 *   put({ reportId, userId, buffer, mime }) -> Promise<string>   opaque asset id
 *   get(id)                                 -> Promise<{ buffer, mime } | null>
 *   deleteForReport(reportId)               -> Promise<void>
 *
 * A SEPARATE abstraction from Capture's (not a reuse of capture/storage.js) because a Report's asset has no
 * job/kind/width/height/expiresAt - a generated document is a permanent record, not a temporary OCR review image.
 * V2.5 keeps the bytes in MongoDB (models/ReportAsset); moving to object storage later means writing another
 * implementation of these methods. PDF bytes are never logged.
 */
const crypto = require('crypto');

function createMongoStorage(ReportAsset) {
  return {
    async put({ reportId, userId, buffer, mime }) {
      const doc = await ReportAsset.create({
        report: reportId,
        user: userId,
        mime,
        bytes: buffer.length,
        sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
        data: buffer,
      });
      return String(doc._id);
    },
    async get(id) {
      const doc = await ReportAsset.findById(id).select('+data');
      if (!doc || !doc.data) return null;
      return { buffer: Buffer.from(doc.data), mime: doc.mime };
    },
    async deleteForReport(reportId) {
      await ReportAsset.deleteMany({ report: reportId });
    },
  };
}

let current = null;
function getStorage() {
  if (!current) current = createMongoStorage(require('../models/ReportAsset'));
  return current;
}
/** Test seam / alternative backend: replace the storage implementation. */
function setStorage(storage) {
  current = storage;
}

module.exports = { getStorage, setStorage, createMongoStorage };
