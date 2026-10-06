const Medicine = require('../models/Medicine');
const History = require('../models/History');

const getMedicineTimes = (medicine) => {
  const times = Array.isArray(medicine.scheduledTimes) && medicine.scheduledTimes.length
    ? medicine.scheduledTimes
    : [medicine.scheduleTime || medicine.time || '08:00'];
  return [...new Set(times)].sort();
};

const getLocalDateKey = (date = new Date()) => [
  date.getFullYear(),
  String(date.getMonth() + 1).padStart(2, '0'),
  String(date.getDate()).padStart(2, '0'),
].join('-');

const getClientDateKey = (date) => [
  date.getUTCFullYear(),
  String(date.getUTCMonth() + 1).padStart(2, '0'),
  String(date.getUTCDate()).padStart(2, '0'),
].join('-');

const getTimezoneOffset = (value, fallback) => {
  const offset = Number(value);
  if (Number.isFinite(offset) && Math.abs(offset) <= 840) return offset;
  return Number.isFinite(fallback) && Math.abs(fallback) <= 840 ? fallback : 0;
};

const getScheduledDateTime = (scheduledDate, scheduledTime, timezoneOffset) => {
  const [year, month, day] = scheduledDate.split('-').map(Number);
  const [hours, minutes] = scheduledTime.split(':').map(Number);
  return new Date(Date.UTC(year, month - 1, day, hours, minutes) + timezoneOffset * 60000);
};

const getMissedGraceMinutes = () => {
  const minutes = Number(process.env.MISSED_GRACE_MINUTES || 30);
  return Number.isFinite(minutes) && minutes >= 0 ? minutes : 30;
};

const getDoseDetails = (medicine, currentDate, requestedTime, requestedDate) => {
  const scheduledTime = requestedTime || getMedicineTimes(medicine)[0];
  const scheduledDate = requestedDate || [
    currentDate.getFullYear(),
    String(currentDate.getMonth() + 1).padStart(2, '0'),
    String(currentDate.getDate()).padStart(2, '0'),
  ].join('-');

  if (!getMedicineTimes(medicine).includes(scheduledTime)) {
    throw new Error('Scheduled time is not part of this medicine schedule');
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate)) {
    throw new Error('Scheduled date must use YYYY-MM-DD format');
  }

  const [year, month, day] = scheduledDate.split('-').map(Number);
  const doseDate = new Date(Date.UTC(year, month - 1, day));
  if (doseDate.toISOString().slice(0, 10) !== scheduledDate) {
    throw new Error('Scheduled date is invalid');
  }

  return {
    scheduledTime,
    scheduledDate,
    doseDate,
    legacyDoseDate: new Date(year, month - 1, day),
  };
};

exports.getMedicines = async (req, res) => {
  try {
    const medicines = await Medicine.find({ user: req.user._id }).sort({ createdAt: -1 });
    return res.json({ success: true, medicines });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Unable to retrieve medicines' });
  }
};

exports.createMedicine = async (req, res) => {
  const {
    name,
    dosage,
    frequency,
    scheduledTimes,
    scheduleDays,
    scheduleTime,
    time,
    startDate,
    endDate,
    quantity,
    instructions,
    active,
  } = req.body;

  if (!name || !String(name).trim()) {
    return res.status(400).json({ message: 'Medicine name is required' });
  }

  try {
    const times = Array.isArray(scheduledTimes) && scheduledTimes.length
      ? scheduledTimes
      : [scheduleTime || time || '08:00'];
    if (times.some((value) => typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value))) {
      return res.status(400).json({ message: 'Scheduled times must use 24-hour HH:mm format' });
    }
    if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
      return res.status(400).json({ message: 'End date must be on or after the start date' });
    }
    const medicine = await Medicine.create({
      user: req.user._id,
      name: String(name).trim(),
      dosage: dosage || '',
      frequency: frequency || '',
      scheduledTimes: times,
      scheduleDays: Array.isArray(scheduleDays) ? scheduleDays : [],
      scheduleTime: times[0],
      time: times[0],
      startDate: startDate || null,
      endDate: endDate || null,
      quantity: Number(quantity || 0),
      remainingQuantity: Number(quantity || 0),
      instructions: instructions || '',
      active: active !== false,
    });

    return res.status(201).json({ success: true, medicine });
  } catch (error) {
    const status = error.name === 'ValidationError' ? 400 : 500;
    return res.status(status).json({ message: error.message });
  }
};

