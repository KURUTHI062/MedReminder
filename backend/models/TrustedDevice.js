const mongoose = require('mongoose');

const trustedDeviceSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    deviceTokenHash: {
      type: String,
      trim: true,
      index: { unique: true, sparse: true },
    },
    deviceName: {
      type: String,
      default: 'Trusted device',
      trim: true,
    },
    userAgent: {
      type: String,
      default: '',
      trim: true,
    },
    ipAddress: {
      type: String,
      default: '',
      trim: true,
    },
    revokedAt: {
      type: Date,
      default: null,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expires: 0 },
    },
    lastSeenAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('TrustedDevice', trustedDeviceSchema);
