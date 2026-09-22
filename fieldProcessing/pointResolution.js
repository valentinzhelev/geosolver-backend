/**
 * Server-side resolution of a Field Notebook station/orientation identifier against SurveyPoints of the SAME
 * project (V2.4.1 section 2). Client-supplied coordinates are never trusted for this: only the identifier TEXT
 * from the confirmed FieldObservationSet is used, and it is matched against the database.
 *
 * Matching semantics (explicit, deterministic, documented - never a fuzzy/best guess):
 *   - matched by POINT NAME only, trimmed and case-insensitively (same normalization
 *     capture/importService.js#findConflicts already uses for coordinate-table point-name conflicts);
 *   - point CODE is never used to resolve identity: a code is a classification shared by many points (see
 *     capture/importService.js's own comment - "a matching code alone is not a conflict"), so it cannot safely
 *     identify ONE specific station/backsight.
 *
 * Exactly one name match -> RESOLVED. Zero -> MISSING. More than one -> AMBIGUOUS: processing for that setup is
 * blocked and the candidates are reported so the user can rename points to disambiguate - never guessed.
 */
const norm = (s) => String(s || '').trim().toLowerCase();

/**
 * @param {object} SurveyPointModel the SurveyPoint mongoose model (or a compatible fake)
 * @param {string} projectId
 * @param {string} identifier the station/orientation point name recorded in the notebook
 * @returns {Promise<
 *   {status:'RESOLVED', point:{id:string,name:string,code:string,x:number|null,y:number|null,h:number|null}} |
 *   {status:'MISSING'} |
 *   {status:'AMBIGUOUS', candidates:{id:string,name:string,code:string}[]}
 * >}
 */
async function resolvePointByName(SurveyPointModel, projectId, identifier) {
  const target = norm(identifier);
  if (!target) return { status: 'MISSING' };
  const points = await SurveyPointModel.find({ projectId }).select('name code x y h').lean();
  const matches = points.filter((p) => norm(p.name) === target);
  if (matches.length === 0) return { status: 'MISSING' };
  if (matches.length > 1) {
    return { status: 'AMBIGUOUS', candidates: matches.map((p) => ({ id: String(p._id), name: p.name, code: p.code || '' })) };
  }
  const p = matches[0];
  return { status: 'RESOLVED', point: { id: String(p._id), name: p.name, code: p.code || '', x: p.x, y: p.y, h: p.h } };
}

module.exports = { resolvePointByName };
