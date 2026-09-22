// Express app definition, split out of index.js so it can be required by
// tests (supertest) without connecting to MongoDB or starting a listener.
// index.js still requires "./instrument" (Sentry) before this file, so
// Sentry's auto-instrumentation ordering is unchanged.
const Sentry = require("./instrument");
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const historyRoutes = require("./routes/history");
const authRoutes = require("./routes/auth");
const contactRoute = require('./routes/contact');
const userPreferencesRoutes = require('./routes/userPreferences');
const googleAuthRoutes = require('./routes/googleAuth');
const assignmentRoutes = require('./routes/assignments');
const studentRoutes = require('./routes/students');
const classRoutes = require('./routes/classes');
// SECURITY: routes/submissions.js is intentionally NOT required/mounted.
// It is legacy (pre-dates the Course/Assignment/TaskTemplate/Submission
// classroom system), its handlers are incompatible with the current
// Submission schema (it reads/writes studentId/assignmentId/teacherId/files,
// which do not exist on models/Submission.js — see Milestone 0.5 audit), and
// it contains an unauthenticated file-upload POST and an unauthenticated
// file-serving GET. The current student submission flow is
// routes/studentAssignments.js (POST /assignments/:id/submit), which does
// not depend on this file in any way. The file itself, models/Submission.js,
// any uploaded files, and any existing database documents are left
// untouched — this only removes the HTTP route. Restore by re-adding the
// require above and the `app.use('/api/submissions', submissionRoutes)`
// line below.
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
const studentCourseRoutes = require('./routes/studentCourses');
const classroomOverviewRoutes = require('./routes/classroomOverview');
const notificationsRoutes = require('./routes/notifications');
const teacherAccessRoutes = require('./routes/teacherAccess');
const fieldbookPilotRoutes = require('./routes/fieldbookPilot');
const fieldbooksRoutes = require('./routes/fieldbooks');
const surveyPointsRoutes = require('./routes/surveyPoints');
const apiV1Routes = require('./routes/apiV1');
const workspacesRoutes = require('./routes/workspaces');
const gnssFieldLogRoutes = require('./routes/gnssFieldLog');
const teacherTemplatesRoutes = require('./routes/teacherTemplates');
const scanRoutes = require('./routes/scan');
const captureRoutes = require('./routes/capture');
const fieldProcessingRoutes = require('./routes/fieldProcessing');
const projectCalculationsRoutes = require('./routes/projectCalculations');
const localeMiddleware = require('./middleware/locale');

const app = express();

// Trust the reverse proxy (needed for correct client IPs behind hosting/proxies,
// so rate limiting and secure cookies work as expected).
app.set('trust proxy', 1);

// Secure HTTP headers. Allow cross-origin resource loading since the API is
// consumed by a separate frontend origin (and may serve images/uploads).
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

// CORS: restrict to an explicit allow-list in production.
// Set ALLOWED_ORIGINS as a comma-separated list, e.g.
//   ALLOWED_ORIGINS=https://geosolver.bg,https://www.geosolver.bg
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const devOrigins = ['http://localhost:3000', 'http://127.0.0.1:3000'];
const corsWhitelist = allowedOrigins.length ? allowedOrigins : devOrigins;

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow non-browser clients (no Origin header), e.g. curl, mobile, health checks.
      if (!origin) return callback(null, true);
      if (corsWhitelist.includes(origin)) return callback(null, true);
      return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
  })
);

// Stripe webhook needs raw body – must be before express.json()
app.use('/api/webhooks/stripe', express.raw({ type: 'application/json' }), webhooksRoutes.stripeWebhookHandler);
app.use(express.json());
app.use(localeMiddleware);

// Rate limiting. Stricter on auth/contact (brute-force & spam), looser globally.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Твърде много опити. Опитайте отново по-късно.' },
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Твърде много заявки. Опитайте отново по-късно.' },
});

app.use('/api/auth', authLimiter);
app.use('/api/google-auth', authLimiter);
app.use('/api/contact', authLimiter);
app.use('/api', apiLimiter);

app.use("/api/history", historyRoutes);
app.use("/api/auth", authRoutes);
app.use('/api/contact', contactRoute);
app.use('/api/user-preferences', userPreferencesRoutes);
app.use('/api/google-auth', googleAuthRoutes);
app.use('/api/assignments', assignmentRoutes);
app.use('/api/students', studentRoutes);
app.use('/api/classes', classRoutes);
// app.use('/api/submissions', submissionRoutes); — intentionally not mounted, see comment near the require above.
app.use('/api/plans', plansRoutes);
app.use('/api/subscriptions', subscriptionsRoutes);
app.use('/api/payments', paymentsRoutes);
app.use('/api/calculations', calculationsRoutes);
app.use('/api/users', usersRoutes);

// Teacher Panel API Routes
app.use('/api/teacher/tasks', taskTemplateRoutes);
app.use('/api/teacher/courses', courseRoutes);
app.use('/api/teacher/assignments', assignmentRoutes);
app.use('/api/teacher/classroom', classroomOverviewRoutes);
app.use('/api/student/assignments', studentAssignmentRoutes);
app.use('/api/student/courses', studentCourseRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/teacher-access', teacherAccessRoutes);
app.use('/api/fieldbook-pilot', fieldbookPilotRoutes);
app.use('/api/fieldbooks', fieldbooksRoutes);
app.use('/api/points', surveyPointsRoutes);
app.use('/api/v1', apiV1Routes);
app.use('/api/workspaces', workspacesRoutes);
app.use('/api/gnss-field-log', gnssFieldLogRoutes);
app.use('/api/teacher/templates', teacherTemplatesRoutes);
app.use('/api/scan', scanRoutes);
app.use('/api/capture', captureRoutes); // Capture V2.1 (the legacy /api/scan flow is intentionally untouched)
app.use('/api/field-processing', fieldProcessingRoutes); // Field Processing V2.4.1 (deterministic, server-authoritative)
app.use('/api/projects', projectCalculationsRoutes);
app.use('/api/billing', billingRoutes);

// Health check endpoint.
// Reports DB connectivity so uptime monitors catch database outages, not just
// "process is alive". Returns 503 when MongoDB is not connected.
app.get('/api/health', (req, res) => {
  // mongoose.connection.readyState: 0=disconnected, 1=connected, 2=connecting, 3=disconnecting
  const dbState = mongoose.connection.readyState;
  const dbConnected = dbState === 1;
  res.status(dbConnected ? 200 : 503).json({
    status: dbConnected ? 'OK' : 'DEGRADED',
    db: dbConnected ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Sentry error handler — must be registered after all routes.
// No-op if SENTRY_DSN is not configured.
if (process.env.SENTRY_DSN) {
  Sentry.setupExpressErrorHandler(app);
}

module.exports = app;
