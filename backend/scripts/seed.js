require('dotenv').config();
const connectDB = require('../config/db');
const User = require('../models/User');

const seedDemoUser = async () => {
  await connectDB();

  const email = 'demo@medreminder.local';
  const password = 'Demo@123456';

  const existingUser = await User.findOne({ email });

  if (existingUser) {
    console.log('Demo user already exists');
    return;
  }

  await User.create({
    name: 'Demo User',
    email,
    password,
  });

  console.log(`Demo user created: ${email} / ${password}`);
  process.exit(0);
};

seedDemoUser().catch((error) => {
  console.error(error);
  process.exit(1);
});
