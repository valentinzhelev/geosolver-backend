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
const usersRoutes = require('./routes/users');
const billingRoutes = require('./routes/billing');
const webhooksRoutes = require('./routes/webhooks');

// Teacher Panel Routes
const taskTemplateRoutes = require('./routes/taskTemplates');
const courseRoutes = require('./routes/courses');
const studentAssignmentRoutes = require('./routes/studentAssignments');
const scanRoutes = require('./routes/scan');

const app = express();
app.use(cors({
    origin: '*',
    credentials: true
}));

// Stripe webhook needs raw body – must be before express.json()
app.use('/api/webhooks/stripe', express.raw({ type: 'application/json' }), webhooksRoutes.stripeWebhookHandler);
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
app.use('/api/users', usersRoutes);

// Teacher Panel API Routes
app.use('/api/teacher/tasks', taskTemplateRoutes);
app.use('/api/teacher/courses', courseRoutes);
app.use('/api/teacher/assignments', assignmentRoutes);
app.use('/api/student/assignments', studentAssignmentRoutes);
app.use('/api/scan', scanRoutes);
app.use('/api/billing', billingRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development'
  });
});

mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => {
    console.log("Connected to MongoDB");
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}).catch(err => console.error("MongoDB connection error:", err));