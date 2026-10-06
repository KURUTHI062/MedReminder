const mongoose = require('mongoose');
const dns = require('node:dns');

let cached = global.mongoose;
if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

const connectDB = async () => {
  const mongoUri = process.env.MONGODB_URI;
  const databaseName = process.env.MONGODB_DB_NAME || 'medreminder';

  if (!mongoUri) {
    console.error('MONGODB_URI is not configured in environment variables.');
    return false;
  }

  if (mongoose.connection.readyState === 1) {
    return true;
  }

  if (cached.conn && mongoose.connection.readyState === 1) {
    return true;
  }

  try {
    const dnsServers = process.env.MONGODB_DNS_SERVERS?.split(',').map((server) => server.trim()).filter(Boolean);
    if (dnsServers?.length) {
      dns.setServers(dnsServers);
    }

    if (!cached.promise) {
      const opts = {
        dbName: databaseName,
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 10000,
      };

      cached.promise = mongoose.connect(mongoUri, opts).then((mongooseInstance) => {
        console.log(`MongoDB connected: ${mongooseInstance.connection.host}/${mongooseInstance.connection.name}`);
        return mongooseInstance;
      });
    }

    cached.conn = await cached.promise;
    return true;
  } catch (error) {
    cached.promise = null;
    cached.conn = null;
    console.error('MongoDB connection failed:', error.message);
    return false;
  }
};

module.exports = connectDB;