exports.updateMedicine = async (req, res) => {
  try {
    const medicine = await Medicine.findOne({ _id: req.params.id, user: req.user._id });

    if (!medicine) {
      return res.status(404).json({ message: 'Medicine not found' });
    }

    const allowedFields = [
      'name',
      'dosage',
      'frequency',
      'scheduledTimes',
      'scheduleDays',
      'scheduleTime',
      'time',
      'startDate',
      'endDate',
      'quantity',
      'remainingQuantity',
      'instructions',
      'active',
    ];

    allowedFields.forEach((field) => {
      if (req.body[field] !== undefined) {
        medicine[field] = req.body[field];
      }
    });

    if (Array.isArray(req.body.scheduledTimes) && req.body.scheduledTimes.length) {
      medicine.scheduledTimes = req.body.scheduledTimes;
      medicine.scheduleTime = req.body.scheduledTimes[0];
      medicine.time = req.body.scheduledTimes[0];
    } else if (req.body.scheduleTime || req.body.time) {
      const legacyTime = req.body.scheduleTime || req.body.time;
      medicine.scheduledTimes = [legacyTime];
      medicine.scheduleTime = legacyTime;
      medicine.time = legacyTime;
    }

    if (medicine.startDate && medicine.endDate && medicine.startDate > medicine.endDate) {
      return res.status(400).json({ message: 'End date must be on or after the start date' });
    }

    const times = getMedicineTimes(medicine);
    if (!times.length || times.some((value) => typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value))) {
      return res.status(400).json({ message: 'Scheduled times must use 24-hour HH:mm format' });
    }

    if (medicine.quantity !== undefined && medicine.remainingQuantity === undefined) {
      medicine.remainingQuantity = medicine.quantity;
    }

    await medicine.save();

    const timezoneOffset = Number(req.headers['x-timezone-offset']);
    const now = new Date();
    const clientNow = Number.isFinite(timezoneOffset) && Math.abs(timezoneOffset) <= 840
      ? new Date(now.getTime() - timezoneOffset * 60000)
      : now;
    const today = getClientDateKey(clientNow);
    const [year, month, day] = today.split('-').map(Number);
    const tomorrow = getClientDateKey(new Date(Date.UTC(year, month - 1, day + 1)));
    const scheduledTimes = getMedicineTimes(medicine);
    const startDate = medicine.startDate?.toISOString().slice(0, 10);
    const endDate = medicine.endDate?.toISOString().slice(0, 10);
    for (const scheduledDate of [today, tomorrow]) {
      const dateInRange = (!startDate || scheduledDate >= startDate) && (!endDate || scheduledDate <= endDate);
      const scheduledThatDate = medicine.active !== false && dateInRange;
      await History.deleteMany({
        user: req.user._id,
        medicine: medicine._id,
        scheduledDate,
        status: 'PENDING',
        ...(scheduledThatDate ? { scheduledTime: { $nin: scheduledTimes } } : {}),
      });
      if (!scheduledThatDate) {
        await History.deleteMany({ user: req.user._id, medicine: medicine._id, scheduledDate, status: 'PENDING' });
      }
    }

    return res.json({ success: true, medicine });
  } catch (error) {
    const status = error.name === 'ValidationError' ? 400 : 500;
    return res.status(status).json({ message: error.message });
  }
};

