const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const Workspace = require('../models/Workspace');
const User = require('../models/User');
const FieldBookProject = require('../models/FieldBookProject');
const { hasMinRole } = require('../utils/workspaceAccess');
const { sendMail, isConfigured: isMailConfigured } = require('../utils/mailer');
const { workspaceInviteEmail } = require('../utils/emailTemplates');

router.use(auth);

function populateWorkspace(ws) {
  return Workspace.findById(ws._id)
    .populate('owner', 'name email')
    .populate('members.user', 'name email');
}

router.get('/', async (req, res) => {
  try {
    const owned = await Workspace.find({ owner: req.userId })
      .populate('owner', 'name email')
      .populate('members.user', 'name email')
      .sort({ updatedAt: -1 });
    const memberOf = await Workspace.find({ owner: { $ne: req.userId }, 'members.user': req.userId })
      .populate('owner', 'name email')
      .populate('members.user', 'name email')
      .sort({ updatedAt: -1 });
    res.json({ success: true, data: { owned, memberOf } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    if (!name) {
      return res.status(400).json({ success: false, message: 'Името на workspace е задължително.' });
    }
    const workspace = await Workspace.create({
      name,
      owner: req.userId,
      members: [{ user: req.userId, role: 'admin' }],
    });
    const populated = await populateWorkspace(workspace);
    res.status(201).json({ success: true, data: populated });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/join', async (req, res) => {
  try {
    const code = String(req.body.inviteCode || '').trim().toUpperCase();
    if (!code) {
      return res.status(400).json({ success: false, message: 'Липсва код за покана.' });
    }
    const workspace = await Workspace.findOne({ inviteCode: code });
    if (!workspace) {
      return res.status(404).json({ success: false, message: 'Невалиден код.' });
    }
    const exists = workspace.members.some((m) => String(m.user) === String(req.userId));
    if (!exists) {
      workspace.members.push({ user: req.userId, role: 'editor' });
      await workspace.save();
    }
    const populated = await populateWorkspace(workspace);
    res.json({ success: true, data: populated });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/:id/invite', async (req, res) => {
  try {
    const workspace = await Workspace.findById(req.params.id);
    if (!workspace) {
      return res.status(404).json({ success: false, message: 'Workspace не е намерен.' });
    }
    const member = workspace.members.find((m) => String(m.user) === String(req.userId));
    const isOwner = String(workspace.owner) === String(req.userId);
    if (!isOwner && (!member || !hasMinRole(member.role, 'admin'))) {
      return res.status(403).json({ success: false, message: 'Нямате права за покана.' });
    }
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email е задължителен.' });
    }
    const role = ['viewer', 'editor', 'admin'].includes(req.body.role) ? req.body.role : 'editor';
    const inviter = await User.findById(req.userId).select('name email');
    const user = await User.findOne({ email });

    let mailSent = false;
    let mailSkippedReason = '';

    const trySendInvite = async ({ recipientName, hasAccount }) => {
      if (!isMailConfigured()) {
        mailSkippedReason = 'mail_not_configured';
        return;
      }
      try {
        const tpl = workspaceInviteEmail({
          recipientName,
          workspaceName: workspace.name,
          inviterName: inviter?.name || inviter?.email || '',
          role,
          inviteCode: workspace.inviteCode,
          hasAccount,
        });
        await sendMail({ to: email, subject: tpl.subject, html: tpl.html, tags: ['workspace-invite'] });
        mailSent = true;
      } catch (mailErr) {
        mailSkippedReason = mailErr.message || 'mail_failed';
      }
    };

    if (!user) {
      await trySendInvite({ recipientName: '', hasAccount: false });
      return res.status(mailSent ? 200 : 404).json({
        success: mailSent,
        mailSent,
        inviteCode: workspace.inviteCode,
        message: mailSent
          ? 'Изпратен е имейл с invite код за регистрация.'
          : 'Потребителят няма акаунт в GeoSolver. Сподели invite кода след регистрация.',
        ...(mailSkippedReason ? { mailSkippedReason } : {}),
      });
    }

    const already = workspace.members.some((m) => String(m.user) === String(user._id));
    if (!already) {
      workspace.members.push({ user: user._id, role });
      await workspace.save();
    }
    await trySendInvite({ recipientName: user.name || '', hasAccount: true });

    const populated = await populateWorkspace(workspace);
    res.json({
      success: true,
      data: populated,
      mailSent,
      ...(mailSkippedReason ? { mailSkippedReason } : {}),
      message: already
        ? mailSent
          ? 'Потребителят вече е член — изпратен е напомнящ имейл.'
          : 'Потребителят вече е член.'
        : mailSent
          ? 'Потребителят е добавен и е уведомен по имейл.'
          : 'Потребителят е добавен към workspace.',
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.patch('/:id/members/:userId', async (req, res) => {
  try {
    const workspace = await Workspace.findById(req.params.id);
    if (!workspace) {
      return res.status(404).json({ success: false, message: 'Workspace не е намерен.' });
    }
    const isOwner = String(workspace.owner) === String(req.userId);
    const actor = workspace.members.find((m) => String(m.user) === String(req.userId));
    if (!isOwner && (!actor || !hasMinRole(actor.role, 'admin'))) {
      return res.status(403).json({ success: false, message: 'Нямате права за промяна на роли.' });
    }
    if (String(req.params.userId) === String(workspace.owner)) {
      return res.status(400).json({ success: false, message: 'Ролята на собственика не се променя тук.' });
    }
    const role = ['viewer', 'editor', 'admin'].includes(req.body.role) ? req.body.role : null;
    if (!role) {
      return res.status(400).json({ success: false, message: 'Невалидна роля.' });
    }
    const target = workspace.members.find((m) => String(m.user) === String(req.params.userId));
    if (!target) {
      return res.status(404).json({ success: false, message: 'Членът не е намерен.' });
    }
    target.role = role;
    await workspace.save();
    const populated = await populateWorkspace(workspace);
    res.json({ success: true, data: populated });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.delete('/:id/members/:userId', async (req, res) => {
  try {
    const workspace = await Workspace.findById(req.params.id);
    if (!workspace) {
      return res.status(404).json({ success: false, message: 'Workspace не е намерен.' });
    }
    const isOwner = String(workspace.owner) === String(req.userId);
    const member = workspace.members.find((m) => String(m.user) === String(req.userId));
    if (!isOwner && (!member || !hasMinRole(member.role, 'admin'))) {
      return res.status(403).json({ success: false, message: 'Нямате права.' });
    }
    if (String(req.params.userId) === String(workspace.owner)) {
      return res.status(400).json({ success: false, message: 'Собственикът не може да бъде премахнат.' });
    }
    workspace.members = workspace.members.filter((m) => String(m.user) !== String(req.params.userId));
    await workspace.save();
    const populated = await populateWorkspace(workspace);
    res.json({ success: true, data: populated });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/:id/projects', async (req, res) => {
  try {
    const workspace = await Workspace.findById(req.params.id);
    if (!workspace) {
      return res.status(404).json({ success: false, message: 'Workspace не е намерен.' });
    }
    const isMember = workspace.members.some((m) => String(m.user) === String(req.userId));
    if (!isMember && String(workspace.owner) !== String(req.userId)) {
      return res.status(403).json({ success: false, message: 'Нямате достъп.' });
    }
    const projects = await FieldBookProject.find({ workspace: workspace._id }).sort({ updatedAt: -1 });
    res.json({ success: true, data: projects });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
