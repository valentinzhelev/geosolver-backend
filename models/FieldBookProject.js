const mongoose = require('mongoose');

const fieldBookProjectSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', default: null, index: true },
    name: { type: String, required: true, trim: true },
    year: { type: String, default: '' },
    team: { type: String, default: '' },
    site: { type: String, default: '' },
    notes: { type: String, default: '' },
    /** Project CRS for GNSS import / stake-out defaults (e.g. EPSG:7801). */
    crs: { type: String, default: 'EPSG:7801', trim: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('FieldBookProject', fieldBookProjectSchema);
