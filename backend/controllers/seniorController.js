const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const TrustedDevice = require('../models/TrustedDevice');
const Medicine = require('../models/Medicine');
const History = require('../models/History');

const generateToken = (user, trustedDeviceId) => jwt.sign({
  id: user._id,
  tokenVersion: user.tokenVersion || 0,
  ...(trustedDeviceId ? { trustedDeviceId } : {}),
}, process.env.JWT_SECRET || 'medreminder-secret', {
  expiresIn: process.env.JWT_EXPIRES_IN || '7d',
});

const normalizePin = (pin) => typeof pin === 'string' && /^[0-9]{4,6}$/.test(pin) ? pin : '';

const getLockoutError = () => ({
  status: 403,
  message: 'Too many incorrect attempts. Please ask your caregiver for help.',
});

const createTrustedDevice = async ({ user, deviceName, userAgent, ipAddress }) => {
  const token = crypto.randomBytes(32).toString('hex');
  const record = await TrustedDevice.create({
    user: user._id,
    deviceTokenHash: crypto.createHash('sha256').update(token).digest('hex'),
    deviceName: deviceName || 'Trusted device',
    userAgent: userAgent || '',
    ipAddress: ipAddress || '',
    lastSeenAt: new Date(),
    expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
  });

  if (user.trustedDevices && !user.trustedDevices.includes(record._id)) {
    user.trustedDevices.push(record._id);
    await user.save({ validateBeforeSave: false });
  }

  return { token, deviceId: record._id };
};

exports.loginSeniorPin = async (req, res) => {
  const pin = normalizePin(req.body.pin);
  const deviceName = String(req.body.deviceName || 'This device').trim();

  if (!pin || pin.length < 4 || pin.length > 6) {
    return res.status(400).json({ message: 'PIN must be 4 to 6 digits.' });
  }

  try {
    const user = await User.findOne({ role: 'senior', email: String(req.body.email || '').trim().toLowerCase() || null }).select('+pinHash');

    if (!user) {
      return res.status(401).json({ message: 'Invalid email or PIN.' });
    }

    if (user.pinLockedUntil && new Date(user.pinLockedUntil) > new Date()) {
      return res.status(403).json(getLockoutError());
    }

    const matches = await user.matchPin(pin);

    if (!matches) {
      const failedUser = await User.findByIdAndUpdate(
        user._id,
        { $inc: { pinFailedAttempts: 1 } },
        { new: true, select: 'pinFailedAttempts' }
      );
      if (failedUser.pinFailedAttempts >= 5) {
        await User.updateOne(
          { _id: user._id },
          { $set: { pinLockedUntil: new Date(Date.now() + 15 * 60 * 1000) } }
        );
      }
      return res.status(401).json({ message: 'Invalid email or PIN.' });
    }

    user.pinFailedAttempts = 0;
    user.pinLockedUntil = null;
    await user.save({ validateBeforeSave: false });

    const trustDevice = req.body.trustDevice === true || req.body.trustDevice === 'true';
    let trustedDevice = null;
    if (trustDevice) {
      trustedDevice = await createTrustedDevice({
        user,
        deviceName,
        userAgent: req.headers['user-agent'] || '',
        ipAddress: req.ip || '',
      });
    }

    const token = generateToken(user, trustedDevice?.deviceId);
    if (trustedDevice) {
      res.cookie('medreminder_trusted_device', trustedDevice.token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 365 * 24 * 60 * 60 * 1000,
        path: '/api/auth/senior-pin',
      });
    }
    return res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        seniorModeEnabled: user.seniorModeEnabled,
      },
      trustDevice,
    });
  } catch (error) {
    console.error('Senior PIN login failed:', error);
    return res.status(500).json({ message: error.message || 'Unable to complete senior login.' });
  }
};

exports.loginTrustedDevice = async (req, res) => {
  const cookieHeader = String(req.headers.cookie || '');
  const rawToken = cookieHeader.split(';')
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith('medreminder_trusted_device='))
    ?.slice('medreminder_trusted_device='.length);
  if (!rawToken) return res.status(401).json({ message: 'Trusted device is not available.' });

  try {
    const deviceTokenHash = crypto.createHash('sha256').update(decodeURIComponent(rawToken)).digest('hex');
    const device = await TrustedDevice.findOne({ deviceTokenHash, revokedAt: null, expiresAt: { $gt: new Date() } });
    if (!device) return res.status(401).json({ message: 'Trusted device has been revoked.' });
    const user = await User.findOne({ _id: device.user, role: 'senior' }).select('-password -pinHash');
    if (!user) return res.status(401).json({ message: 'Senior profile not found.' });
    device.lastSeenAt = new Date();
    await device.save();
    return res.json({
      token: generateToken(user, device._id),
      user: { id: user._id, name: user.name, email: user.email, role: user.role, seniorModeEnabled: user.seniorModeEnabled },
    });
  } catch (error) {
    console.error('Trusted device login failed:', error);
    return res.status(500).json({ message: 'Unable to verify this device.' });
  }
};

