require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");

const historyRoutes = require("./routes/history");
const authRoutes = require("./routes/auth");
const contactRoute = require('./routes/contact');
const userPreferencesRoutes = require('./routes/userPreferences');
const googleAuthRoutes = require('./routes/googleAuth');
const assignmentRoutes = require('./routes/assignments');
const studentRoutes = require('./routes/students');
const classRoutes = require('./routes/classes');
const submissionRoutes = require('./routes/submissions');
const plansRoutes = require('./routes/plans');
const subscriptionsRoutes = require('./routes/subscriptions');
const paymentsRoutes = require('./routes/payments');
const calculationsRoutes = require('./routes/calculations');

const app = express();
app.use(cors({
    origin: '*', // или конкретния ти frontend адрес
    credentials: true
}));
app.use(express.json());

app.use("/api/history", historyRoutes);
app.use("/api/auth", authRoutes);
app.use('/api/contact', contactRoute);
app.use('/api/user-preferences', userPreferencesRoutes);
app.use('/api/google-auth', googleAuthRoutes);
app.use('/api/assignments', assignmentRoutes);
app.use('/api/students', studentRoutes);
app.use('/api/classes', classRoutes);
app.use('/api/submissions', submissionRoutes);
app.use('/api/plans', plansRoutes);
app.use('/api/subscriptions', subscriptionsRoutes);
app.use('/api/payments', paymentsRoutes);
app.use('/api/calculations', calculationsRoutes);

mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => {
    console.log("✅ Connected to MongoDB");
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
}).catch(err => console.error("❌ MongoDB connection error:", err));