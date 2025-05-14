const mongoose = require("mongoose");

const historySchema = new mongoose.Schema({
    x1: Number,
    y1: Number,
    alpha: Number,
    s: Number,
    result: Object,
    date: { type: Date, default: Date.now }
});

module.exports = mongoose.model("History", historySchema);
