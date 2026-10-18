/**
 * Field Session lifecycle (pure): Чернова -> За проверка -> Потвърдена -> Обработена.
 *
 * Only 'draft' | 'review' | 'confirmed' are ever PERSISTED (manual sessions). The user-facing status is DERIVED
 * deterministically from authoritative records, so it can never go stale:
 *   - capture-backed session: a session confirmed through its own confirm (several pages merged, or one) is 'confirmed' by
 *     its persisted status. Otherwise its page jobs decide: a SINGLE page that was confirmed through the original capture
 *     flow is confirmed; every page ready for review (needs_review) -> review; anything else (no page yet, a page still
 *     processing or failed) -> draft. The session never duplicates the jobs' state;
 *   - 'processed' = confirmed AND at least one FieldProcessingRun exists for its FieldObservationSet.
 */
const STATUS_LABELS = {
  draft: 'Чернова',
  review: 'За проверка',
  confirmed: 'Потвърдена',
  processed: 'Обработена',
};

/**
 * @param {{session: object, job?: object|null, jobs?: object[], runCount?: number}} args  `job` (one) is the legacy form of `jobs`
 * @returns {{status: 'draft'|'review'|'confirmed'|'processed', label: string, confirmed: boolean}}
 */
function deriveStatus({ session, job = null, jobs = null, runCount = 0 }) {
  let base;
  if (session.source && session.source.kind === 'capture') {
    const list = jobs || (job ? [job] : []);
    if (session.status === 'confirmed') base = 'confirmed';
    else if (list.length === 1 && list[0] && list[0].status === 'confirmed') base = 'confirmed'; // the original single-capture flow
    else if (list.length > 0 && list.every((j) => j && j.status === 'needs_review')) base = 'review';
    else base = 'draft';
  } else {
    base = session.status === 'confirmed' || session.status === 'review' ? session.status : 'draft';
  }
  const status = base === 'confirmed' && runCount > 0 ? 'processed' : base;
  return { status, label: STATUS_LABELS[status], confirmed: base === 'confirmed' };
}

module.exports = { deriveStatus, STATUS_LABELS };
