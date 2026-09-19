const Workspace = require('../models/Workspace');
const FieldBookProject = require('../models/FieldBookProject');
const SurveyPoint = require('../models/SurveyPoint');

const ROLE_RANK = { viewer: 0, editor: 1, admin: 2, owner: 3 };

async function getMemberWorkspaceIds(userId) {
  const workspaces = await Workspace.find({
    $or: [{ owner: userId }, { 'members.user': userId }],
  }).select('_id');
  return workspaces.map((w) => w._id);
}

async function getSharedProjectIds(userId) {
  const wsIds = await getMemberWorkspaceIds(userId);
  if (!wsIds.length) return [];
  const projects = await FieldBookProject.find({ workspace: { $in: wsIds } }).select('_id');
  return projects.map((p) => p._id);
}

async function getProjectAccess(userId, projectId) {
  const project = await FieldBookProject.findById(projectId);
  if (!project) return { ok: false, project: null };

  if (String(project.user) === String(userId)) {
    return { ok: true, role: 'owner', project };
  }

  if (!project.workspace) return { ok: false, project };

  const workspace = await Workspace.findById(project.workspace);
  if (!workspace) return { ok: false, project };

  if (String(workspace.owner) === String(userId)) {
    return { ok: true, role: 'owner', project, workspace };
  }

  const member = workspace.members.find((m) => String(m.user) === String(userId));
  if (!member) return { ok: false, project };

  return { ok: true, role: member.role, project, workspace };
}

async function getWorkspaceMembership(userId, workspaceId) {
  const workspace = await Workspace.findById(workspaceId);
  if (!workspace) return { ok: false, workspace: null };
  if (String(workspace.owner) === String(userId)) {
    return { ok: true, role: 'owner', workspace };
  }
  const member = workspace.members.find((m) => String(m.user) === String(userId));
  if (!member) return { ok: false, workspace };
  return { ok: true, role: member.role, workspace };
}

function hasMinRole(role, minRole) {
  return (ROLE_RANK[role] ?? -1) >= (ROLE_RANK[minRole] ?? 99);
}

/**
 * Access check for a single SurveyPoint: either the caller owns it directly,
 * or it belongs to a project the caller has (at least) some role in.
 * Moved here from routes/surveyPoints.js so routes/calculations.js can reuse
 * the exact same rule when resolving point references (Milestone 1 §4) —
 * do not reimplement this check elsewhere.
 */
async function getPointAccess(userId, pointId) {
  const point = await SurveyPoint.findById(pointId);
  if (!point) return { ok: false, point: null };
  if (String(point.user) === String(userId)) {
    return { ok: true, role: 'owner', point };
  }
  if (point.projectId) {
    const access = await getProjectAccess(userId, point.projectId);
    if (access.ok) return { ok: true, role: access.role, point };
  }
  return { ok: false, point };
}

module.exports = {
  getMemberWorkspaceIds,
  getSharedProjectIds,
  getProjectAccess,
  getWorkspaceMembership,
  getPointAccess,
  hasMinRole,
};