exports.listTrustedDevices = async (req, res) => {
  try {
    const seniorId = req.params.seniorId || req.user._id;
    const authorized = seniorId === String(req.user._id)
      ? true
      : await User.exists({ _id: seniorId, caregiverId: req.user._id, role: 'senior' });
    if (!authorized) {
      return res.status(404).json({ message: 'Senior profile not found.' });
    }
    const devices = await TrustedDevice.find({ user: seniorId, revokedAt: null })
      .sort({ lastSeenAt: -1 })
      .select('deviceName lastSeenAt createdAt');
    return res.json({ devices });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Unable to load trusted devices.' });
  }
};

exports.revokeTrustedDevice = async (req, res) => {
  try {
    const seniorId = req.params.seniorId || req.user._id;
    const authorized = seniorId === String(req.user._id)
      ? true
      : await User.exists({ _id: seniorId, caregiverId: req.user._id, role: 'senior' });
    if (!authorized) {
      return res.status(404).json({ message: 'Senior profile not found.' });
    }
    const device = await TrustedDevice.findOne({ _id: req.params.deviceId, user: seniorId });
    if (!device) {
      return res.status(404).json({ message: 'Trusted device not found.' });
    }

    device.revokedAt = new Date();
    await device.save();
    return res.json({ success: true, message: 'Trusted device revoked.' });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Unable to revoke device.' });
  }
};

const requireCaregiver = (req, res) => {
  if (req.user.role !== 'caregiver') {
    res.status(403).json({ message: 'Caregiver access is required.' });
    return false;
  }
  return true;
};

exports.createSeniorProfile = async (req, res) => {
  if (!requireCaregiver(req, res)) return;
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const pin = String(req.body.pin || '');
  if (!name || !email || !/^[0-9]{4,6}$/.test(pin)) {
    return res.status(400).json({ message: 'Name, email, and a 4–6 digit PIN are required.' });
  }
  try {
    if (await User.exists({ email })) {
      return res.status(409).json({ message: 'An account with this email already exists.' });
    }
    const senior = new User({
      name,
      email,
      password: crypto.randomBytes(32).toString('hex'),
      role: 'senior',
      caregiverId: req.user._id,
      caregiverName: req.user.name,
      caregiverPhone: req.user.phone || '',
      caregiverEmail: req.user.email,
      timezoneOffset: req.user.timezoneOffset,
      phone: String(req.body.phone || '').trim(),
      seniorModeEnabled: true,
    });
    await senior.setPin(pin);
    await senior.save();
    return res.status(201).json({
      success: true,
      senior: { id: senior._id, name: senior.name, email: senior.email, role: senior.role },
    });
  } catch (error) {
    console.error('Senior profile creation failed:', error);
    return res.status(500).json({ message: 'Unable to create senior profile.' });
  }
};

exports.listSeniorProfiles = async (req, res) => {
  if (!requireCaregiver(req, res)) return;
  try {
    const seniors = await User.find({ caregiverId: req.user._id, role: 'senior' })
      .select('name email phone seniorModeEnabled createdAt');
    return res.json({ seniors });
  } catch (error) {
    console.error('Senior profile lookup failed:', error);
    return res.status(500).json({ message: 'Unable to load senior profiles.' });
  }
};

exports.resetSeniorPin = async (req, res) => {
  if (!requireCaregiver(req, res)) return;
  if (!/^[0-9]{4,6}$/.test(String(req.body.pin || ''))) {
    return res.status(400).json({ message: 'PIN must be 4 to 6 digits.' });
  }
  try {
    const senior = await User.findOne({ _id: req.params.seniorId, caregiverId: req.user._id, role: 'senior' });
    if (!senior) return res.status(404).json({ message: 'Senior profile not found.' });
    await senior.setPin(req.body.pin);
    senior.tokenVersion = (senior.tokenVersion || 0) + 1;
    await senior.save({ validateBeforeSave: false });
    await TrustedDevice.updateMany({ user: senior._id, revokedAt: null }, { $set: { revokedAt: new Date() } });
    return res.json({ success: true, message: 'PIN reset. All senior sessions and trusted devices were signed out.' });
  } catch (error) {
    console.error('Senior PIN reset failed:', error);
    return res.status(500).json({ message: 'Unable to reset the PIN.' });
  }
};

