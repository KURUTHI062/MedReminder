const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const configuredGraceMinutes = Number(import.meta.env.VITE_MISSED_GRACE_MINUTES || 30);
export const MISSED_GRACE_MINUTES = Number.isFinite(configuredGraceMinutes) && configuredGraceMinutes >= 0
  ? configuredGraceMinutes
  : 30;

export const getLocalDateKey = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const getCalendarDateKey = (value) => {
  if (!value) return '';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T00:00:00(?:\.0+)?Z$/.test(value)) {
    return value.slice(0, 10);
  }
  return getLocalDateKey(new Date(value));
};

export const getMedicineTimes = (medicine) => {
  const times = Array.isArray(medicine.scheduledTimes) ? medicine.scheduledTimes : [];
  const compatibleTimes = times.length ? times : [medicine.scheduleTime || medicine.time || '08:00'];
  return [...new Set(compatibleTimes.filter((time) => TIME_PATTERN.test(time)))].sort();
};

export const isMedicineScheduledOnDate = (medicine, dateKey) => {
  if (medicine.active === false || !getMedicineTimes(medicine).length) return false;
  const startDate = getCalendarDateKey(medicine.startDate);
  const endDate = getCalendarDateKey(medicine.endDate);
  const [year, month, day] = dateKey.split('-').map(Number);
  const scheduleDays = Array.isArray(medicine.scheduleDays) ? medicine.scheduleDays : [];
  return (!startDate || dateKey >= startDate)
    && (!endDate || dateKey <= endDate)
    && (!scheduleDays.length || scheduleDays.includes(new Date(year, month - 1, day).getDay()));
};

export const createScheduledDateTime = (dateKey, time) => {
  const [year, month, day] = dateKey.split('-').map(Number);
  const [hours, minutes] = time.split(':').map(Number);
  return new Date(year, month - 1, day, hours, minutes, 0, 0);
};

export const addCalendarDays = (date, amount) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount);

export const getDoseHistory = (history, medicineId, dateKey, time) =>
  history.find((entry) => {
    const entryDate = entry.scheduledDate || getCalendarDateKey(entry.doseDate);
    return entry.medicine === medicineId && entryDate === dateKey && entry.scheduledTime === time;
  });

export const getDailyDoses = (medicines, history, date, now = new Date()) => {
  const dateKey = typeof date === 'string' ? date : getLocalDateKey(date);

  return medicines
    .filter((medicine) => isMedicineScheduledOnDate(medicine, dateKey))
    .flatMap((medicine) =>
      getMedicineTimes(medicine).map((scheduledTime) => {
        const scheduledDateTime = createScheduledDateTime(dateKey, scheduledTime);
        const historyEntry = getDoseHistory(history, medicine._id, dateKey, scheduledTime);
        const graceEndsAt = scheduledDateTime.getTime() + MISSED_GRACE_MINUTES * 60 * 1000;
        const timingStatus = scheduledDateTime > now ? 'UPCOMING' : graceEndsAt >= now ? 'DUE' : 'MISSED';
        const snoozeUntil = historyEntry?.snoozeUntil ? new Date(historyEntry.snoozeUntil) : null;
        const isSnoozed = historyEntry?.status === 'SNOOZED' && snoozeUntil > now;
        const status = isSnoozed ? 'SNOOZED'
          : historyEntry?.status === 'SNOOZED' ? 'PENDING'
            : historyEntry?.status || 'PENDING';

        return {
          medicine,
          dateKey,
          scheduledTime,
          scheduledDateTime,
          historyEntry,
          snoozeUntil,
          status,
          timingStatus,
        };
      })
    )
    .sort((first, second) => first.scheduledDateTime - second.scheduledDateTime);
};

export const getNextScheduledDose = (medicine, currentDate = new Date(), history = []) => {
  for (let dayOffset = 0; dayOffset < 366; dayOffset += 1) {
    const scheduledDate = addCalendarDays(currentDate, dayOffset);
    const dateKey = getLocalDateKey(scheduledDate);
    if (!isMedicineScheduledOnDate(medicine, dateKey)) continue;

    for (const scheduledTime of getMedicineTimes(medicine)) {
      const scheduledDateTime = createScheduledDateTime(dateKey, scheduledTime);
      const historyEntry = getDoseHistory(history, medicine._id, dateKey, scheduledTime);
      const snoozeUntil = historyEntry?.status === 'SNOOZED' && historyEntry.snoozeUntil
        ? new Date(historyEntry.snoozeUntil)
        : null;
      if ((historyEntry && ['TAKEN', 'SKIPPED', 'MISSED'].includes(historyEntry.status))
        || (snoozeUntil <= currentDate
          && scheduledDateTime.getTime() + MISSED_GRACE_MINUTES * 60 * 1000 < currentDate.getTime())) {
        continue;
      }

      return {
        medicine,
        scheduledDate,
        scheduledTime,
        scheduledDateTime: snoozeUntil > currentDate ? snoozeUntil : scheduledDateTime,
      };
    }
  }

  return null;
};

export const formatTime = (date) =>
  new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date);