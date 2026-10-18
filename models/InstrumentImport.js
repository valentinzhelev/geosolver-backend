const mongoose = require('mongoose');

/**
 * An uploaded instrument file (V1: Leica GSI-8 / GSI-16) - the AUDIT record and the immutable raw snapshot of one import into a
 * Field Session. Created by fieldSessions/instrumentOps.js on upload, never edited afterwards except for its lifecycle fields.
 *
 *   - `lines` is the file's text, already decoded and split (line number + exact text): the source the review and the confirm
 *     re-read deterministically with the recorded parser / normalizer / validation versions. The original bytes are not kept
 *     (`sha256` + `bytes` identify them); nothing in here is ever executed, rendered as markup or used as a path.
 *   - `upload` is what the file looked like at upload (summary + the first issues), for the audit trail.
 *   - the user's review DECISIONS (orientation per setup, excluded records, an explicit station) live on the FieldSession, under
 *     its compare-and-set revision - never here.
 *   - `lineage`: the first import of this file content in a revision chain (a revision copies the import; the copy is not a
 *     "duplicate upload" of its own original).
 * Status: 'draft' (attached to an unconfirmed session) | 'confirmed' (its session was confirmed; `fieldObservationSetId` set) |
 * 'detached' (removed from its session before confirmation; kept for the audit trail).
 */
const instrumentImportSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'FieldBookProject', required: true },
    fieldSessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'FieldSession', required: true },
    vendor: { type: String, enum: ['leica'], required: true },
    format: { type: String, enum: ['GSI-8', 'GSI-16'], required: true },
    originalName: { type: String, default: '' }, // display only (sanitized: no path, no control characters)
    sha256: { type: String, required: true },
    bytes: { type: Number, required: true },
    lines: { type: mongoose.Schema.Types.Mixed, required: true }, // [{ n, text, truncated }]
    parserVersion: { type: String, required: true },
    normalizerVersion: { type: String, required: true },
    validationVersion: { type: String, required: true },
    upload: { type: mongoose.Schema.Types.Mixed }, // { summary, issues (first 200) }
    status: { type: String, enum: ['draft', 'confirmed', 'detached'], default: 'draft' },
    lineage: { type: mongoose.Schema.Types.ObjectId },
    derivedFrom: { type: mongoose.Schema.Types.ObjectId, ref: 'InstrumentImport' },
    confirmedAt: { type: Date },
    confirmed: { type: mongoose.Schema.Types.Mixed }, // { summary, decisions } exactly as confirmed
    fieldObservationSetId: { type: mongoose.Schema.Types.ObjectId, ref: 'FieldObservationSet' },
    detachedAt: { type: Date },
  },
  { timestamps: true }
);

instrumentImportSchema.index({ projectId: 1, sha256: 1 }); // duplicate-upload warning
instrumentImportSchema.index({ fieldSessionId: 1 });

module.exports = mongoose.model('InstrumentImport', instrumentImportSchema);
