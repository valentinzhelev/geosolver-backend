const mongoose = require('mongoose');

/**
 * A Field Session (Теренна сесия, V2): one real working session in the field, the user-facing front door of the
 * field-to-office workflow
 *
 *   Field Session -> [review] -> confirmed observations (FieldObservationSet) -> processing -> points -> report
 *
 * It deliberately REFERENCES the authoritative records instead of duplicating them:
 *   - session metadata (this document): title, date, operator, instrument, conditions, notes, angle unit;
 *   - source observations: EXACTLY ONE source - manual raw entries held here in `setups` (a draft), or one attached
 *     Field Notebook CaptureJob (`source.captureJobId`, the OCR/review pipeline is reused untouched);
 *   - confirmed evidence: the immutable FieldObservationSet (manual: created by this session's confirm and linked by
 *     `fieldObservationSetId`; capture-backed: read from the CaptureJob, never copied here);
 *   - derived results: FieldProcessingRun / SurveyPoint / Report reference the FieldObservationSet; a session reads
 *     them through that link, it stores nothing about them.
 *
 * Persisted `status` is only 'draft' | 'review' | 'confirmed' (manual sessions); the user-facing status
 * (incl. 'processed', and the capture-backed states) is derived in fieldSessions/status.js.
 *
 * Once confirmed, `setups` are frozen: the only change ever made to a confirmed session is none. A correction is a
 * NEW session (`revisionOf`) - evidence is never overwritten.
 */
const fieldSessionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true }, // creator
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'FieldBookProject', required: true, index: true },

    title: { type: String, default: '', trim: true },
    date: { type: String, default: '' }, // 'YYYY-MM-DD' (a calendar day, deliberately not a timezone-bound instant)
    operator: { type: String, default: '', trim: true },
    instrument: { type: String, default: '', trim: true },
    instrumentSerial: { type: String, default: '', trim: true },
    conditions: { type: String, default: '', trim: true },
    notes: { type: String, default: '' },
    // the session's declared unit for BARE angle numbers (a user decision; an explicit unit in the text always wins)
    angleUnit: { type: String, enum: ['gon', 'deg'], default: 'gon' },

    source: {
      kind: { type: String, enum: ['manual', 'capture', null], default: null },
      captureJobId: { type: mongoose.Schema.Types.ObjectId, ref: 'CaptureJob' },
    },

    status: { type: String, enum: ['draft', 'review', 'confirmed'], default: 'draft' },
    revision: { type: Number, default: 0 }, // optimistic concurrency for manual edits
    // manual source only: raw user entries, see fieldSessions/entry.js. Frozen once confirmed.
    setups: { type: mongoose.Schema.Types.Mixed, default: [] },

    fieldObservationSetId: { type: mongoose.Schema.Types.ObjectId, ref: 'FieldObservationSet' }, // manual, once confirmed
    confirmedAt: { type: Date },
    confirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    confirmClaimedAt: { type: Date, default: null }, // atomic claim: concurrent confirms create exactly one set

    revisionOf: { type: mongoose.Schema.Types.ObjectId, ref: 'FieldSession' },
  },
  { timestamps: true }
);

fieldSessionSchema.index({ projectId: 1, createdAt: -1 });
fieldSessionSchema.index({ revisionOf: 1 });
// a Field Notebook capture belongs to at most ONE session (partial: manual sessions have no captureJobId)
fieldSessionSchema.index(
  { 'source.captureJobId': 1 },
  { unique: true, partialFilterExpression: { 'source.captureJobId': { $type: 'objectId' } }, name: 'source_captureJobId_unique_partial' }
);

module.exports = mongoose.model('FieldSession', fieldSessionSchema);
