const express = require('express');
const protect = require('../middleware/auth');
const patientScope = require('../middleware/patientScope');
const History = require('../models/History');
const Medicine = require('../models/Medicine');
const User = require('../models/User');

const router = express.Router();

const getClientDateKey = (date) => [
  date.getUTCFullYear(),
  String(date.getUTCMonth() + 1).padStart(2, '0'),
  String(date.getUTCDate()).padStart(2, '0'),
].join('-');

const getLegacyDateKey = (value, timezoneOffset) => {
  const offset = Number(timezoneOffset);
  const date = new Date(value);
  if (Number.isFinite(offset) && Math.abs(offset) <= 840) {
    date.setTime(date.getTime() - offset * 60000);
  }
  return getClientDateKey(date);
};

const getDateKey = (value) => {
  if (!value) return '';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  return new Date(value).toISOString().slice(0, 10);
};

const getScheduledTimes = (medicine) => {
  const times = Array.isArray(medicine.scheduledTimes) && medicine.scheduledTimes.length
    ? medicine.scheduledTimes
    : [medicine.scheduleTime || medicine.time || '08:00'];
  return [...new Set(times.filter((time) => /^([01]\d|2[0-3]):[0-5]\d$/.test(time)))].sort();
};

const ensureDailyDoses = async (userId, scheduledDate) => {
  const [year, month, day] = scheduledDate.split('-').map(Number);
  const doseDate = new Date(Date.UTC(year, month - 1, day));
  const legacyDoseDate = new Date(year, month - 1, day);
  const medicines = await Medicine.find({ user: userId, active: { $ne: false } });

  for (const medicine of medicines) {
    const startDate = getDateKey(medicine.startDate);
    const endDate = getDateKey(medicine.endDate);
    if ((startDate && scheduledDate < startDate) || (endDate && scheduledDate > endDate)) continue;
    if (medicine.scheduleDays?.length) {
      const [year, month, day] = scheduledDate.split('-').map(Number);
      if (!medicine.scheduleDays.includes(new Date(Date.UTC(year, month - 1, day)).getUTCDay())) continue;
    }

    for (const scheduledTime of getScheduledTimes(medicine)) {
      const doseKey = `${userId}_${medicine._id}_${scheduledDate}_${scheduledTime}`;
      let history = await History.findOne({ doseKey });

      if (!history) {
        history = await History.findOne({ user: userId, medicine: medicine._id, scheduledDate, scheduledTime });
      }
      if (!history) {
        history = await History.findOne({
          user: userId,
          medicine: medicine._id,
          scheduledTime,
          doseDate: legacyDoseDate,
          scheduledDate: { $exists: false },
        });
      }

      if (history) {
        let changed = false;
        if (!history.scheduledDate) { history.scheduledDate = scheduledDate; changed = true; }
        if (!history.doseKey) { history.doseKey = doseKey; changed = true; }
        if (!history.actionTime && history.status !== 'PENDING') {
          history.actionTime = history.takenAt || history.updatedAt || null;
          changed = true;
        }
        if (history.doseDate.getTime() !== doseDate.getTime()) { history.doseDate = doseDate; changed = true; }
        if (changed) await history.save();
        continue;
      }

      try {
        await History.create({
          user: userId,
          medicine: medicine._id,
          medicineName: medicine.name,
          dosage: medicine.dosage,
          scheduledDate,
          scheduledTime,
          doseKey,
          doseDate,
          status: 'PENDING',
        });
      } catch (error) {
        if (error.code !== 11000) throw error;
      }
    }
  }
};

router.get('/', protect, patientScope, async (req, res) => {
  try {
    const offset = Number(req.headers['x-timezone-offset']);
    if (Number.isFinite(offset) && Math.abs(offset) <= 840 && req.user.timezoneOffset !== offset) {
      await User.updateOne({ _id: req.user._id }, { $set: { timezoneOffset: offset } });
    }
    const now = new Date();
    const clientNow = Number.isFinite(offset) && Math.abs(offset) <= 840
      ? new Date(now.getTime() - offset * 60000)
      : now;
    const today = getClientDateKey(clientNow);
    const [year, month, day] = today.split('-').map(Number);
    const tomorrow = getClientDateKey(new Date(Date.UTC(year, month - 1, day + 1)));
    await ensureDailyDoses(req.user._id, today);
    await ensureDailyDoses(req.user._id, tomorrow);
    const history = await History.find({ user: req.user._id }).sort({ doseDate: -1, createdAt: -1 });
    const entries = history.map((entry) => {
      const data = entry.toObject();
      if (!data.scheduledDate) data.scheduledDate = getLegacyDateKey(data.doseDate, offset);
      return data;
    });
    return res.json({ success: true, history: entries });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

module.exports = router;