exports.deleteMedicine = async (req, res) => {
  try {
    const medicine = await Medicine.findOne({ _id: req.params.id, user: req.user._id });

    if (!medicine) {
      return res.status(404).json({ message: 'Medicine not found' });
    }

    // Clean up pending doses for the deleted medicine to avoid orphan pending records
    await History.deleteMany({ user: req.user._id, medicine: medicine._id, status: 'PENDING' });
    await medicine.deleteOne();

    return res.json({ success: true, message: 'Medicine deleted successfully' });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Unable to delete medicine' });
  }
};

exports.markMedicineStatus = async (req, res) => {
  const allowedStatuses = ['TAKEN', 'SKIPPED', 'MISSED'];
  const { status } = req.body;

  if (!allowedStatuses.includes(status)) {
    return res.status(400).json({ message: 'Status must be TAKEN, SKIPPED, or MISSED' });
  }

  try {
    const medicine = await Medicine.findOne({ _id: req.params.id, user: req.user._id });

    if (!medicine) {
      return res.status(404).json({ message: 'Medicine not found' });
    }

    const now = new Date();
    const requestedDate = req.body.scheduledDate || getLocalDateKey(now);
    const timezoneOffset = getTimezoneOffset(req.body.timezoneOffset, req.user.timezoneOffset);
    const clientNow = new Date(now.getTime() - timezoneOffset * 60000);
    if (requestedDate !== getClientDateKey(clientNow)) {
      return res.status(400).json({ message: 'Dose status can only be updated for today' });
    }

    let doseDetails;
    try {
      doseDetails = getDoseDetails(medicine, now, req.body.scheduledTime, requestedDate);
    } catch (validationError) {
      console.error('Invalid dose update:', validationError.message);
      return res.status(400).json({ message: validationError.message });
    }
    const { scheduledTime, scheduledDate, doseDate, legacyDoseDate } = doseDetails;
    const scheduledDateTime = getScheduledDateTime(scheduledDate, scheduledTime, timezoneOffset);

    // Only MISSED requires grace period to have passed; TAKEN and SKIPPED are allowed for today's scheduled doses
    if (status === 'MISSED' && now < scheduledDateTime.getTime() + getMissedGraceMinutes() * 60000) {
      return res.status(400).json({ message: 'This dose cannot be marked missed until its grace period has ended.' });
    }

    const historyKey = {
      user: req.user._id,
      medicine: medicine._id,
      scheduledTime,
    };
    const doseKey = `${req.user._id}_${medicine._id}_${scheduledDate}_${scheduledTime}`;
    const existingHistory = await History.findOne({ ...historyKey, scheduledDate })
      || await History.findOne({ ...historyKey, doseDate: legacyDoseDate });

    const previousStatus = existingHistory ? existingHistory.status : null;

    const unresolvedSnooze = previousStatus === 'SNOOZED'
      && (!existingHistory.snoozeUntil || existingHistory.snoozeUntil <= now);
    if (existingHistory && previousStatus !== 'PENDING' && !unresolvedSnooze) {
      if (previousStatus === status) {
        return res.json({
          success: true,
          message: `This dose has already been marked as ${status.toLowerCase()}`,
          medicine,
          history: existingHistory,
        });
      }

      return res.status(409).json({
        message: 'This dose has already been resolved and cannot be changed without a caregiver override.',
      });
    }

    const updateFields = {
      status,
      medicineName: medicine.name,
      dosage: medicine.dosage,
      scheduledTime,
      scheduledDate,
      doseKey,
      doseDate,
      actionTime: now,
      takenAt: status === 'TAKEN' ? now : null,
    };

    let updatedHistory;
    if (existingHistory) {
      updatedHistory = await History.findOneAndUpdate(
        {
          _id: existingHistory._id,
          $or: [
            { status: 'PENDING' },
            { status: 'SNOOZED' },
          ],
        },
        { $set: updateFields },
        { new: true }
      );
      if (!updatedHistory) {
        return res.status(409).json({ message: 'This dose has already been resolved.' });
      }
    } else {
      try {
        updatedHistory = await History.create({
          ...historyKey,
          ...updateFields,
          doseDate,
        });
      } catch (error) {
        if (error.code === 11000) {
          return res.status(409).json({ message: 'This dose has already been resolved.' });
        }
        throw error;
      }
    }

    let responseMedicine = medicine;
    if (status === 'TAKEN' && Number(medicine.remainingQuantity || 0) > 0) {
      await Medicine.updateOne(
        { _id: medicine._id, user: req.user._id, remainingQuantity: { $gt: 0 } },
        { $inc: { remainingQuantity: -1 } }
      );
      responseMedicine = await Medicine.findById(medicine._id);
    }

    return res.json({
      success: true,
      message: `Medicine marked as ${status.toLowerCase()}`,
      medicine: responseMedicine,
      history: updatedHistory,
    });
  } catch (error) {
    console.error('Medicine status update failed:', error);
    return res.status(500).json({ message: error.message || 'Unable to update dose status' });
  }
};

