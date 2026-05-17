const mongoose = require('mongoose');

function toIdString(id) {
  if (!id) return '';
  return id.toString();
}

function idsEqual(a, b) {
  return toIdString(a) === toIdString(b);
}

function includesId(list, id) {
  if (!Array.isArray(list)) return false;
  const target = toIdString(id);
  return list.some((item) => toIdString(item) === target);
}

function toObjectId(id) {
  if (!id) return null;
  if (id instanceof mongoose.Types.ObjectId) return id;
  if (mongoose.Types.ObjectId.isValid(id)) return new mongoose.Types.ObjectId(id);
  return null;
}

module.exports = { toIdString, idsEqual, includesId, toObjectId };
