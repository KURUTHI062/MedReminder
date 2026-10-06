const Medicine = require('../models/Medicine');
const History = require('../models/History');
const User = require('../models/User');
const ReminderDelivery = require('../models/ReminderDelivery');
const { sendPushToUser } = require('./pushService');

const configuredGraceMinutes = Number(process.env.MISSED_GRACE_MINUTES || 30);
const MISSED_GRACE_MINUTES = Number.isFinite(configuredGraceMinutes) && configuredGraceMinutes >= 0
  ? configuredGraceMinutes
  : 30;
const CHECK_INTERVAL_MS = 30000;
const PUSH_RETRY_DELAY_MS = 5 * 60 * 1000;
const MAX_PUSH_ATTEMPTS = 5;
let schedulerInterval = null;

const getReminderKey = (medicineId, scheduledDate, scheduledTime) => `${medicineId}:${scheduledDate}:${scheduledTime}`;

const createTime = (dateKey, time, timezoneOffset) => {
  const [year, month, day] = dateKey.split('-').map(Number);
  const [hours, minutes] = (time || '08:00').split(':').map(Number);
  return new Date(Date.UTC(year, month - 1, day, hours, minutes) + timezoneOffset * 60000);
};

const deliverPushOnce = async ({ reminderId, doseKey, medicine, scheduledDate, scheduledTime, notificationType }) => {
  const now = new Date();
  const retryAt = new Date(now.getTime() + PUSH_RETRY_DELAY_MS);
  try {
    await ReminderDelivery.create({
      reminderId,
      doseKey,
      user: medicine.user,
      medicine: medicine._id,
      scheduledDate,
      scheduledTime,
      notificationType,
      status: 'SENDING',
      attemptCount: 1,
      retryAt,
    });
  } catch (error) {
    if (error.code !== 11000) throw error;
    const claimedDelivery = await ReminderDelivery.findOneAndUpdate(
      {
        reminderId,
        status: { $in: ['SENDING', 'NO_SUBSCRIPTIONS', 'FAILED'] },
        $and: [
          { $or: [{ attemptCount: { $lt: MAX_PUSH_ATTEMPTS } }, { attemptCount: { $exists: false } }] },
          { $or: [{ retryAt: { $lte: now } }, { retryAt: null }, { retryAt: { $exists: false } }] },
        ],
      },
      { $set: { status: 'SENDING', retryAt }, $inc: { attemptCount: 1 } },
      { new: true }
    );
    if (!claimedDelivery) return;
  }

  let result;
  try {
    result = await sendPushToUser(medicine.user, {
      title: notificationType === 'CAREGIVER_MISSED' ? 'Missed medicine dose' : 'Medicine reminder',
      body: notificationType === 'CAREGIVER_MISSED'
        ? `${medicine.name} was missed at ${scheduledTime} on ${scheduledDate}.`
        : `${medicine.name}${medicine.dosage ? ` · ${medicine.dosage}` : ''} is scheduled for ${scheduledTime}.`,
      tag: reminderId,
      url: '/',
    });
  } catch (error) {
    await ReminderDelivery.updateOne(
      { reminderId, status: 'SENDING' },
      {
        $set: {
          status: 'FAILED',
          retryAt: new Date(Date.now() + PUSH_RETRY_DELAY_MS),
        },
      }
    );
    console.error('Reminder push dispatch failed:', error);
    return;
  }

  const deliveryStatus = result.sent ? 'SENT' : result.configured ? 'NO_SUBSCRIPTIONS' : 'FAILED';
  const canRetry = !result.sent && result.configured;
  await ReminderDelivery.updateOne(
    { reminderId, status: 'SENDING' },
    {
      $set: {
        status: deliveryStatus,
        sentAt: result.sent ? new Date() : null,
        retryAt: canRetry ? new Date(Date.now() + PUSH_RETRY_DELAY_MS) : null,
      },
    }
  );
};

