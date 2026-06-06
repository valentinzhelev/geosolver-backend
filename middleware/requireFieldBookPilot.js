const FieldBookPilotRequest = require('../models/FieldBookPilotRequest');

async function requireFieldBookPilot(req, res, next) {
  try {
    if (req.userRole === 'admin') {
      return next();
    }
    const requestDoc = await FieldBookPilotRequest.findOne({
      user: req.userId,
      status: 'approved',
    });
    if (!requestDoc) {
      return res.status(403).json({
        success: false,
        message: 'Нямате достъп до пилотната версия на електронните карнети.',
        code: 'FIELDBOOK_PILOT_REQUIRED',
      });
    }
    next();
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

module.exports = requireFieldBookPilot;
