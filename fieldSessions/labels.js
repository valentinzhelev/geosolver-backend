/** User-facing Bulgarian wording for Field Sessions (kept out of routes/service so it is testable and reusable). */
const SOURCE_LABELS = {
  manual: 'Ръчно въведена',
  capture: 'От снимка на полеви карнет',
  none: 'Още няма данни',
};

const SOFIA_DAY = (() => {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Sofia', day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch {
    return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' });
  }
})();

/** 'YYYY-MM-DD' (a calendar day) -> 'dd.mm.yyyy' by pure re-ordering: no time-zone can shift a field date. */
function formatDay(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
  return m ? `${m[3]}.${m[2]}.${m[1]}` : null;
}

/** An instant -> 'dd.mm.yyyy' in Bulgarian local time. */
function formatInstant(value) {
  const d = value ? new Date(value) : null;
  if (!d || Number.isNaN(d.getTime())) return null;
  const p = Object.fromEntries(SOFIA_DAY.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.day}.${p.month}.${p.year}`;
}

/** The title shown everywhere a session is named: the user's own, else "Теренна сесия — <field date | created date>". */
function displayTitle(session) {
  if (session.title && String(session.title).trim()) return String(session.title).trim();
  const day = formatDay(session.date) || formatInstant(session.createdAt);
  return day ? `Теренна сесия — ${day}` : 'Теренна сесия';
}

const sourceKey = (session) => (session.source && session.source.kind) || 'none';
const sourceLabel = (session) => SOURCE_LABELS[sourceKey(session)] || SOURCE_LABELS.none;

module.exports = { displayTitle, sourceLabel, sourceKey, formatDay, formatInstant, SOURCE_LABELS };