exports.getSeniorDashboard = async (req, res) => {
  if (!requireCaregiver(req, res)) return;
  try {
    const senior = await User.findOne({ _id: req.params.seniorId, caregiverId: req.user._id, role: 'senior' })
      .select('name email phone seniorModeEnabled');
    if (!senior) return res.status(404).json({ message: 'Senior profile not found.' });

    const now = new Date();
    const timezoneOffset = Number(req.headers['x-timezone-offset']);
    const clientNow = Number.isFinite(timezoneOffset) && Math.abs(timezoneOffset) <= 840
      ? new Date(now.getTime() - timezoneOffset * 60000)
      : now;
    const today = clientNow.toISOString().slice(0, 10);
    const medicines = await Medicine.find({ user: senior._id, active: { $ne: false } }).sort({ createdAt: -1 });
    for (const medicine of medicines) {
      const startDate = medicine.startDate?.toISOString().slice(0, 10) || '';
      const endDate = medicine.endDate?.toISOString().slice(0, 10) || '';
      if ((startDate && today < startDate) || (endDate && today > endDate)) continue;
      if (medicine.scheduleDays?.length && !medicine.scheduleDays.includes(clientNow.getUTCDay())) continue;
      const times = Array.isArray(medicine.scheduledTimes) && medicine.scheduledTimes.length
        ? medicine.scheduledTimes
        : [medicine.scheduleTime || medicine.time || '08:00'];
      for (const scheduledTime of times) {
        const [year, month, day] = today.split('-').map(Number);
        const doseDate = new Date(Date.UTC(year, month - 1, day));
        await History.updateOne(
          { user: senior._id, medicine: medicine._id, scheduledDate: today, scheduledTime },
          {
            $setOnInsert: {
              medicineName: medicine.name,
              dosage: medicine.dosage,
              scheduledDate: today,
              scheduledTime,
              doseKey: `${senior._id}_${medicine._id}_${today}_${scheduledTime}`,
              doseDate,
              status: 'PENDING',
            },
          },
          { upsert: true }
        );
      }
    }
    const doses = await History.find({ user: senior._id }).sort({ doseDate: -1, scheduledTime: 1 }).limit(100);
    const todayDoses = doses.filter((dose) => dose.scheduledDate === today);
    const resolved = todayDoses.filter((dose) => ['TAKEN', 'SKIPPED', 'MISSED'].includes(dose.status));
    const taken = todayDoses.filter((dose) => dose.status === 'TAKEN').length;
    const missed = todayDoses.filter((dose) => dose.status === 'MISSED').length;
    return res.json({
      senior,
      medicines,
      doses: todayDoses,
      history: doses,
      adherence: resolved.length ? Math.round((taken / resolved.length) * 100) : 0,
      counts: {
        taken,
        skipped: todayDoses.filter((dose) => dose.status === 'SKIPPED').length,
        missed,
        upcoming: todayDoses.filter((dose) => dose.status === 'PENDING').length,
      },
      lowStock: medicines.filter((medicine) => Number(medicine.quantity) > 0 && Number(medicine.remainingQuantity) <= 5),
    });
  } catch (error) {
    console.error('Caregiver dashboard lookup failed:', error);
    return res.status(500).json({ message: 'Unable to load the caregiver dashboard.' });
  }
};

exports.getSeniorAlerts = async (req, res) => {
  if (!requireCaregiver(req, res)) return;
  try {
    const senior = await User.exists({ _id: req.params.seniorId, caregiverId: req.user._id, role: 'senior' });
    if (!senior) return res.status(404).json({ message: 'Senior profile not found.' });
    const alerts = await History.find({
      user: req.params.seniorId,
      status: 'MISSED',
    }).sort({ actionTime: -1 }).limit(50).select('medicineName dosage scheduledDate scheduledTime actionTime status');
    return res.json({ alerts });
  } catch (error) {
    console.error('Caregiver alerts lookup failed:', error);
    return res.status(500).json({ message: 'Unable to load caregiver alerts.' });
  }
};

