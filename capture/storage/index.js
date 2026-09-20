/**
 * Storage abstraction for Capture images. The domain code only calls this interface:
 *
 *   put({ jobId, userId, kind, buffer, mime, width, height, expiresAt }) -> Promise<string>   opaque asset id
 *   get(id)                                                              -> Promise<{ buffer, mime } | null>
 *   deleteForJob(jobId)                                                  -> Promise<void>
 *
 * V2.1 keeps the bytes in MongoDB (models/CaptureAsset, TTL-expired). Moving to GridFS or object storage means
 * writing another implementation of these three methods. Image bytes are never logged.
 */
const crypto = require('crypto');

function createMongoStorage(CaptureAsset) {
  return {
    async put({ jobId, userId, kind, buffer, mime, width, height, expiresAt }) {
      const doc = await CaptureAsset.create({
        job: jobId,
        user: userId,
        kind,
        mime,
        bytes: buffer.length,
        sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
        width,
        height,
        data: buffer,
        expiresAt,
      });
      return String(doc._id);
    },
    async get(id) {
      const doc = await CaptureAsset.findById(id).select('+data');
      if (!doc || !doc.data) return null;
      return { buffer: Buffer.from(doc.data), mime: doc.mime };
    },
    async deleteForJob(jobId) {
      await CaptureAsset.deleteMany({ job: jobId });
    },
  };
}

let current = null;
function getStorage() {
  if (!current) current = createMongoStorage(require('../../models/CaptureAsset'));
  return current;
}
/** Test seam / alternative backend: replace the storage implementation. */
function setStorage(storage) {
  current = storage;
}

module.exports = { getStorage, setStorage, createMongoStorage };
