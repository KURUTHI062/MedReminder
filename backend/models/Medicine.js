const mongoose = require('mongoose');

const medicineSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    dosage: {
      type: String,
      default: '',
    },
    frequency: {
      type: String,
      default: '',
    },
    scheduledTimes: {
      type: [String],
      default: undefined,
    },
    scheduleDays: {
      type: [Number],
      default: [],
      validate: {
        validator: (days) => days.every((day) => Number.isInteger(day) && day >= 0 && day <= 6),
        message: 'Schedule days must be numbers from 0 (Sunday) to 6 (Saturday)',
      },
    },
    scheduleTime: {
      type: String,
      default: '',
    },
    time: {
      type: String,
      default: '',
    },
    startDate: {
      type: Date,
      default: null,
    },
    endDate: {
      type: Date,
      default: null,
    },
    quantity: {
      type: Number,
      default: 0,
      min: 0,
    },
    remainingQuantity: {
      type: Number,
      default: 0,
      min: 0,
    },
    instructions: {
      type: String,
      default: '',
    },
    active: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

medicineSchema.pre('save', function normaliseMedicine(next) {
  if (this.frequency === 'Weekly' && !this.scheduleDays?.length) {
    return next(new Error('Select at least one day for a weekly medicine schedule'));
  }
  if (this.frequency !== 'Weekly') {
    this.scheduleDays = [];
  }

  if (!this.scheduledTimes?.length) {
    this.scheduledTimes = [this.scheduleTime || this.time || '08:00'];
  }

  this.scheduledTimes = [...new Set(this.scheduledTimes.filter((time) => /^([01]\d|2[0-3]):[0-5]\d$/.test(time)))].sort();

  if (this.scheduledTimes.length) {
    this.scheduleTime = this.scheduledTimes[0];
    this.time = this.scheduledTimes[0];
  }

  if (!this.scheduleTime && this.time) {
    this.scheduleTime = this.time;
  }

  if (!this.time && this.scheduleTime) {
    this.time = this.scheduleTime;
  }

  if (this.quantity !== undefined && this.remainingQuantity === undefined) {
    this.remainingQuantity = this.quantity;
  }

  if (this.remainingQuantity === undefined || this.remainingQuantity === null) {
    this.remainingQuantity = 0;
  }

  next();
});

module.exports = mongoose.model('Medicine', medicineSchema);