const checkDueDoses = async () => {
  try {
    const medicines = await Medicine.find({ active: true }).lean();
    if (!medicines.length) return;
    const userIds = [...new Set(medicines.map((medicine) => String(medicine.user)))];
    const users = await User.find({ _id: { $in: userIds } }).select('_id timezoneOffset caregiverId').lean();
    const userById = new Map(users.map((user) => [String(user._id), user]));
    const offsets = new Map(users.map((user) => [
      String(user._id),
      Number.isFinite(user.timezoneOffset) ? user.timezoneOffset : 0,
    ]));
    const scheduleForMedicine = new Map();
    const scheduledDates = new Set();
    for (const medicine of medicines) {
      const timezoneOffset = offsets.get(String(medicine.user)) || 0;
      const localNow = new Date(Date.now() - timezoneOffset * 60000);
      const scheduledDate = localNow.toISOString().slice(0, 10);
      scheduleForMedicine.set(String(medicine._id), { timezoneOffset, scheduledDate, localNow });
      scheduledDates.add(scheduledDate);
    }
    const historyEntries = await History.find({
      scheduledDate: { $in: [...scheduledDates] },
      medicine: { $in: medicines.map((medicine) => medicine._id) },
    }).select('medicine scheduledDate scheduledTime status snoozeUntil').lean();
    const historyByDose = new Map(historyEntries.map((entry) => [
      `${String(entry.medicine)}:${entry.scheduledDate}:${entry.scheduledTime}`,
      entry,
    ]));
    const now = Date.now();

    for (const medicine of medicines) {
      const schedule = scheduleForMedicine.get(String(medicine._id));
      const { timezoneOffset, scheduledDate, localNow } = schedule;
      const startDate = medicine.startDate ? new Date(medicine.startDate).toISOString().slice(0, 10) : '';
      const endDate = medicine.endDate ? new Date(medicine.endDate).toISOString().slice(0, 10) : '';
      if ((startDate && scheduledDate < startDate) || (endDate && scheduledDate > endDate)) {
        continue;
      }
      if (medicine.scheduleDays?.length && !medicine.scheduleDays.includes(localNow.getUTCDay())) {
        continue;
      }

      const times = Array.isArray(medicine.scheduledTimes) && medicine.scheduledTimes.length
        ? medicine.scheduledTimes
        : [medicine.scheduleTime || medicine.time || '08:00'];

      for (const scheduledTime of times) {
        const scheduledDateTime = createTime(scheduledDate, scheduledTime, timezoneOffset);
        const existing = historyByDose.get(`${String(medicine._id)}:${scheduledDate}:${scheduledTime}`);

        if (existing && ['TAKEN', 'SKIPPED', 'MISSED'].includes(existing.status)) {
          if (existing.status === 'MISSED') {
            const caregiverId = userById.get(String(medicine.user))?.caregiverId;
            if (caregiverId) {
              await deliverPushOnce({
                reminderId: `${getReminderKey(String(medicine._id), scheduledDate, scheduledTime)}:CAREGIVER_MISSED`,
                doseKey: getReminderKey(String(medicine._id), scheduledDate, scheduledTime),
                medicine: { ...medicine, user: caregiverId },
                scheduledDate,
                scheduledTime,
                notificationType: 'CAREGIVER_MISSED',
              });
            }
          }
          continue;
        }

        const missedAfter = Math.max(
          scheduledDateTime.getTime() + MISSED_GRACE_MINUTES * 60000,
          existing?.snoozeUntil ? new Date(existing.snoozeUntil).getTime() + MISSED_GRACE_MINUTES * 60000 : 0
        );
        const reminderId = getReminderKey(String(medicine._id), scheduledDate, scheduledTime);
        const shouldRemind = existing?.status === 'SNOOZED' && existing.snoozeUntil
          ? now >= new Date(existing.snoozeUntil).getTime()
            && now <= new Date(existing.snoozeUntil).getTime() + MISSED_GRACE_MINUTES * 60000
          : now >= scheduledDateTime.getTime()
            && now <= scheduledDateTime.getTime() + MISSED_GRACE_MINUTES * 60000;
        if (shouldRemind && (!existing || ['PENDING', 'SNOOZED'].includes(existing.status))) {
          const snoozeSuffix = existing?.status === 'SNOOZED' ? `:SNOOZE:${existing.snoozeCount || 1}` : '';
          await deliverPushOnce({
            reminderId: `${reminderId}${snoozeSuffix}`,
            doseKey: reminderId,
            medicine,
            scheduledDate,
            scheduledTime,
            notificationType: existing?.status === 'SNOOZED' ? 'SNOOZE' : 'DOSE_DUE',
          });
        }
        if (now <= missedAfter) {
          continue;
        }

        const doseKey = getReminderKey(String(medicine._id), scheduledDate, scheduledTime);
        const doseDate = scheduledDateTime;
        const actionTime = new Date(now);
        const filter = {
          user: medicine.user,
          medicine: medicine._id,
          scheduledDate,
          scheduledTime,
          status: { $in: ['PENDING', 'SNOOZED'] },
        };
        const update = {
          $set: { status: 'MISSED', actionTime },
          $setOnInsert: {
            medicineName: medicine.name,
            dosage: medicine.dosage,
            scheduledTime,
            scheduledDate,
            doseKey,
            doseDate,
          },
        };

        try {
          const result = await History.updateOne(filter, update);
          if (result.modifiedCount > 0) {
            const caregiverId = userById.get(String(medicine.user))?.caregiverId;
            if (caregiverId) {
              await deliverPushOnce({
                reminderId: `${doseKey}:CAREGIVER_MISSED`,
                doseKey,
                medicine: { ...medicine, user: caregiverId },
                scheduledDate,
                scheduledTime,
                notificationType: 'CAREGIVER_MISSED',
              });
            }
            continue;
          }

          if (existing) {
            continue;
          }

          await History.create({
            user: medicine.user,
            medicine: medicine._id,
            medicineName: medicine.name,
            dosage: medicine.dosage,
            scheduledTime,
            scheduledDate,
            doseKey,
            doseDate,
            actionTime,
            status: 'MISSED',
          });
          const caregiverId = userById.get(String(medicine.user))?.caregiverId;
          if (caregiverId) {
            await deliverPushOnce({
              reminderId: `${doseKey}:CAREGIVER_MISSED`,
              doseKey,
              medicine: { ...medicine, user: caregiverId },
              scheduledDate,
              scheduledTime,
              notificationType: 'CAREGIVER_MISSED',
            });
          }
        } catch (error) {
          if (error.code !== 11000) {
            throw error;
          }
        }
      }
    }
  } catch (error) {
    console.error('Scheduled dose check failed:', error);
  }
};

const startScheduler = () => {
  if (schedulerInterval) {
    return schedulerInterval;
  }

  checkDueDoses();
  schedulerInterval = setInterval(checkDueDoses, CHECK_INTERVAL_MS);
  return schedulerInterval;
};

module.exports = { startScheduler, checkDueDoses };
