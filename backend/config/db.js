const mongoose = require('mongoose');
const dns = require('node:dns');

const connectDB = async () => {
  const mongoUri = process.env.MONGODB_URI;
  const databaseName = process.env.MONGODB_DB_NAME || 'medreminder';

  try {
    if (!mongoUri?.startsWith('mongodb+srv://')) {
      throw new Error('MONGODB_URI must be configured with a MongoDB Atlas mongodb+srv:// URI.');
    }

    const dnsServers = process.env.MONGODB_DNS_SERVERS?.split(',').map((server) => server.trim()).filter(Boolean);
    if (dnsServers?.length) {
      dns.setServers(dnsServers);
    }

    await mongoose.connect(mongoUri, {
      dbName: databaseName,
    });

    console.log(`MongoDB connected: ${mongoose.connection.host}/${mongoose.connection.name}`);
    return true;
  } catch (error) {
    console.error('MongoDB connection failed.');
    console.error('Check MONGODB_URI and make sure MongoDB/MongoDB Atlas is reachable.');
    console.error(error.message);
    return false;
  }
};

module.exports = connectDB;
