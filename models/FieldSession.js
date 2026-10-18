const mongoose = require('mongoose');

/**
 * A Field Session (Теренна сесия, V2): one real working session in the field, the user-facing front door of the
 * field-to-office workflow
 *
 *   Field Session -> [review] -> confirmed observations (FieldObservationSet) -> processing -> points -> report
 *
 * It deliberately REFERENCES the authoritative records instead of duplicating them:
 *   - session metadata (this document): title, date, operator, instrument, conditions, notes, angle unit;
 *   - source observations: EXACTLY ONE kind of source - manual raw entries held here in `setups` (a draft), or
 *     ORDERED Field Notebook pages: `sources`, one CaptureJob per page (the OCR/review pipeline is reused untouched,
 *     page by page). Manual and capture are never mixed in one session (two different evidence models: raw typed text
 *     read with the session's angle unit vs OCR candidate cells with arbitration - mixing them makes authority ambiguous);
 *   - confirmed evidence: the immutable FieldObservationSet (created by this session's confirm and linked by
 *     `fieldObservationSetId`; sessions confirmed through the legacy single-capture path read it from their CaptureJob);
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
      // LEGACY single-capture field. For capture-backed sessions it is only a MIRROR of page 1 (kept in step by every page
      // operation, see fieldSessions/pages.js) so older readers keep working; `sources` is the authority when present.
      captureJobId: { type: mongoose.Schema.Types.ObjectId, ref: 'CaptureJob' },
    },
    // Notebook pages, in page order. ABSENT (undefined, not []) on records written before multi-page sessions: such a
    // record is read as one page via fieldSessions/pages.js#pagesOf - no rewrite is required for it to keep working.
    // Every change is a compare-and-set of this whole array on the session document (revision + lock in the filter).
    sources: {
      type: [new mongoose.Schema({
        kind: { type: String, enum: ['capture'], default: 'capture' },
        captureJobId: { type: mongoose.Schema.Types.ObjectId, ref: 'CaptureJob', required: true },
        order: { type: Number, required: true }, // 0-based, dense (0..n-1), persisted - never inferred from array position
        addedAt: { type: Date, default: Date.now },
      }, { _id: false })],
      default: undefined,
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
// a Field Notebook capture belongs to at most ONE session (partial: manual sessions have no captureJobId). Legacy field;
// see sources_captureJobId_unique_partial below for the multi-page ownership constraint.
fieldSessionSchema.index(
  { 'source.captureJobId': 1 },
  { unique: true, partialFilterExpression: { 'source.captureJobId': { $type: 'objectId' } }, name: 'source_captureJobId_unique_partial' }
);

// Page ownership, enforced by MongoDB itself: a CaptureJob is a page of at most ONE session. A unique MULTIKEY index
// forbids the same job in two different sessions (E11000 -> CAPTURE_ALREADY_ATTACHED). It does NOT stop the same job
// appearing twice inside ONE session's array (uniqueness is across documents) - that is rejected by the compare-and-set
// page operations. Partial: manual sessions and legacy records (no `sources`) have no entries. Legacy records get
// their `sources` from scripts/migrate-field-session-pages.js; until then the legacy index above covers them.
fieldSessionSchema.index(
  { 'sources.captureJobId': 1 },
  { unique: true, partialFilterExpression: { 'sources.captureJobId': { $type: 'objectId' } }, name: 'sources_captureJobId_unique_partial' }
);

module.exports = mongoose.model('FieldSession', fieldSessionSchema);
