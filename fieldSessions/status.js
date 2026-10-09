/**
 * Field Session lifecycle (pure): Чернова -> За проверка -> Потвърдена -> Обработена.
 *
 * Only 'draft' | 'review' | 'confirmed' are ever PERSISTED (manual sessions). The user-facing status is DERIVED
 * deterministically from authoritative records, so it can never go stale:
 *   - capture-backed session: the attached CaptureJob decides (needs_review -> review, confirmed -> confirmed,
 *     anything else -> draft) - the session never duplicates the job's state;
 *   - 'processed' = confirmed AND at least one FieldProcessingRun exists for its FieldObservationSet.
 */
const STATUS_LABELS = {
  draft: 'Чернова',
  review: 'За проверка',
  confirmed: 'Потвърдена',
  processed: 'Обработена',
};

/**
 * @param {{session: object, job?: object|null, runCount?: number}} args
 * @returns {{status: 'draft'|'review'|'confirmed'|'processed', label: string, confirmed: boolean}}
 */
function deriveStatus({ session, job = null, runCount = 0 }) {
  let base;
  if (session.source && session.source.kind === 'capture') {
    if (job && job.status === 'confirmed') base = 'confirmed';
    else if (job && job.status === 'needs_review') base = 'review';
    else base = 'draft';
  } else {
    base = session.status === 'confirmed' || session.status === 'review' ? session.status : 'draft';
  }
  const status = base === 'confirmed' && runCount > 0 ? 'processed' : base;
  return { status, label: STATUS_LABELS[status], confirmed: base === 'confirmed' };
}

module.exports = { deriveStatus, STATUS_LABELS };
