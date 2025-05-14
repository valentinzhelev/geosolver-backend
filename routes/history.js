const express = require("express");
const router = express.Router();
const History = require("../models/History");

// POST /api/history
router.post("/", async (req, res) => {
    try {
        const newEntry = new History(req.body);
        await newEntry.save();
        res.status(201).json({ message: "Saved" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/history
router.get("/", async (req, res) => {
    try {
        const data = await History.find().sort({ date: -1 }).limit(20);
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