exports.overrideDoseStatus = async (req, res) => {
  if (!requireCaregiver(req, res)) return;
  const { newStatus, reason } = req.body || {};
  const validStatuses = ['TAKEN', 'SKIPPED', 'MISSED'];
  if (!validStatuses.includes(newStatus) || !String(reason || '').trim()) {
    return res.status(400).json({ message: 'Choose a resolved status and enter a reason for the correction.' });
  }
  try {
    const dose = await History.findOne({ _id: req.params.doseId, user: req.params.seniorId });
    if (!dose) return res.status(404).json({ message: 'Dose history not found.' });
    const senior = await User.exists({ _id: req.params.seniorId, caregiverId: req.user._id, role: 'senior' });
    if (!senior) return res.status(404).json({ message: 'Senior profile not found.' });
    if (dose.status === 'PENDING' || dose.status === 'SNOOZED') {
      return res.status(409).json({ message: 'Caregiver correction is only for an already resolved dose.' });
    }

    const oldStatus = dose.status;
    const changedAt = new Date();
    const update = await History.updateOne(
      { _id: dose._id, status: oldStatus },
      {
        $set: { status: newStatus, actionTime: changedAt, takenAt: newStatus === 'TAKEN' ? changedAt : null },
        $push: {
          audit: {
            changedBy: req.user._id,
            changedAt,
            oldStatus,
            newStatus,
            reason: String(reason).trim().slice(0, 500),
          },
        },
      }
    );
    if (!update.modifiedCount) return res.status(409).json({ message: 'Dose status changed concurrently. Refresh and try again.' });

    if (oldStatus !== newStatus && (oldStatus === 'TAKEN' || newStatus === 'TAKEN')) {
      const quantityChange = newStatus === 'TAKEN' ? -1 : 1;
      const medicine = await Medicine.findOne({ _id: dose.medicine, user: req.params.seniorId });
      if (medicine) {
        if (quantityChange < 0) {
          await Medicine.updateOne({ _id: medicine._id, remainingQuantity: { $gt: 0 } }, { $inc: { remainingQuantity: -1 } });
        } else {
          await Medicine.updateOne(
            { _id: medicine._id, $expr: { $lt: ['$remainingQuantity', '$quantity'] } },
            { $inc: { remainingQuantity: 1 } }
          );
        }
      }
    }

    const correctedDose = await History.findById(dose._id);
    return res.json({ success: true, history: correctedDose });
  } catch (error) {
    console.error('Caregiver dose correction failed:', error);
    return res.status(500).json({ message: 'Unable to correct this dose status.' });
  }
};

exports.getSeniorReport = async (req, res) => {
  if (!requireCaregiver(req, res)) return;
  const period = req.query.period || 'today';
  const durationDays = { today: 1, week: 7, month: 30 }[period];
  if (!durationDays) return res.status(400).json({ message: 'Period must be today, week, or month.' });
  try {
    const senior = await User.exists({ _id: req.params.seniorId, caregiverId: req.user._id, role: 'senior' });
    if (!senior) return res.status(404).json({ message: 'Senior profile not found.' });
    const now = new Date();
    const timezoneOffset = Number(req.headers['x-timezone-offset']);
    const clientNow = Number.isFinite(timezoneOffset) && Math.abs(timezoneOffset) <= 840
      ? new Date(now.getTime() - timezoneOffset * 60000)
      : now;
    const end = clientNow.toISOString().slice(0, 10);
    const start = new Date(clientNow.getTime() - (durationDays - 1) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const doses = await History.find({
      user: req.params.seniorId,
      scheduledDate: { $gte: start, $lte: end },
      status: { $in: ['TAKEN', 'SKIPPED', 'MISSED'] },
    }).select('status').lean();
    const counts = {
      taken: doses.filter((dose) => dose.status === 'TAKEN').length,
      skipped: doses.filter((dose) => dose.status === 'SKIPPED').length,
      missed: doses.filter((dose) => dose.status === 'MISSED').length,
    };
    const resolved = doses.length;
    return res.json({
      period,
      startDate: start,
      endDate: end,
      counts,
      resolved,
      adherence: resolved ? Math.round((counts.taken / resolved) * 100) : 0,
    });
  } catch (error) {
    console.error('Caregiver report generation failed:', error);
    return res.status(500).json({ message: 'Unable to generate this report.' });
  }
};
