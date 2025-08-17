require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");

const historyRoutes = require("./routes/history");
const authRoutes = require("./routes/auth");
const contactRoute = require('./routes/contact');

const app = express();
app.use(cors({
    origin: '*', // или конкретния ти frontend адрес
    credentials: true
}));
app.use(express.json());

app.use("/api/history", historyRoutes);
app.use("/api/auth", authRoutes);
app.use('/api/contact', contactRoute);

mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => {
    console.log("✅ Connected to MongoDB");
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
}).catch(err => console.error("❌ MongoDB connection error:", err));
