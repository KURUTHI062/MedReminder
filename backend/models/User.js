const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    role: {
      type: String,
      enum: ['caregiver', 'senior'],
      default: 'caregiver',
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: true,
      minlength: 6,
    },
    dateOfBirth: {
      type: Date,
      default: null,
    },
    phone: {
      type: String,
      default: '',
      trim: true,
    },
    timezoneOffset: {
      type: Number,
      default: null,
      min: -840,
      max: 840,
    },
    caregiverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    caregiverName: {
      type: String,
      default: '',
      trim: true,
    },
    caregiverPhone: {
      type: String,
      default: '',
      trim: true,
    },
    caregiverEmail: {
      type: String,
      default: '',
      trim: true,
      lowercase: true,
    },
    pinHash: {
      type: String,
      default: '',
      select: false,
    },
    pinFailedAttempts: {
      type: Number,
      default: 0,
    },
    pinLockedUntil: {
      type: Date,
      default: null,
    },
    tokenVersion: {
      type: Number,
      default: 0,
      min: 0,
    },
    seniorModeEnabled: {
      type: Boolean,
      default: false,
    },
    alarmEnabled: {
      type: Boolean,
      default: true,
    },
    notificationEnabled: {
      type: Boolean,
      default: true,
    },
    voiceEnabled: {
      type: Boolean,
      default: false,
    },
    trustedDevices: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'TrustedDevice' }],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

userSchema.pre('save', async function hashPassword(next) {
  if (!this.isModified('password')) {
    return next();
  }

  this.password = await bcrypt.hash(this.password, 10);
  next();
});

userSchema.methods.matchPassword = async function matchPassword(enteredPassword) {
  return bcrypt.compare(enteredPassword, this.password);
};

userSchema.methods.setPin = async function setPin(pin) {
  if (!/^[0-9]{4,6}$/.test(String(pin))) {
    throw new Error('PIN must be 4 to 6 digits');
  }

  this.pinHash = await bcrypt.hash(String(pin), 10);
  this.pinFailedAttempts = 0;
  this.pinLockedUntil = null;
  return this;
};

userSchema.methods.matchPin = async function matchPin(pin) {
  if (!this.pinHash) {
    return false;
  }

  return bcrypt.compare(String(pin), this.pinHash);
};

module.exports = mongoose.model('User', userSchema);
