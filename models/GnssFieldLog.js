const mongoose = require('mongoose');

const gnssFieldLogSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'FieldBookProject', default: null, index: true },
    date: { type: String, default: '' },
    site: { type: String, default: '', trim: true },
    base: { type: String, default: '', trim: true },
    rover: { type: String, default: '', trim: true },
    antennaHeight: { type: String, default: '' },
    fixType: { type: String, default: '', trim: true },
    hdop: { type: String, default: '' },
    notes: { type: String, default: '' },
  },
  { timestamps: true }
);

gnssFieldLogSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('GnssFieldLog', gnssFieldLogSchema);
