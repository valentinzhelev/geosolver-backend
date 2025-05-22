require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");

const historyRoutes = require("./routes/history");
const authRoutes = require("./routes/auth");

const app = express();
app.use(cors());
app.use(express.json());

app.use("/api/history", historyRoutes);
app.use("/api/auth", authRoutes);

mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => {
    console.log("✅ Connected to MongoDB");
    app.listen(3000, () => console.log("🚀 Server running on http://localhost:3000"));
}).catch(err => console.error("❌ MongoDB connection error:", err));
