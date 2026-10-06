require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const connectDB = require('./config/db');
const authRoutes = require('./routes/auth');
const medicineRoutes = require('./routes/medicine');
const historyRoutes = require('./routes/history');
const caregiverRoutes = require('./routes/caregiver');
const notificationRoutes = require('./routes/notifications');
const { startScheduler } = require('./services/reminderScheduler');
const migrateLegacyTrustedDevices = require('./services/trustedDeviceMigration');

const app = express();
const PORT = Number(process.env.PORT || 5000);

const defaultAllowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'https://med-reminder-gh8a.vercel.app',
];

const envAllowedOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const allowedOrigins = [...new Set([...defaultAllowedOrigins, ...envAllowedOrigins])];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests without an Origin header (like mobile apps, curl, server-to-server)
      // and requests from approved frontend URLs.
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      console.warn('CORS blocked origin:', origin);
      return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Timezone-Offset', 'X-Senior-Id', 'Accept'],
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get('/api/health', async (req, res) => {
  let isConnected = mongoose.connection.readyState === 1;
  if (!isConnected) {
    isConnected = await connectDB();
  }

  return res.json({
    status: 'ok',
    service: 'MedReminder Backend',
    database: isConnected ? 'connected' : 'disconnected',
    success: isConnected,
  });
});

// Middleware to ensure DB connection before processing API routes
app.use(async (req, res, next) => {
  try {
    const isConnected = mongoose.connection.readyState === 1 || (await connectDB());
    if (!isConnected) {
      return res.status(503).json({
        message: 'Database connection unavailable. Please try again shortly.',
      });
    }
    next();
  } catch (error) {
    return res.status(503).json({
      message: 'Database connection failed.',
    });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/medicines', medicineRoutes);
app.use('/api/history', historyRoutes);
app.use('/api/caregiver', caregiverRoutes);
app.use('/api/notifications', notificationRoutes);

app.use((err, req, res, next) => {
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ message: 'CORS origin not allowed' });
  }
  console.error('Unhandled request error:', err);
  res.status(500).json({ message: err.message || 'Internal server error' });
});

const startServer = async () => {
  const dbReady = await connectDB();
  if (dbReady) {
    try {
      await migrateLegacyTrustedDevices();
    } catch (e) {
      console.error('Trusted devices migration warning:', e.message);
    }
  }

  const server = app.listen(PORT, () => {
    console.log(`Express running on port ${PORT}`);
    if (dbReady) {
      startScheduler();
    } else {
      console.log('MongoDB connection failed. Check MONGODB_URI and make sure MongoDB/MongoDB Atlas is reachable.');
    }
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already in use. Stop the existing backend process before starting MedReminder again.`);
      process.exit(1);
    }

    console.error(`Express failed to listen on port ${PORT}:`, error);
    process.exit(1);
  });
};

if (require.main === module) {
  startServer();
}

module.exports = app;
