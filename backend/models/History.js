const mongoose = require('mongoose');

const historySchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    medicine: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Medicine',
      required: true,
      index: true,
    },
    medicineName: {
      type: String,
      default: '',
    },
    dosage: {
      type: String,
      default: '',
    },
    scheduledTime: {
      type: String,
      default: '',
    },
    scheduledDate: {
      type: String,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },
    doseKey: {
      type: String,
      trim: true,
    },
    doseDate: {
      type: Date,
      required: true,
    },
    actionTime: {
      type: Date,
      default: null,
    },
    snoozeUntil: {
      type: Date,
      default: null,
    },
    snoozeCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    audit: {
      type: [{
        changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        changedAt: { type: Date, required: true },
        oldStatus: { type: String, required: true },
        newStatus: { type: String, required: true },
        reason: { type: String, required: true, trim: true },
      }],
      default: [],
    },
    takenAt: {
      type: Date,
      default: null,
    },
    status: {
      type: String,
      enum: ['PENDING', 'TAKEN', 'SKIPPED', 'MISSED', 'SNOOZED'],
      default: 'PENDING',
    },
  },
  {
    timestamps: true,
  }
);

historySchema.index({ user: 1, medicine: 1, doseDate: 1, scheduledTime: 1 }, { unique: true });
historySchema.index(
  { user: 1, medicine: 1, scheduledDate: 1, scheduledTime: 1 },
  { unique: true, partialFilterExpression: { scheduledDate: { $type: 'string' } } }
);
historySchema.index({ doseKey: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('History', historySchema);
