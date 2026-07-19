const Workspace = require('../models/Workspace');
const FieldBookProject = require('../models/FieldBookProject');

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

module.exports = {
  getMemberWorkspaceIds,
  getSharedProjectIds,
  getProjectAccess,
  getWorkspaceMembership,
  hasMinRole,
};
