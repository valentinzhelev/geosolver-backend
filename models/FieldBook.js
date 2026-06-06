const mongoose = require('mongoose');

const fieldBookRowSchema = new mongoose.Schema(
  {
    // Leveling fields
    station: { type: String, default: '' },
    back: { type: Number, default: null },
    fore: { type: Number, default: null },
    delta: { type: Number, default: null },
    height: { type: Number, default: null },
    // Coordinate (traverse) fields
    pointNo: { type: String, default: '' },
    beta: { type: Number, default: null },
    alpha: { type: Number, default: null },
    distance: { type: Number, default: null },
    deltaY: { type: Number, default: null },
    deltaX: { type: Number, default: null },
    y: { type: Number, default: null },
    x: { type: Number, default: null },
    // Shared
    isControl: { type: Boolean, default: false },
    comment: { type: String, default: '' },
  },
  { _id: true }
);

const calculationEntrySchema = new mongoose.Schema(
  {
    timestamp: { type: Date, default: Date.now },
    warnings: [{ type: String }],
    summary: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { _id: true }
);

const fieldBookSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    project: { type: mongoose.Schema.Types.ObjectId, ref: 'FieldBookProject', required: true, index: true },
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: ['leveling', 'coordinate'], default: 'leveling' },
    date: { type: String, default: '' },
    crew: { type: String, default: '' },
    site: { type: String, default: '' },
    notes: { type: String, default: '' },
    locked: { type: Boolean, default: false },
    archived: { type: Boolean, default: false },
    settings: {
      // Leveling
      benchmarkHeight: { type: Number, default: 0 },
      toleranceMm: { type: Number, default: 5 },
      rounding: { type: Number, default: 3 },
      // Coordinate (traverse)
      startY: { type: Number, default: 1000 },
      startX: { type: Number, default: 1000 },
      startBearing: { type: Number, default: 0 },
      closed: { type: Boolean, default: true },
      endY: { type: Number, default: null },
      endX: { type: Number, default: null },
      angleRounding: { type: Number, default: 4 },
      angularToleranceMgon: { type: Number, default: 50 },
      linearTolerance: { type: Number, default: 1000 },
    },
    rows: [fieldBookRowSchema],
    calculationHistory: [calculationEntrySchema],
    lastCalculated: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('FieldBook', fieldBookSchema);