exports.snoozeMedicineDose = async (req, res) => {
  const minutes = Number(req.body.minutes);
  if (![5, 10, 15].includes(minutes)) {
    return res.status(400).json({ message: 'Snooze duration must be 5, 10, or 15 minutes.' });
  }

  try {
    const medicine = await Medicine.findOne({ _id: req.params.id, user: req.user._id });
    if (!medicine) return res.status(404).json({ message: 'Medicine not found.' });
    const now = new Date();
    const requestedDate = req.body.scheduledDate || getLocalDateKey(now);
    const timezoneOffset = getTimezoneOffset(req.body.timezoneOffset, req.user.timezoneOffset);
    const clientNow = new Date(now.getTime() - timezoneOffset * 60000);
    if (requestedDate !== getClientDateKey(clientNow)) {
      return res.status(400).json({ message: 'Only today’s dose can be snoozed.' });
    }

    const { scheduledTime, scheduledDate, doseDate, legacyDoseDate } = getDoseDetails(
      medicine,
      now,
      req.body.scheduledTime,
      requestedDate
    );

    let history = await History.findOne({ user: req.user._id, medicine: medicine._id, scheduledDate, scheduledTime })
      || await History.findOne({ user: req.user._id, medicine: medicine._id, scheduledTime, doseDate: legacyDoseDate });
    if (!history) {
      try {
        history = await History.create({
          user: req.user._id,
          medicine: medicine._id,
          medicineName: medicine.name,
          dosage: medicine.dosage,
          scheduledTime,
          scheduledDate,
          doseKey: `${req.user._id}_${medicine._id}_${scheduledDate}_${scheduledTime}`,
          doseDate,
          status: 'PENDING',
        });
      } catch (error) {
        if (error.code !== 11000) throw error;
        history = await History.findOne({ user: req.user._id, medicine: medicine._id, scheduledDate, scheduledTime });
      }
    }
    if (!history || !['PENDING', 'SNOOZED'].includes(history.status)) {
      return res.status(409).json({ message: 'This dose has already been resolved.' });
    }
    if (Number(history.snoozeCount || 0) >= 3) {
      return res.status(409).json({ message: 'This dose has reached its snooze limit.' });
    }

    const snoozeUntil = new Date(now.getTime() + minutes * 60000);
    const updated = await History.findOneAndUpdate(
      {
        _id: history._id,
        status: { $in: ['PENDING', 'SNOOZED'] },
        $or: [{ snoozeCount: { $lt: 3 } }, { snoozeCount: { $exists: false } }],
      },
      { $set: { status: 'SNOOZED', snoozeUntil, actionTime: now }, $inc: { snoozeCount: 1 } },
      { new: true }
    );
    if (!updated) return res.status(409).json({ message: 'This dose can no longer be snoozed.' });
    return res.json({ success: true, history: updated, snoozeUntil });
  } catch (error) {
    console.error('Dose snooze failed:', error);
    return res.status(500).json({ message: 'Unable to snooze this dose.' });
  }
};
