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
const allowedOrigins = [
  'http://localhost:5173',
  'https://med-reminder-gh8a.vercel.app',
  ...(process.env.CORS_ORIGIN || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests without an Origin header
      // and requests from approved frontend URLs.
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      console.log('CORS blocked origin:', origin);
      return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/api/health', (req, res) => {
  const isConnected = mongoose.connection.readyState === 1;

  return res.json({
    success: true,
    message: 'MedReminder API is running',
    database: isConnected ? 'connected' : 'disconnected',
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/medicines', medicineRoutes);
app.use('/api/history', historyRoutes);
app.use('/api/caregiver', caregiverRoutes);
app.use('/api/notifications', notificationRoutes);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ message: err.message || 'Something went wrong' });
});

const startServer = async () => {
  const dbReady = await connectDB();
  if (dbReady) {
    await migrateLegacyTrustedDevices();
  }
  const server = app.listen(PORT, () => {
    console.log(`Express running on port ${PORT}`);
    if (dbReady) {
      startScheduler();
    }

    if (!dbReady) {
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

startServer();

module.exports = app;
