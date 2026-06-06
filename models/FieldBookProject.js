const mongoose = require('mongoose');

const fieldBookProjectSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true },
    year: { type: String, default: '' },
    team: { type: String, default: '' },
    site: { type: String, default: '' },
    notes: { type: String, default: '' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('FieldBookProject', fieldBookProjectSchema);
