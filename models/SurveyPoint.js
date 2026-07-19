const mongoose = require('mongoose');

const surveyPointSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'FieldBookProject', default: null, index: true },
    name: { type: String, required: true, trim: true },
    code: { type: String, default: '', trim: true },
    x: { type: Number, default: null },
    y: { type: Number, default: null },
    h: { type: Number, default: null },
    pointClass: { type: String, default: '', trim: true },
    layer: { type: String, default: 'default', trim: true },
    notes: { type: String, default: '' },
  },
  { timestamps: true }
);

surveyPointSchema.index({ user: 1, name: 1 });

module.exports = mongoose.model('SurveyPoint', surveyPointSchema);
