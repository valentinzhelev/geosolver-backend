/**
 * GAI V1 Project Geodetic Assistant API (section 18). Read-only assistant: no route here ever creates, edits, or
 * deletes project/geodetic data - the only writes are the conversation/message records of the chat itself.
 *
 *   POST /api/gai/conversations                 start a new conversation for a project
 *   GET  /api/gai/conversations?projectId=...    list the caller's own conversations for a project
 *   GET  /api/gai/conversations/:id              one conversation with its messages
 *   POST /api/gai/conversations/:id/messages     ask a question -> {message, evidence}
 *   GET  /api/gai/starters?projectId=...         context-aware starter questions (deterministic, no provider call)
 *
 * Every route: authentication + at least viewer access to the project (getProjectAccess/hasMinRole, same convention
 * as routes/reports.js). A conversation is private to the user who created it, re-verified on every request.
 *
 * V1.0.2: errors are rendered ONLY from gai/errors.js's public table (no provider text can reach a client), and a
 * question is persisted together with its answer only when generation succeeds - a failed attempt leaves the
 * conversation exactly as it was, so retrying never duplicates anything.
 */
const express = require('express');
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const { getProjectAccess, hasMinRole } = require('../utils/workspaceAccess');
const GaiConversation = require('../models/GaiConversation');
const GaiMessage = require('../models/GaiMessage');
const { answerQuestion } = require('../gai/service');
const { toPublicError } = require('../gai/errors');
const { getProjectSummary, pickExamplePointName } = require('../gai/tools');
const { buildStarters } = require('../gai/starters');

const router = express.Router();
router.use(auth);
router.use(express.json({ limit: '8kb' }));

const fail = (res, status, code, message) => res.status(status).json({ success: false, code, message });
const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
  const pub = toPublicError(e);
  if (pub.code === 'INTERNAL') console.error('gai: unexpected error', { name: e && e.name }); // never message/context
  fail(res, pub.status, pub.code, pub.message);
});

const MAX_QUESTION_LENGTH = 2000;
const HISTORY_LIMIT = 6;

async function requireProjectAccess(req, res, projectId) {
  if (!projectId || !mongoose.isValidObjectId(projectId)) {
    fail(res, 400, 'INVALID_REQUEST', 'Липсва валиден идентификатор на проект.');
    return null;
  }
  const access = await getProjectAccess(req.userId, projectId);
  if (!access.ok || !hasMinRole(access.role, 'viewer')) {
    fail(res, 404, 'NOT_FOUND', 'Проектът не е намерен.');
    return null;
  }
  return access;
}

/** Loads a conversation and verifies it belongs to BOTH this user and a project they can still access. */
async function loadOwnConversation(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    fail(res, 404, 'NOT_FOUND', 'Разговорът не е намерен.');
    return null;
  }
  const conversation = await GaiConversation.findById(req.params.id);
  if (!conversation || String(conversation.user) !== String(req.userId)) {
    fail(res, 404, 'NOT_FOUND', 'Разговорът не е намерен.');
    return null;
  }
  const access = await requireProjectAccess(req, res, conversation.projectId);
  if (!access) return null;
  return conversation;
}

function publicConversation(c) {
  return { id: String(c._id), projectId: String(c.projectId), title: c.title, createdAt: c.createdAt, updatedAt: c.updatedAt };
}

function publicMessage(m) {
  return {
    id: String(m._id),
    role: m.role,
    text: m.text,
    evidence: m.evidence || [],
    model: m.model || null,
    promptVersion: m.promptVersion || null,
    createdAt: m.createdAt,
  };
}

router.post('/conversations', wrap(async (req, res) => {
  const { projectId } = req.body || {};
  const access = await requireProjectAccess(req, res, projectId);
  if (!access) return;

  const conversation = await GaiConversation.create({ user: req.userId, projectId, title: null });
  res.status(201).json({ success: true, data: publicConversation(conversation) });
}));

router.get('/conversations', wrap(async (req, res) => {
  const projectId = req.query && req.query.projectId;
  const access = await requireProjectAccess(req, res, projectId);
  if (!access) return;

  const conversations = await GaiConversation.find({ projectId, user: req.userId }).sort({ updatedAt: -1 });
  res.json({ success: true, data: conversations.map(publicConversation) });
}));

router.get('/conversations/:id', wrap(async (req, res) => {
  const conversation = await loadOwnConversation(req, res);
  if (!conversation) return;

  const messages = await GaiMessage.find({ conversationId: conversation._id }).sort({ createdAt: 1, _id: 1 });
  res.json({ success: true, data: { conversation: publicConversation(conversation), messages: messages.map(publicMessage) } });
}));

router.post('/conversations/:id/messages', wrap(async (req, res) => {
  const conversation = await loadOwnConversation(req, res);
  if (!conversation) return;

  const question = String((req.body && req.body.text) || '').trim();
  if (!question) return fail(res, 400, 'INVALID_REQUEST', 'Въпросът не може да бъде празен.');
  if (question.length > MAX_QUESTION_LENGTH) return fail(res, 400, 'INVALID_REQUEST', 'Въпросът е твърде дълъг.');

  const recent = await GaiMessage.find({ conversationId: conversation._id }).sort({ createdAt: -1, _id: -1 }).limit(HISTORY_LIMIT);
  const history = recent.reverse().map((m) => ({ role: m.role, text: m.text }));

  // throws a normalised GaiError on any failure -> nothing below runs, nothing is persisted
  const { text, evidence, model, promptVersion } = await answerQuestion({
    projectId: String(conversation.projectId), userId: req.userId, question, history,
  });

  await GaiMessage.create({ conversationId: conversation._id, projectId: conversation.projectId, user: req.userId, role: 'user', text: question });
  const assistantMessage = await GaiMessage.create({
    conversationId: conversation._id, projectId: conversation.projectId, user: req.userId, role: 'assistant',
    text, evidence, model, promptVersion,
  });

  if (!conversation.title) conversation.title = question.slice(0, 80);
  conversation.updatedAt = new Date();
  await conversation.save();

  res.status(201).json({ success: true, data: { message: publicMessage(assistantMessage), evidence: assistantMessage.evidence } });
}));

router.get('/starters', wrap(async (req, res) => {
  const projectId = req.query && req.query.projectId;
  const access = await requireProjectAccess(req, res, projectId);
  if (!access) return;

  const [summary, examplePoint] = await Promise.all([getProjectSummary(projectId), pickExamplePointName(projectId)]);
  res.json({ success: true, data: buildStarters(summary, examplePoint) });
}));

module.exports = router;
