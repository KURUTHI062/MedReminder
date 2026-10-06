const mongoose = require('mongoose');

const reminderDeliverySchema = new mongoose.Schema(
  {
    reminderId: { type: String, required: true, unique: true },
    doseKey: { type: String, required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    medicine: { type: mongoose.Schema.Types.ObjectId, ref: 'Medicine', required: true },
    scheduledDate: { type: String, required: true },
    scheduledTime: { type: String, required: true },
    notificationType: { type: String, enum: ['DOSE_DUE', 'SNOOZE', 'CAREGIVER_MISSED'], required: true },
    status: { type: String, enum: ['SENDING', 'SENT', 'NO_SUBSCRIPTIONS', 'FAILED'], default: 'SENDING' },
    attemptCount: { type: Number, default: 0, min: 0 },
    retryAt: { type: Date, default: null },
    sentAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('ReminderDelivery', reminderDeliverySchema);
