const jwt = require('jsonwebtoken');
const User = require('../models/User');

const generateToken = (user) =>
  jwt.sign({ id: user._id, tokenVersion: user.tokenVersion || 0 }, process.env.JWT_SECRET || 'medreminder-secret', {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });

exports.registerUser = async (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ message: 'Name, email, and password are required' });
  }

  try {
    const normalizedEmail = email.toLowerCase();
    const existingUser = await User.findOne({ email: normalizedEmail });

    if (existingUser) {
      return res.status(400).json({ message: 'User already exists' });
    }

    const user = await User.create({
      name,
      email: normalizedEmail,
      password,
      role: 'caregiver',
    });

    return res.status(201).json({
      token: generateToken(user),
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        seniorModeEnabled: user.seniorModeEnabled,
      },
    });
  } catch (error) {
    console.error('Failed to update authenticated user profile:', error);
    return res.status(500).json({ message: error.message });
  }
};

exports.loginUser = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required' });
  }

  try {
    const normalizedEmail = email.toLowerCase();
    const user = await User.findOne({ email: normalizedEmail });

    if (!user || !(await user.matchPassword(password))) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    return res.json({
      token: generateToken(user),
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        seniorModeEnabled: user.seniorModeEnabled,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

exports.getMe = async (req, res) => {
  return res.json({
    user: {
      id: req.user._id,
      name: req.user.name,
      email: req.user.email,
      role: req.user.role,
      seniorModeEnabled: req.user.seniorModeEnabled,
      caregiverName: req.user.caregiverName || '',
      caregiverPhone: req.user.caregiverPhone || '',
      caregiverEmail: req.user.caregiverEmail || '',
    },
  });
};

exports.updateMe = async (req, res) => {
  const { caregiverName, caregiverPhone, caregiverEmail } = req.body || {};

  try {
    const updates = {};

    if (caregiverName !== undefined) {
      updates.caregiverName = String(caregiverName || '').trim();
    }

    if (caregiverPhone !== undefined) {
      updates.caregiverPhone = String(caregiverPhone || '').trim();
      if (req.user.role === 'caregiver') {
        updates.phone = updates.caregiverPhone;
      }
    }

    if (caregiverEmail !== undefined) {
      updates.caregiverEmail = String(caregiverEmail || '').trim().toLowerCase();
    }

    const user = await User.findByIdAndUpdate(req.user._id, updates, { new: true }).select('-password');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    if (user.role === 'caregiver') {
      await User.updateMany(
        { caregiverId: user._id, role: 'senior' },
        {
          $set: {
            caregiverName: user.name,
            caregiverPhone: user.phone || '',
            caregiverEmail: user.email,
          },
        }
      );
    }

    return res.json({
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        seniorModeEnabled: user.seniorModeEnabled,
        caregiverName: user.caregiverName || '',
        caregiverPhone: user.caregiverPhone || '',
        caregiverEmail: user.caregiverEmail || '',
      },
    });
  } catch (error) {
    console.error('Failed to update authenticated user profile:', error);
    return res.status(500).json({ message: error.message });
  }
};
