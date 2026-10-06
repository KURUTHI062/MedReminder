import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import {
  addCalendarDays,
  createScheduledDateTime,
  formatTime,
  getCalendarDateKey,
  getDailyDoses,
  getDoseHistory,
  getLocalDateKey,
  getMedicineTimes,
  getNextScheduledDose,
  MISSED_GRACE_MINUTES,
} from './schedule';

const STORAGE_KEY = 'medreminder_token';
const REMINDERS_KEY = 'medreminder_reminders_enabled';
const SOUND_KEY = 'medreminder_reminder_sound';
const API = axios.create({
  baseURL: `${import.meta.env.VITE_API_URL}/api`,
});
const FREQUENCY_OPTIONS = ['Once daily', 'Every day', 'Twice daily', 'Three times daily', 'Specific times', 'Weekly'];
const TIMES_BY_FREQUENCY = { 'Once daily': 1, 'Every day': 1, 'Twice daily': 2, 'Three times daily': 3 };
const DEFAULT_TIMES_BY_FREQUENCY = { 1: ['08:00'], 2: ['08:00', '20:00'], 3: ['08:00', '14:00', '20:00'] };

const getAuthHeaders = () => {
  const token = localStorage.getItem(STORAGE_KEY);
  return token ? { Authorization: ['Bearer', token].join(' ') } : {};
};

const decodeVapidKey = (base64Key) => {
  const padded = `${base64Key}${'='.repeat((4 - (base64Key.length % 4)) % 4)}`;
  const raw = window.atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
};

const apiRequest = (method, url, data = null) =>
  API.request({
    method,
    url,
    data,
    headers: { ...getAuthHeaders(), 'X-Timezone-Offset': new Date().getTimezoneOffset() },
  });

const createMedicineForm = () => ({
  name: '',
  dosage: '',
  frequency: 'Once daily',
  scheduledTimes: ['08:00'],
  scheduleDays: [],
  startDate: '',
  endDate: '',
  quantity: 0,
  instructions: '',
  active: true,
});

const formatDate = (date, options = { weekday: 'long', month: 'long', day: 'numeric' }) =>
  new Intl.DateTimeFormat(undefined, options).format(date);

const dateFromKey = (dateKey) => createScheduledDateTime(dateKey, '12:00');

const initials = (name = 'User') =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();

const greeting = () => {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
};

const doseKey = (dose) => `${dose.medicine._id}|${dose.dateKey}|${dose.scheduledTime}`;

const getStatusLabel = (status) => ({
  PENDING: 'PENDING',
  TAKEN: 'TAKEN',
  SKIPPED: 'SKIPPED',
  MISSED: 'MISSED',
  SNOOZED: 'SNOOZED',
  DUE: 'DUE NOW',
  UPCOMING: 'UPCOMING',
}[status] || status);

function MedicineDialog({ form, setForm, editing, loading, onClose, onSubmit }) {
  const knownFrequency = FREQUENCY_OPTIONS.includes(form.frequency);
  const changeFrequency = (frequency) => {
    setForm((current) => {
      const count = TIMES_BY_FREQUENCY[frequency];
      return {
        ...current,
        frequency,
        scheduleDays: frequency === 'Weekly' ? (current.scheduleDays.length ? current.scheduleDays : [1]) : [],
        scheduledTimes: count
          ? Array.from({ length: count }, (_, index) => current.scheduledTimes[index] || DEFAULT_TIMES_BY_FREQUENCY[count][index])
          : current.scheduledTimes,
      };
    });
  };

  const setTime = (index, value) => {
    setForm((current) => ({
      ...current,
      scheduledTimes: current.scheduledTimes.map((time, timeIndex) => timeIndex === index ? value : time),
    }));
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="medicine-dialog" role="dialog" aria-modal="true" aria-labelledby="medicine-dialog-title">
        <div className="dialog-heading">
          <div><span className="eyebrow">CARE PLAN</span><h2 id="medicine-dialog-title">{editing ? 'Edit medicine' : 'Add a medicine'}</h2></div>
          <button className="icon-button close-button" type="button" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <form className="medicine-form" onSubmit={onSubmit}>
          <label className="form-field">Medicine name<input autoFocus name="name" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} required /></label>
          <div className="form-columns">
            <label className="form-field">Dosage<input name="dosage" placeholder="1 tablet" value={form.dosage} onChange={(event) => setForm((current) => ({ ...current, dosage: event.target.value }))} /></label>
            <label className="form-field">Frequency<select value={form.frequency} onChange={(event) => changeFrequency(event.target.value)}>
              {!knownFrequency && <option value={form.frequency}>{form.frequency}</option>}
              {FREQUENCY_OPTIONS.map((frequency) => <option key={frequency} value={frequency}>{frequency}</option>)}
            </select></label>
          </div>
          <fieldset className="time-fields"><legend>Scheduled times</legend>
            <div className="time-input-list">{form.scheduledTimes.map((time, index) => <label className="form-field" key={`dose-time-${index}`}>
              {form.scheduledTimes.length > 1 ? `Dose ${index + 1}` : 'Time'}<input type="time" value={time} onChange={(event) => setTime(index, event.target.value)} required />
            </label>)}</div>
            {form.frequency === 'Specific times' && <button className="text-button add-time-button" type="button" onClick={() => setForm((current) => ({ ...current, scheduledTimes: [...current.scheduledTimes, '12:00'] }))}>+ Add another time</button>}
          </fieldset>
          {form.frequency === 'Weekly' && <fieldset className="time-fields"><legend>Days of the week</legend><div className="weekday-options">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, index) => <label key={day}><input type="checkbox" checked={form.scheduleDays.includes(index)} onChange={(event) => setForm((current) => ({ ...current, scheduleDays: event.target.checked ? [...new Set([...current.scheduleDays, index])].sort() : current.scheduleDays.filter((value) => value !== index) }))} />{day}</label>)}</div></fieldset>}
          <div className="form-columns">
            <label className="form-field">Start date<input type="date" value={form.startDate} onChange={(event) => setForm((current) => ({ ...current, startDate: event.target.value }))} /></label>
            <label className="form-field">End date<input type="date" value={form.endDate} onChange={(event) => setForm((current) => ({ ...current, endDate: event.target.value }))} /></label>
          </div>
          <label className="form-field">Quantity<input type="number" min="0" step="1" value={form.quantity} onChange={(event) => setForm((current) => ({ ...current, quantity: event.target.value }))} /></label>
          <label className="form-field">Instructions<textarea rows="3" placeholder="After breakfast" value={form.instructions} onChange={(event) => setForm((current) => ({ ...current, instructions: event.target.value }))} /></label>
          <label className="switch-row form-switch"><span><strong>Active medicine</strong><small>Include it in your daily schedule</small></span><input type="checkbox" checked={form.active} onChange={(event) => setForm((current) => ({ ...current, active: event.target.checked }))} /></label>
          <div className="dialog-actions"><button className="button button-quiet" type="button" onClick={onClose}>Cancel</button><button className="button button-primary" type="submit" disabled={loading}>{loading ? 'Saving…' : editing ? 'Save changes' : 'Add medicine'}</button></div>
        </form>
      </section>
    </div>
  );
}

function App() {
  const [authMode, setAuthMode] = useState('login');
  const [form, setForm] = useState({ name: '', email: 'demo@medreminder.local', password: 'Demo@123456' });
  const [token, setToken] = useState(localStorage.getItem(STORAGE_KEY) || '');
  const [user, setUser] = useState(null);
  const [medicines, setMedicines] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [page, setPage] = useState('Overview');
  const [medicineForm, setMedicineForm] = useState(createMedicineForm());
  const [editingMedicine, setEditingMedicine] = useState(null);
  const [medicineDialogOpen, setMedicineDialogOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState(getLocalDateKey());
  const [historyFilter, setHistoryFilter] = useState('ALL');
  const [pendingDose, setPendingDose] = useState('');
  const [remindersEnabled, setRemindersEnabled] = useState(localStorage.getItem(REMINDERS_KEY) === 'true');
  const [soundEnabled, setSoundEnabled] = useState(localStorage.getItem(SOUND_KEY) !== 'false');
  const [notificationPermission, setNotificationPermission] = useState('Notification' in window ? Notification.permission : 'unsupported');
  const [pushStatus, setPushStatus] = useState('not-configured');
  const [voiceGuidance, setVoiceGuidance] = useState(localStorage.getItem('medreminder_voice_guidance') === 'true');
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [reminderAlert, setReminderAlert] = useState(null);
  const [seniorLoginMode, setSeniorLoginMode] = useState(false);
  const [seniorEmail, setSeniorEmail] = useState('');
  const [seniorPin, setSeniorPin] = useState('');
  const [trustThisDevice, setTrustThisDevice] = useState(false);
  const [caregiver, setCaregiver] = useState({ name: '', phone: '', email: '' });
  const [patients, setPatients] = useState([]);
  const [patientForm, setPatientForm] = useState({ name: '', email: '', phone: '', pin: '' });
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [patientDashboard, setPatientDashboard] = useState(null);
  const [patientDevices, setPatientDevices] = useState([]);
  const [patientAlerts, setPatientAlerts] = useState([]);
  const [patientReport, setPatientReport] = useState(null);
  const [reportPeriod, setReportPeriod] = useState('week');
  const [overrideTarget, setOverrideTarget] = useState(null);
  const [overrideForm, setOverrideForm] = useState({ newStatus: 'TAKEN', reason: '' });
  const [voiceUnavailable, setVoiceUnavailable] = useState(false);
  const [alarmRepeating, setAlarmRepeating] = useState(localStorage.getItem('medreminder_alarm_repeat') === 'true');
  const [alarmVolume, setAlarmVolume] = useState(Number(localStorage.getItem('medreminder_alarm_volume') || '0.7'));
  const [alarmDuration, setAlarmDuration] = useState(Number(localStorage.getItem('medreminder_alarm_duration') || '8'));
  const pendingDoseKeys = useRef(new Set());
  const notifiedDoseKeys = useRef(new Set(JSON.parse(localStorage.getItem('medreminder_notified_doses') || '[]')));
  const alarmAudioRef = useRef(null);
  const alarmIntervalRef = useRef(null);

  const loadProtectedData = async () => {
    if (!token) {
      setUser(null);
      setMedicines([]);
      setHistory([]);
      return;
    }
    try {
      const [userResponse, medicinesResponse, historyResponse] = await Promise.all([
        apiRequest('get', '/auth/me'), apiRequest('get', '/medicines'), apiRequest('get', '/history'),
      ]);
      setUser(userResponse.data.user);
      setMedicines(medicinesResponse.data.medicines || []);
      setHistory(historyResponse.data.history || []);
      if (userResponse.data.user.role === 'caregiver') {
        const patientResponse = await apiRequest('get', '/caregiver/patients');
        setPatients(patientResponse.data.seniors || []);
      } else {
        setPatients([]);
      }
      setError('');
    } catch (requestError) {
      if (requestError.response?.status === 401) {
        logout();
        return;
      }
      console.error('Unable to load protected care-plan data:', {
        status: requestError.response?.status,
        message: requestError.message,
        responseMessage: requestError.response?.data?.message,
      });
      setError(requestError.response?.data?.message || 'Unable to load your care plan.');
    }
  };

  useEffect(() => { if (token) loadProtectedData(); }, [token]);

  useEffect(() => {
    if (localStorage.getItem(STORAGE_KEY)) return;
    API.post('/auth/senior-pin/trusted-login')
      .then((response) => {
        localStorage.setItem(STORAGE_KEY, response.data.token);
        setToken(response.data.token);
        setUser(response.data.user);
      })
      .catch((requestError) => {
        if (requestError.response?.status !== 401) {
          setError(requestError.response?.data?.message || 'Unable to verify this trusted device.');
        }
      });
  }, []);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return undefined;
    let active = true;
    navigator.serviceWorker.register('/sw.js')
      .then(() => {
        if (active) setPushStatus('available');
      })
      .catch((registrationError) => {
        console.error('Service worker registration failed:', registrationError);
        if (active) setPushStatus('unavailable');
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!user) {
      setCaregiver({ name: '', phone: '', email: '' });
      return;
    }
    setCaregiver({
      name: user.caregiverName || '',
      phone: user.caregiverPhone || '',
      email: user.caregiverEmail || '',
    });
  }, [user]);

  const stopAlarm = () => {
    if (alarmIntervalRef.current) {
      window.clearInterval(alarmIntervalRef.current);
      alarmIntervalRef.current = null;
    }
    if (alarmAudioRef.current) {
      const { audioContext } = alarmAudioRef.current;
      if (audioContext && audioContext.state !== 'closed') {
        audioContext.close().catch(() => undefined);
      }
      alarmAudioRef.current = null;
    }
  };

  const playAlarm = (repeat = alarmRepeating) => {
    if (!soundEnabled || !(('AudioContext' in window) || ('webkitAudioContext' in window))) {
      return;
    }
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!alarmAudioRef.current) {
      alarmAudioRef.current = { audioContext: new AudioCtor() };
    }
    const context = alarmAudioRef.current.audioContext;

    const triggerTone = () => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = 880;
      gain.gain.value = Math.max(0.02, Number(alarmVolume || 0.7) * 0.12);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      window.setTimeout(() => {
        try {
          oscillator.stop();
        } catch (error) { /* no-op */ }
        gain.disconnect();
      }, Math.max(150, Number(alarmDuration || 8) * 1000));
    };

    const speak = (message) => {
      if (!voiceGuidance || !('speechSynthesis' in window)) return;
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(message);
      utterance.rate = 0.9;
      window.speechSynthesis.speak(utterance);
    };

    if (context.state === 'suspended') {
      context.resume().then(triggerTone).catch(() => {
        setError('Tap Test Alarm to allow sound playback in this browser.');
      });
    } else {
      triggerTone();
    }
    if (alarmIntervalRef.current) {
      window.clearInterval(alarmIntervalRef.current);
    }
    if (repeat) {
      alarmIntervalRef.current = window.setInterval(triggerTone, Math.max(1500, Number(alarmDuration || 8) * 1000));
    }
  };

  const dismissReminder = () => {
    stopAlarm();
    setReminderAlert(null);
  };

  const snoozeReminder = () => {
    if (!reminderAlert) return;
    const activeReminder = reminderAlert;
    dismissReminder();
    window.setTimeout(() => {
      setReminderAlert(activeReminder);
      if (soundEnabled) playAlarm(alarmRepeating);
    }, 5 * 60 * 1000);
  };

  const logout = () => {
    localStorage.removeItem(STORAGE_KEY);
    delete API.defaults.headers.common['X-Senior-Id'];
    setToken('');
    setUser(null);
    setMedicines([]);
    setHistory([]);
    setPatients([]);
    setSelectedPatient(null);
    setPatientDashboard(null);
    setError('');
    setSuccess('');
  };

  const handleAuth = async (event) => {
    event.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);
    try {
      const endpoint = authMode === 'login' ? '/auth/login' : '/auth/register';
      const payload = authMode === 'login' ? { email: form.email, password: form.password } : { name: form.name, email: form.email, password: form.password };
      const response = await API.post(endpoint, payload);
      localStorage.setItem(STORAGE_KEY, response.data.token);
      setToken(response.data.token);
      setUser(response.data.user);
      setSuccess(authMode === 'login' ? 'Welcome back.' : 'Your account is ready.');
      setForm({ name: '', email: '', password: '' });
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Authentication failed.');
    } finally { setLoading(false); }
  };

  const handleSeniorPinLogin = async (event) => {
    event.preventDefault();
    if (!seniorEmail || seniorPin.length < 4) {
      setError('Enter your senior email and 4-6 digit PIN.');
      return;
    }

    setError('');
    setSuccess('');
    setLoading(true);
    try {
      const response = await API.post('/auth/senior-pin/login', {
        email: seniorEmail,
        pin: seniorPin,
        trustDevice: trustThisDevice,
        deviceName: 'Senior device',
      });
      localStorage.setItem(STORAGE_KEY, response.data.token);
      setToken(response.data.token);
      setUser(response.data.user);
      setSeniorLoginMode(false);
      setSeniorPin('');
      setSeniorEmail('');
      setTrustThisDevice(false);
      setSuccess('Welcome to Senior Mode.');
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to verify the senior PIN.');
    } finally {
      setLoading(false);
    }
  };

  const createSenior = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      await apiRequest('post', '/caregiver/patients', patientForm);
      setPatientForm({ name: '', email: '', phone: '', pin: '' });
      setSuccess('Senior profile created.');
      await loadProtectedData();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to create senior profile.');
    } finally {
      setLoading(false);
    }
  };

  const openPatientDashboard = async (patient) => {
    setSelectedPatient(patient);
    setPage('Patient dashboard');
    setLoading(true);
    setError('');
    try {
      const id = patient.id || patient._id;
      const [dashboardResponse, deviceResponse, alertResponse, reportResponse] = await Promise.all([
        apiRequest('get', `/caregiver/patients/${id}/dashboard`),
        apiRequest('get', `/caregiver/patients/${id}/devices`),
        apiRequest('get', `/caregiver/patients/${id}/alerts`),
        apiRequest('get', `/caregiver/patients/${id}/reports?period=${reportPeriod}`),
      ]);
      setPatientDashboard(dashboardResponse.data);
      setPatientDevices(deviceResponse.data.devices || []);
      setPatientAlerts(alertResponse.data.alerts || []);
      setPatientReport(reportResponse.data);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to load this patient.');
    } finally {
      setLoading(false);
    }
  };

  const loadPatientReport = async (period) => {
    if (!selectedPatient) return;
    setReportPeriod(period);
    try {
      const response = await apiRequest('get', `/caregiver/patients/${selectedPatient.id || selectedPatient._id}/reports?period=${period}`);
      setPatientReport(response.data);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to load this report.');
    }
  };

  const submitDoseOverride = async (event) => {
    event.preventDefault();
    if (!selectedPatient || !overrideTarget) return;
    try {
      const response = await apiRequest(
        'post',
        `/caregiver/patients/${selectedPatient.id || selectedPatient._id}/doses/${overrideTarget._id}/override`,
        overrideForm
      );
      setPatientDashboard((current) => current ? {
        ...current,
        doses: current.doses.map((dose) => dose._id === response.data.history._id ? response.data.history : dose),
      } : current);
      setOverrideTarget(null);
      setOverrideForm({ newStatus: 'TAKEN', reason: '' });
      await openPatientDashboard(selectedPatient);
      setSuccess('Dose correction recorded with an audit note.');
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to correct dose status.');
    }
  };

  const managePatientMedicines = async (patient) => {
    const id = patient.id || patient._id;
    API.defaults.headers.common['X-Senior-Id'] = id;
    setSelectedPatient(patient);
    setPage('My medicines');
    setLoading(true);
    try {
      await loadProtectedData();
    } finally {
      setLoading(false);
    }
  };

  const stopManagingPatient = async () => {
    delete API.defaults.headers.common['X-Senior-Id'];
    setSelectedPatient(null);
    setPatientDashboard(null);
    setPatientDevices([]);
    setPatientAlerts([]);
    setPage('Patients');
    await loadProtectedData();
  };

  const resetPatientPin = async () => {
    if (!selectedPatient) return;
    const pin = window.prompt(`Enter a new 4–6 digit PIN for ${selectedPatient.name}:`);
    if (pin === null) return;
    if (!/^[0-9]{4,6}$/.test(pin)) {
      setError('PIN must be 4 to 6 digits.');
      return;
    }
    try {
      await apiRequest('post', `/caregiver/patients/${selectedPatient.id || selectedPatient._id}/pin`, { pin });
      setSuccess('PIN reset. Trusted devices were signed out.');
      await openPatientDashboard(selectedPatient);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to reset PIN.');
    }
  };

  useEffect(() => {
    if (page !== 'Patient dashboard' || !selectedPatient) return undefined;
    const refresh = async () => {
      try {
        const id = selectedPatient.id || selectedPatient._id;
        const [dashboardResponse, alertResponse] = await Promise.all([
          apiRequest('get', `/caregiver/patients/${id}/dashboard`),
          apiRequest('get', `/caregiver/patients/${id}/alerts`),
        ]);
        setPatientDashboard(dashboardResponse.data);
        setPatientAlerts(alertResponse.data.alerts || []);
      } catch (requestError) {
        setError(requestError.response?.data?.message || 'Unable to refresh patient dashboard.');
      }
    };
    const interval = window.setInterval(refresh, 15000);
    return () => window.clearInterval(interval);
  }, [page, selectedPatient]);

  const revokePatientDevice = async (deviceId) => {
    if (!selectedPatient) return;
    try {
      await apiRequest('delete', `/caregiver/patients/${selectedPatient.id || selectedPatient._id}/devices/${deviceId}`);
      setPatientDevices((current) => current.filter((device) => device._id !== deviceId));
      setSuccess('Trusted device revoked.');
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to revoke this device.');
    }
  };

  const startVoiceMedicineEntry = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setVoiceUnavailable(true);
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = navigator.language || 'en-US';
    recognition.onresult = (event) => {
      const phrase = event.results[0][0].transcript.trim();
      const timeMatch = phrase.match(/\b(?:at\s*)?(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i);
      const times = ['08:00'];
      if (timeMatch) {
        let hour = Number(timeMatch[1]) % 12;
        if (/p/i.test(timeMatch[3])) hour += 12;
        times[0] = `${String(hour).padStart(2, '0')}:${timeMatch[2] || '00'}`;
      }
      const name = phrase.split(/,|\bone\b|\bone tablet\b|\bone capsule\b|\bevery\b|\bat\b/i)[0].trim();
      const dosageMatch = phrase.match(/\b(\d+(?:\.\d+)?)\s*(tablets?|capsules?|pills?|drops?|ml)\b/i);
      const instructionsMatch = phrase.match(/\b(after|before)\s+(food|meal|breakfast|lunch|dinner)\b/i);
      setMedicineForm({
        ...createMedicineForm(),
        name: name || phrase,
        dosage: dosageMatch ? `${dosageMatch[1]} ${dosageMatch[2]}` : '',
        scheduledTimes: times,
        instructions: instructionsMatch ? instructionsMatch[0] : '',
      });
      setEditingMedicine(null);
      setMedicineDialogOpen(true);
      setSuccess('Review the voice-captured details, edit if needed, then confirm to save.');
    };
    recognition.onerror = () => setError('Voice capture failed. You can enter the medicine details manually.');
    recognition.start();
    setVoiceUnavailable(false);
  };

  const openNewMedicine = () => {
    setEditingMedicine(null);
    setMedicineForm(createMedicineForm());
    setMedicineDialogOpen(true);
  };

  const editMedicine = (medicine) => {
    setEditingMedicine(medicine);
    setMedicineForm({
      name: medicine.name || '', dosage: medicine.dosage || '', frequency: medicine.frequency || 'Once daily',
      scheduledTimes: getMedicineTimes(medicine), scheduleDays: medicine.scheduleDays || [], startDate: getCalendarDateKey(medicine.startDate), endDate: getCalendarDateKey(medicine.endDate),
      quantity: medicine.quantity ?? 0, instructions: medicine.instructions || '', active: medicine.active !== false,
    });
    setMedicineDialogOpen(true);
  };

  const saveMedicine = async (event) => {
    event.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);
    const scheduledTimes = [...new Set(medicineForm.scheduledTimes.filter(Boolean))].sort();
    if (!scheduledTimes.length) {
      setError('Add at least one scheduled time.');
      setLoading(false);
      return;
    }
    const payload = {
      ...medicineForm, scheduledTimes, scheduleTime: scheduledTimes[0], time: scheduledTimes[0],
      quantity: Number(medicineForm.quantity || 0),
      remainingQuantity: editingMedicine?.remainingQuantity ?? Number(medicineForm.quantity || 0),
      startDate: medicineForm.startDate || null, endDate: medicineForm.endDate || null,
    };
    try {
      if (editingMedicine) {
        await apiRequest('put', `/medicines/${editingMedicine._id}`, payload);
        setSuccess('Medicine updated.');
      } else {
        await apiRequest('post', '/medicines', payload);
        setSuccess('Medicine added to your plan.');
      }
      setMedicineDialogOpen(false);
      setEditingMedicine(null);
      setMedicineForm(createMedicineForm());
      await loadProtectedData();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to save this medicine.');
    } finally { setLoading(false); }
  };

  const deleteMedicine = async (medicine) => {
    if (!window.confirm(`Remove ${medicine.name} from your medicines?`)) return;
    try {
      await apiRequest('delete', `/medicines/${medicine._id}`);
      setSuccess(`${medicine.name} removed.`);
      await loadProtectedData();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to remove this medicine.');
    }
  };

  const markDoseStatus = async (dose, status) => {
    const key = `${dose.medicine._id}|${dose.dateKey}|${dose.scheduledTime}`;
    if (pendingDoseKeys.current.has(key)) return;
    pendingDoseKeys.current.add(key);
    setPendingDose(key);
    setError('');
    const existing = getDoseHistory(history, dose.medicine._id, dose.dateKey, dose.scheduledTime);
    const existingStatus = existing?.status;
    const currentMedicine = medicines.find((medicine) => medicine._id === dose.medicine._id);
    if (currentMedicine) {
      let remainingQuantity = Number(currentMedicine.remainingQuantity ?? currentMedicine.quantity ?? 0);
      if (status === 'TAKEN' && existingStatus !== 'TAKEN') remainingQuantity = Math.max(0, remainingQuantity - 1);
      if (status !== 'TAKEN' && existingStatus === 'TAKEN') remainingQuantity = Math.min(Number(currentMedicine.quantity ?? remainingQuantity + 1), remainingQuantity + 1);
      const optimistic = { ...currentMedicine, remainingQuantity };
      setMedicines((current) => current.map((medicine) => medicine._id === currentMedicine._id ? optimistic : medicine));
    }
    const localHistory = {
      ...existing, medicine: dose.medicine._id, medicineName: dose.medicine.name, dosage: dose.medicine.dosage,
      scheduledTime: dose.scheduledTime, scheduledDate: dose.dateKey, doseDate: `${dose.dateKey}T00:00:00.000Z`,
      actionTime: new Date().toISOString(), takenAt: status === 'TAKEN' ? new Date().toISOString() : null, status,
    };

    const snoozeDose = async (dose, minutes) => {
      const key = `${dose.medicine._id}|${dose.dateKey}|${dose.scheduledTime}`;
      setPendingDose(key);
      setError('');
      try {
        const response = await apiRequest('post', `/medicines/${dose.medicine._id}/snooze`, {
          minutes,
          scheduledDate: dose.dateKey,
          scheduledTime: dose.scheduledTime,
          timezoneOffset: new Date().getTimezoneOffset(),
        });
        const updated = response.data.history;
        setHistory((current) => [
          ...current.filter((entry) => !(entry.medicine === updated.medicine && entry.scheduledDate === updated.scheduledDate && entry.scheduledTime === updated.scheduledTime)),
          updated,
        ]);
        notifiedDoseKeys.current.delete(key);
        localStorage.setItem('medreminder_notified_doses', JSON.stringify([...notifiedDoseKeys.current]));
        dismissReminder();
        setSuccess(`${dose.medicine.name} snoozed for ${minutes} minutes.`);
      } catch (requestError) {
        setError(requestError.response?.data?.message || 'Unable to snooze this dose.');
      } finally {
        setPendingDose('');
      }
    };
    setHistory((current) => [
      ...current.filter((entry) => !(entry.medicine === dose.medicine._id && (entry.scheduledDate || getCalendarDateKey(entry.doseDate)) === dose.dateKey && entry.scheduledTime === dose.scheduledTime)),
      localHistory,
    ]);
    try {
      const response = await apiRequest('post', `/medicines/${dose.medicine._id}/status`, {
        status,
        scheduledDate: dose.dateKey,
        scheduledTime: dose.scheduledTime,
        timezoneOffset: new Date().getTimezoneOffset(),
      });
      setMedicines((current) => current.map((medicine) => medicine._id === response.data.medicine._id ? response.data.medicine : medicine));
      setHistory((current) => [
        ...current.filter((entry) => !(entry.medicine === response.data.history.medicine && (entry.scheduledDate || getCalendarDateKey(entry.doseDate)) === dose.dateKey && entry.scheduledTime === dose.scheduledTime)),
        response.data.history,
      ]);
      setSuccess(`${dose.medicine.name} marked ${getStatusLabel(status).toLowerCase()}.`);
      speak(`${dose.medicine.name} marked ${getStatusLabel(status).toLowerCase()}.`);
      if (reminderAlert && reminderAlert.key === key) {
        dismissReminder();
      }
    } catch (requestError) {
      await loadProtectedData();
      setError(requestError.response?.data?.message || 'Unable to update this dose.');
    } finally {
      pendingDoseKeys.current.delete(key);
      setPendingDose('');
    }
  };

  const requestNotificationPermission = async () => {
    if (!('Notification' in window)) {
      setError('Browser notifications are not supported in this browser.');
      return;
    }
    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
    if (permission === 'granted') {
      localStorage.setItem(REMINDERS_KEY, 'true');
      setRemindersEnabled(true);
      const pushEnabled = await subscribeToPushNotifications();
      setSuccess(pushEnabled
        ? 'Browser and background push reminders are enabled.'
        : 'Browser reminders are enabled while this app is open.');
    } else {
      localStorage.setItem(REMINDERS_KEY, 'true');
      setRemindersEnabled(true);
      setError(permission === 'denied' ? 'Notifications are blocked. Allow them for MedReminder in your browser settings.' : 'Notification permission was not granted.');
    }
  };

  const subscribeToPushNotifications = async () => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !token) return false;
    try {
      const keyResponse = await API.get('/notifications/vapid-public-key');
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: decodeVapidKey(keyResponse.data.publicKey),
      });
      const saved = await apiRequest('post', '/notifications/subscriptions', subscription.toJSON());
      if (saved.data.subscriptionId) localStorage.setItem('medreminder_push_subscription_id', saved.data.subscriptionId);
      setPushStatus('subscribed');
      return true;
    } catch (requestError) {
      if (requestError.response?.status === 503) {
        setPushStatus('not-configured');
      } else {
        console.error('Background push subscription failed:', requestError);
        setPushStatus('unavailable');
      }
      return false;
    }
  };

  const unsubscribePushNotifications = async () => {
    if (!('serviceWorker' in navigator)) return;
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) await subscription.unsubscribe();
      const subscriptionId = localStorage.getItem('medreminder_push_subscription_id');
      if (subscriptionId && token) await apiRequest('delete', `/notifications/subscriptions/${subscriptionId}`);
      localStorage.removeItem('medreminder_push_subscription_id');
      setPushStatus('available');
    } catch (requestError) {
      console.error('Background push unsubscribe failed:', requestError);
      setError('Unable to turn off background push on this device.');
    }
  };

  const toggleReminders = async () => {
    if (remindersEnabled) {
      localStorage.setItem(REMINDERS_KEY, 'false');
      setRemindersEnabled(false);
      await unsubscribePushNotifications();
      setSuccess('Reminders paused.');
    } else if (notificationPermission === 'granted') {
      localStorage.setItem(REMINDERS_KEY, 'true');
      setRemindersEnabled(true);
      const pushEnabled = await subscribeToPushNotifications();
      setSuccess(pushEnabled
        ? 'Browser and background push reminders are enabled.'
        : 'Reminders enabled while this app is open.');
    } else await requestNotificationPermission();
  };

  const toggleSound = (enabled) => {
    localStorage.setItem(SOUND_KEY, String(enabled));
    setSoundEnabled(enabled);
    if (!enabled) {
      stopAlarm();
    }
  };

  const saveCaregiver = async (event) => {
    event.preventDefault();
    try {
      const response = await apiRequest('put', '/auth/me', {
        caregiverName: caregiver.name,
        caregiverPhone: caregiver.phone,
        caregiverEmail: caregiver.email,
      });
      setUser(response.data.user);
      setSuccess('Caregiver contact saved.');
    } catch (requestError) {
      console.error('Unable to save caregiver details:', {
        status: requestError.response?.status,
        message: requestError.message,
        responseMessage: requestError.response?.data?.message,
      });
      setError(requestError.response?.data?.message || 'Unable to save caregiver details.');
    }
  };

  useEffect(() => {
    if (!token || !medicines.length) return undefined;
    const checkForMissedDoses = () => {
      const now = new Date();
      getDailyDoses(medicines, history, getLocalDateKey(now), now)
        .filter((dose) => dose.status === 'PENDING'
          && dose.timingStatus === 'MISSED'
          && (!dose.historyEntry || dose.historyEntry.status === 'PENDING'))
        .forEach((dose) => markDoseStatus(dose, 'MISSED'));
    };
    checkForMissedDoses();
    const interval = window.setInterval(checkForMissedDoses, 20000);
    return () => window.clearInterval(interval);
  }, [token, medicines, history]);

  useEffect(() => {
    if (!token || !medicines.length || !remindersEnabled) return undefined;
    const checkForReminders = () => {
      const now = new Date();
      const nextDueDose = getDailyDoses(medicines, history, getLocalDateKey(now), now)
        .filter((dose) => dose.status === 'PENDING' && dose.timingStatus === 'DUE' && dose.scheduledDateTime <= now)
        .sort((first, second) => first.scheduledDateTime - second.scheduledDateTime)[0];

      if (!nextDueDose) return;
      const key = `${nextDueDose.medicine._id}|${nextDueDose.dateKey}|${nextDueDose.scheduledTime}`;
      if (notifiedDoseKeys.current.has(key)) return;
      notifiedDoseKeys.current.add(key);
      localStorage.setItem('medreminder_notified_doses', JSON.stringify([...notifiedDoseKeys.current]));

      setReminderAlert({ key, dose: nextDueDose });
      speak(`It is time to take ${nextDueDose.medicine.name}.`);
      if (soundEnabled) {
        playAlarm(alarmRepeating);
      }
      if ('Notification' in window && notificationPermission === 'granted') {
        new Notification('💊 Medicine Reminder', {
          body: `${nextDueDose.medicine.name}\n${nextDueDose.medicine.dosage || 'Your prescribed dose'}\nScheduled for ${formatTime(nextDueDose.scheduledDateTime)}`,
          tag: key,
        });
      }
    };
    checkForReminders();
    const interval = window.setInterval(checkForReminders, 15000);
    return () => window.clearInterval(interval);
  }, [token, medicines, history, remindersEnabled, notificationPermission, soundEnabled, alarmRepeating, alarmVolume, alarmDuration]);

  useEffect(() => {
    return () => stopAlarm();
  }, []);

  const todayKey = getLocalDateKey(new Date());
  const todayDoses = getDailyDoses(medicines, history, todayKey);
  const nextOccurrence = medicines.map((medicine) => getNextScheduledDose(medicine, new Date(), history)).filter(Boolean).sort((a, b) => a.scheduledDateTime - b.scheduledDateTime)[0] || null;
  const nextDose = todayDoses.find((dose) => dose.status === 'PENDING' && ['DUE', 'UPCOMING'].includes(dose.timingStatus)) || null;
  const completedCount = history.filter((entry) => ['TAKEN', 'SKIPPED', 'MISSED'].includes(entry.status)).length;
  const takenCount = history.filter((entry) => entry.status === 'TAKEN').length;
  const adherence = completedCount ? Math.round((takenCount / completedCount) * 100) : 0;
  const todayCounts = todayDoses.reduce((counts, dose) => {
    if (dose.status === 'TAKEN') counts.taken += 1;
    if (dose.status === 'SKIPPED') counts.skipped += 1;
    if (dose.status === 'MISSED') counts.missed += 1;
    return counts;
  }, { taken: 0, skipped: 0, missed: 0 });
  const reminderCount = todayDoses.filter((dose) => dose.status === 'PENDING').length;

  if (seniorLoginMode && !token) {
    return <main className="auth-shell">
      <section className="auth-card" style={{ maxWidth: '460px' }}>
        <div className="brand-lockup"><span className="brand-mark">M</span><span>MedReminder</span></div>
        <p className="eyebrow">SENIOR MODE</p>
        <h1>Good Morning 👋</h1>
        <p className="auth-intro">Who’s using MedReminder?</p>
        <button type="button" className="button button-primary" style={{ marginBottom: '1rem' }} onClick={() => setSeniorLoginMode(false)}>← Back to caregiver sign in</button>
        <form onSubmit={handleSeniorPinLogin} className="auth-form">
          <label className="form-field">Senior email<input type="email" value={seniorEmail} onChange={(event) => setSeniorEmail(event.target.value)} required /></label>
          <label className="form-field">Enter your PIN<input type="password" inputMode="numeric" pattern="[0-9]*" maxLength="6" value={seniorPin} onChange={(event) => setSeniorPin(event.target.value.replace(/\D/g, '').slice(0, 6))} required /></label>
          <div className="senior-keypad" aria-label="PIN keypad">{['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '←'].map((digit, index) => <button type="button" key={`pin-key-${index}`} disabled={!digit} aria-label={digit === '←' ? 'Delete last PIN digit' : digit ? `Enter ${digit}` : 'Empty'} onClick={() => setSeniorPin((current) => digit === '←' ? current.slice(0, -1) : `${current}${digit}`.slice(0, 6))}>{digit}</button>)}</div>
          <div className="switch-row form-switch" style={{ marginBottom: '1rem' }}>
            <span><strong>Trust this device</strong><small>Keep Senior Mode easy on this device</small></span>
            <input type="checkbox" checked={trustThisDevice} onChange={(event) => setTrustThisDevice(event.target.checked)} />
          </div>
          {error && <div className="toast toast-error" role="alert">{error}</div>}{success && <div className="toast toast-success" role="status">{success}</div>}
          <button className="button button-primary auth-submit" type="submit" disabled={loading}>{loading ? 'Checking PIN…' : 'Continue'}</button>
        </form>
      </section>
    </main>;
  }

  if (!token) {
    return <main className="auth-shell"><section className="auth-card">
      <div className="brand-lockup"><span className="brand-mark">M</span><span>MedReminder</span></div>
      <p className="eyebrow">YOUR CARE, IN RHYTHM</p><h1>{authMode === 'login' ? 'Welcome back.' : 'Start your care plan.'}</h1>
      <p className="auth-intro">A calmer way to stay close to your daily medicines.</p>
      <div className="auth-tabs" role="tablist" aria-label="Account access"><button type="button" className={authMode === 'login' ? 'selected' : ''} onClick={() => setAuthMode('login')}>Sign in</button><button type="button" className={authMode === 'register' ? 'selected' : ''} onClick={() => setAuthMode('register')}>Create account</button><button type="button" className={seniorLoginMode ? 'selected' : ''} onClick={() => { setSeniorLoginMode(true); setError(''); setSuccess(''); }}>Senior Mode</button></div>
      <form className="auth-form" onSubmit={handleAuth}>
        {authMode === 'register' && <label className="form-field">Full name<input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} required /></label>}
        <label className="form-field">Email<input type="email" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} required /></label>
        <label className="form-field">Password<input type="password" value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} required /></label>
        {error && <div className="toast toast-error" role="alert">{error}</div>}{success && <div className="toast toast-success" role="status">{success}</div>}
        <button className="button button-primary auth-submit" type="submit" disabled={loading}>{loading ? 'Please wait…' : authMode === 'login' ? 'Sign in' : 'Create account'}</button>
      </form><p className="auth-footnote">Your health information stays connected to your private account.</p>
    </section></main>;
  }

  const currentDate = new Date();
  const navigation = user?.role === 'senior'
    ? [{ label: 'Overview', glyph: '⌂' }, { label: 'My medicines', glyph: '✳' }, { label: 'History', glyph: '↺' }, { label: 'Help', glyph: '?' }]
    : [{ label: 'Overview', glyph: '◫' }, { label: 'Patients', glyph: '♧' }, { label: 'My medicines', glyph: '✳' }, { label: 'Schedule', glyph: '◷' }, { label: 'History', glyph: '↺' }];
  const filteredHistory = history.filter((entry) => entry.status !== 'PENDING' && (historyFilter === 'ALL' || entry.status === historyFilter)).sort((first, second) => {
    const firstDate = first.scheduledDate || getCalendarDateKey(first.doseDate);
    const secondDate = second.scheduledDate || getCalendarDateKey(second.doseDate);
    return secondDate.localeCompare(firstDate) || second.scheduledTime.localeCompare(first.scheduledTime);
  });

  const renderDoseRow = (dose, showActions = true) => (
    <article className={`dose-row dose-${dose.status.toLowerCase()}`} key={`${dose.medicine._id}|${dose.dateKey}|${dose.scheduledTime}`}>
      <span className="dose-icon" aria-hidden="true">✳</span><div className="dose-time">{formatTime(dose.scheduledDateTime)}</div>
      <div className="dose-detail"><strong>{dose.medicine.name}</strong><span>{dose.medicine.dosage || 'Dose not specified'}</span></div>
      <span className={`status-pill status-${dose.status.toLowerCase()}`}>{getStatusLabel(dose.status)}</span>
      {dose.status === 'PENDING' && showActions && dose.timingStatus !== 'UPCOMING' && <div className="dose-actions">{(dose.timingStatus === 'MISSED' ? ['TAKEN', 'SKIPPED', 'MISSED'] : ['TAKEN', 'SKIPPED']).map((status) => <button type="button" key={status} className={`dose-action action-${status.toLowerCase()}`} disabled={pendingDose === `${dose.medicine._id}|${dose.dateKey}|${dose.scheduledTime}`} aria-label={`${getStatusLabel(status)} ${dose.medicine.name} at ${formatTime(dose.scheduledDateTime)}`} onClick={() => markDoseStatus(dose, status)}>{status === 'TAKEN' ? '✓ Taken' : status === 'SKIPPED' ? '↪ Skip' : '⚠ Missed'}</button>)}</div>}
      {dose.status === 'SNOOZED' && <span className="dose-action-time">Reminder again at {formatTime(dose.snoozeUntil)}</span>}
      {dose.status !== 'PENDING' && ['TAKEN', 'SKIPPED', 'MISSED'].includes(dose.status) && (dose.historyEntry?.actionTime || dose.historyEntry?.takenAt) && <span className="dose-action-time">{getStatusLabel(dose.status)} at {formatTime(new Date(dose.historyEntry.actionTime || dose.historyEntry.takenAt))}</span>}
    </article>
  );

  return <div className={`app-shell ${user?.role === 'senior' ? 'senior-mode' : ''}`}>
    <aside className="sidebar">
      <button className="brand-lockup sidebar-brand" type="button" onClick={() => setPage('Overview')}><span className="brand-mark">M</span><span>MedReminder</span></button>
      <span className="sidebar-label">{user?.role === 'senior' ? 'TODAY' : 'WORKSPACE'}</span>
      <nav className="primary-nav" aria-label="Main navigation">{navigation.map((item) => <button key={item.label} className={`nav-link ${page === item.label ? 'active' : ''}`} type="button" onClick={() => setPage(item.label)}><span className="nav-glyph" aria-hidden="true">{item.glyph}</span>{item.label}</button>)}</nav>
      {user?.role !== 'senior' && <div className="privacy-note"><span className="privacy-symbol" aria-hidden="true">+</span><strong>Your health, kept private</strong><p>Your care plan is visible only to you.</p></div>}
      <span className="sidebar-label account-label">ACCOUNT</span>
      <nav className="account-nav" aria-label="Account navigation">{user?.role !== 'senior' && <><button className={`nav-link ${page === 'Profile' ? 'active' : ''}`} type="button" onClick={() => setPage('Profile')}><span className="nav-glyph">○</span>Profile</button><button className={`nav-link ${page === 'Settings' ? 'active' : ''}`} type="button" onClick={() => setPage('Settings')}><span className="nav-glyph">⚙</span>Settings</button></>}<button className="nav-link signout-link" type="button" onClick={logout}><span className="nav-glyph">↪</span>Sign out</button></nav>
      <div className="sidebar-user"><span className="avatar">{initials(user?.name)}</span><span className="sidebar-user-copy"><strong>{user?.name || 'User'}</strong><small>{user?.email || ''}</small></span></div>
    </aside>

    <div className="main-shell">
      <header className="top-header"><div className="breadcrumbs"><span>MedReminder</span><span className="breadcrumb-separator">/</span><strong>{page}</strong></div><div className="header-tools"><span className="header-date">{formatDate(currentDate)}</span><div className="notification-wrap"><button className="icon-button notification-button" type="button" aria-label={`Notifications, ${reminderCount} doses remaining`} aria-expanded={notificationsOpen} onClick={() => setNotificationsOpen((open) => !open)}>♧{reminderCount > 0 && <span className="notification-dot" />}</button>{notificationsOpen && <div className="notification-popover"><strong>Today’s reminders</strong><p>{reminderCount ? `${reminderCount} dose${reminderCount === 1 ? '' : 's'} still need attention.` : 'You are all caught up for now.'}</p><button className="text-button" type="button" onClick={() => { setPage('Schedule'); setNotificationsOpen(false); }}>View schedule</button></div>}</div><button className="avatar header-avatar" type="button" aria-label="Open profile" onClick={() => setPage('Profile')}>{initials(user?.name)}</button></div></header>

      <main className="page-content">
        {(error || success) && <div className={`toast page-toast ${error ? 'toast-error' : 'toast-success'}`} role={error ? 'alert' : 'status'}>{error || success}<button type="button" aria-label="Dismiss message" onClick={() => { setError(''); setSuccess(''); }}>×</button></div>}

        {page === 'Overview' && <>
          <section className="welcome-row"><div><span className="eyebrow">{formatDate(currentDate, { month: 'long', day: 'numeric', year: 'numeric' })}</span><h1>{greeting()}, {user?.name?.split(' ')[0] || 'there'}{user?.role === 'senior' ? ' 👋' : '.'}</h1><p>{user?.role === 'senior' ? 'Here are your medicines for today.' : 'A little consistency goes a long way. Here’s your plan for today.'}</p></div>{user?.role !== 'senior' && <button className="button button-primary add-medicine-button" type="button" onClick={openNewMedicine}><span aria-hidden="true">+</span> Add medicine</button>}</section>
          <section className="summary-grid" aria-label="Today at a glance"><article className="summary-card summary-total"><span>Today’s doses</span><strong>{todayDoses.length.toString().padStart(2, '0')}</strong><small>Scheduled for today</small></article><article className="summary-card"><span>Total medicines</span><strong>{medicines.length.toString().padStart(2, '0')}</strong><small>In your care plan</small></article><article className="summary-card"><span>Taken</span><strong>{todayCounts.taken.toString().padStart(2, '0')}</strong><small>You’re keeping your rhythm</small></article><article className="summary-card"><span>Skipped</span><strong>{todayCounts.skipped.toString().padStart(2, '0')}</strong><small>Doses skipped today</small></article><article className="summary-card"><span>Missed</span><strong>{todayCounts.missed.toString().padStart(2, '0')}</strong><small>We’ll keep you on track</small></article></section>
          <div className="overview-grid"><section className="content-section today-section"><div className="section-heading"><div><span className="eyebrow">YOUR ROUTINE</span><h2>Today’s medicines</h2></div><button className="text-button" type="button" onClick={() => setPage('Schedule')}>Full schedule <span aria-hidden="true">→</span></button></div>{todayDoses.length ? <div className="dose-list">{todayDoses.map((dose) => renderDoseRow(dose))}</div> : <div className="empty-state"><span className="empty-mark">+</span><strong>Your day is clear.</strong><p>Add a medicine to build your daily plan.</p><button className="button button-quiet" type="button" onClick={openNewMedicine}>Add your first medicine</button></div>}</section>
            <aside className="overview-aside"><section className="up-next-panel"><span className="eyebrow">UP NEXT</span>{nextDose ? <><strong className="up-next-time">{formatTime(nextDose.scheduledDateTime)}</strong><h2>{nextDose.medicine.name}</h2><p>{nextDose.medicine.dosage || 'Dose not specified'}</p><span className="up-next-date">Today · {nextDose.scheduledTime}</span><button className="next-dose-link" type="button" onClick={() => { setPage('Schedule'); setSelectedDate(nextDose.dateKey); }}>Open schedule <span aria-hidden="true">↗</span></button></> : <><h2 className="caught-up-title">All caught up</h2><p>No upcoming doses today.</p>{nextOccurrence && <p className="next-occurrence-note">Next dose: {formatDate(nextOccurrence.scheduledDate, { weekday: 'long', month: 'short', day: 'numeric' })} at {formatTime(nextOccurrence.scheduledDateTime)}</p>}</>}<div className="up-next-watermark" aria-hidden="true">✳</div></section>
              <section className="adherence-panel"><div className="section-heading compact-heading"><div><span className="eyebrow">ALL-TIME ADHERENCE</span><h2>Your rhythm</h2></div><span className="adherence-percent">{adherence}%</span></div><div className="adherence-track"><span style={{ width: `${adherence}%` }} /></div><p>{takenCount} taken of {completedCount} completed dose{completedCount === 1 ? '' : 's'}</p></section>
              <section className="reminder-callout"><span className="reminder-icon" aria-hidden="true">◷</span><div><strong>{remindersEnabled ? 'Reminders are on' : 'A gentle nudge helps'}</strong><p>{remindersEnabled ? 'We’ll remind you while the app is open.' : 'Turn on browser reminders for your schedule.'}</p></div><button className="text-button" type="button" onClick={toggleReminders}>{remindersEnabled ? 'Pause' : 'Enable'}</button></section></aside></div>
        </>}

        {page === 'My medicines' && <section className="page-section"><div className="page-title-row"><div><span className="eyebrow">YOUR CARE PLAN</span><h1>{selectedPatient && user?.role === 'caregiver' ? `${selectedPatient.name}’s medicines` : 'My medicines'}</h1><p>Keep your medicines and schedules in one place.</p></div><div className="medicine-card-actions">{selectedPatient && user?.role === 'caregiver' && <button className="button button-quiet" type="button" onClick={stopManagingPatient}>Back to patients</button>}{user?.role !== 'senior' && <><button className="button button-quiet" type="button" onClick={startVoiceMedicineEntry}>🎤 Speak to add</button><button className="button button-quiet" type="button" onClick={() => setError('Photo scanning is not configured. No OCR provider is connected, so nothing was extracted or saved.')}>📷 Scan medicine</button><button className="button button-primary" type="button" onClick={openNewMedicine}><span aria-hidden="true">+</span> Add medicine</button></>}</div></div>{voiceUnavailable && <p className="toast toast-error" role="status">Voice recognition is not supported in this browser. You can still add medicine details manually.</p>}{medicines.length ? <div className="medicine-grid">{medicines.map((medicine) => <article className="medicine-card" key={medicine._id}><div className="medicine-card-top"><span className="medicine-symbol" aria-hidden="true">✳</span><span className={`status-pill ${medicine.active ? 'status-taken' : 'status-inactive'}`}>{medicine.active ? 'Active' : 'Inactive'}</span></div><h2>{medicine.name}</h2><p className="medicine-dosage">{medicine.dosage || 'Dose not specified'} · {medicine.frequency || 'Daily'}</p><dl className="medicine-facts"><div><dt>Schedule</dt><dd>{getMedicineTimes(medicine).map((time) => formatTime(createScheduledDateTime(todayKey, time))).join(' · ')}</dd></div><div><dt>Start date</dt><dd>{medicine.startDate ? formatDate(dateFromKey(getCalendarDateKey(medicine.startDate)), { month: 'short', day: 'numeric', year: 'numeric' }) : 'Ongoing'}</dd></div><div><dt>End date</dt><dd>{medicine.endDate ? formatDate(dateFromKey(getCalendarDateKey(medicine.endDate)), { month: 'short', day: 'numeric', year: 'numeric' }) : 'No end date'}</dd></div><div><dt>Quantity left</dt><dd>{medicine.remainingQuantity ?? medicine.quantity ?? 0}</dd></div></dl><p className="medicine-instructions">{medicine.instructions || 'No instructions added.'}</p><div className="medicine-card-actions">{user?.role !== 'senior' && <><button className="button button-quiet" type="button" onClick={() => editMedicine(medicine)}>Edit</button><button className="button button-danger-quiet" type="button" onClick={() => deleteMedicine(medicine)}>Delete</button></>}</div></article>)}</div> : <div className="empty-state page-empty"><span className="empty-mark">+</span><strong>No medicines scheduled yet.</strong><p>{user?.role === 'senior' ? 'Ask your caregiver to add a medicine.' : 'Add your first medicine and its daily schedule.'}</p>{user?.role !== 'senior' && <button className="button button-primary" type="button" onClick={openNewMedicine}>Add medicine</button>}</div>}</section>}

        {page === 'Patients' && <section className="page-section"><div className="page-title-row"><div><span className="eyebrow">CAREGIVER</span><h1>Patients</h1><p>Create a senior profile and keep an eye on their medicine routine.</p></div></div><section className="settings-section"><div className="settings-section-heading"><div><h2>Add a senior profile</h2><p>Set a private PIN. It is hashed before storage.</p></div></div><form className="medicine-form" onSubmit={createSenior}><div className="form-columns"><label className="form-field">Senior name<input value={patientForm.name} onChange={(event) => setPatientForm((current) => ({ ...current, name: event.target.value }))} required /></label><label className="form-field">Senior email<input type="email" value={patientForm.email} onChange={(event) => setPatientForm((current) => ({ ...current, email: event.target.value }))} required /></label></div><div className="form-columns"><label className="form-field">Phone (optional)<input value={patientForm.phone} onChange={(event) => setPatientForm((current) => ({ ...current, phone: event.target.value }))} /></label><label className="form-field">4–6 digit PIN<input type="password" inputMode="numeric" maxLength="6" value={patientForm.pin} onChange={(event) => setPatientForm((current) => ({ ...current, pin: event.target.value.replace(/\\D/g, '').slice(0, 6) }))} required /></label></div><button className="button button-primary" type="submit" disabled={loading}>{loading ? 'Creating…' : 'Create senior profile'}</button></form></section><div className="section-heading"><h2>Your seniors</h2></div>{patients.length ? <div className="medicine-grid">{patients.map((patient) => <article className="medicine-card" key={patient._id}><div className="medicine-card-top"><span className="medicine-symbol" aria-hidden="true">👵</span><span className="status-pill status-taken">Active</span></div><h2>{patient.name}</h2><p className="medicine-dosage">{patient.email}</p><div className="medicine-card-actions"><button className="button button-primary" type="button" onClick={() => openPatientDashboard(patient)}>Monitor</button><button className="button button-quiet" type="button" onClick={() => managePatientMedicines(patient)}>Manage medicines</button></div></article>)}</div> : <div className="empty-state"><strong>No senior profiles yet.</strong><p>Create a profile above to manage medicine schedules and monitor adherence.</p></div>}</section>}

        {page === 'Patient dashboard' && <section className="page-section"><div className="page-title-row"><div><span className="eyebrow">CAREGIVER MONITORING</span><h1>{patientDashboard?.senior?.name || selectedPatient?.name || 'Patient dashboard'}</h1><p>Today’s doses, adherence, stock and recent dose history.</p></div><div className="medicine-card-actions"><button type="button" className="button button-quiet" onClick={() => setPage('Patients')}>Back to patients</button><button type="button" className="button button-quiet" onClick={resetPatientPin}>Reset senior PIN</button></div></div>{loading && !patientDashboard ? <p role="status">Loading patient dashboard…</p> : patientDashboard && <><section className="summary-grid"><article className="summary-card summary-total"><span>Today’s adherence</span><strong>{patientDashboard.adherence}%</strong></article><article className="summary-card"><span>Taken</span><strong>{patientDashboard.counts.taken}</strong></article><article className="summary-card"><span>Skipped</span><strong>{patientDashboard.counts.skipped}</strong></article><article className="summary-card"><span>Missed</span><strong>{patientDashboard.counts.missed}</strong></article><article className="summary-card"><span>Upcoming</span><strong>{patientDashboard.counts.upcoming}</strong></article></section><div className="adherence-track"><span style={{ width: `${patientDashboard.adherence}%` }} /></div><section className="content-section today-section"><div className="section-heading"><h2>Today’s doses</h2><button className="text-button" type="button" onClick={() => openPatientDashboard(selectedPatient)}>Refresh</button></div>{patientDashboard.doses.length ? <div className="dose-list">{patientDashboard.doses.map((dose) => <article className={`dose-row dose-${dose.status.toLowerCase()}`} key={dose._id}><span className="dose-icon" aria-hidden="true">💊</span><div className="dose-time">{dose.scheduledTime}</div><div className="dose-detail"><strong>{dose.medicineName}</strong><span>{dose.dosage}</span></div><span className={`status-pill status-${dose.status.toLowerCase()}`}>{getStatusLabel(dose.status)}</span></article>)}</div> : <p>No doses scheduled today.</p>}</section>{patientDashboard.lowStock.length > 0 && <section className="settings-section"><h2>Low stock</h2>{patientDashboard.lowStock.map((medicine) => <p key={medicine._id}>⚠ {medicine.name}: {medicine.remainingQuantity} remaining</p>)}</section>}<section className="settings-section"><h2>Missed-dose alerts</h2>{patientDashboard.doses.filter((dose) => dose.status === 'MISSED').length ? patientDashboard.doses.filter((dose) => dose.status === 'MISSED').map((dose) => <p key={dose._id}>⚠ Missed {dose.medicineName} at {dose.scheduledTime}</p>) : <p>No missed doses today.</p>}</section></>}</section>}

        {page === 'Patient dashboard' && <section className="settings-section"><div className="settings-section-heading"><div><h2>Reports</h2><p>Real dose records for the selected period.</p></div><select aria-label="Report period" value={reportPeriod} onChange={(event) => loadPatientReport(event.target.value)}><option value="today">Today</option><option value="week">This week</option><option value="month">This month</option></select></div>{patientReport && <div className="summary-grid"><article className="summary-card summary-total"><span>Adherence</span><strong>{patientReport.adherence}%</strong><small>{patientReport.startDate} – {patientReport.endDate}</small></article><article className="summary-card"><span>Taken</span><strong>{patientReport.counts.taken}</strong></article><article className="summary-card"><span>Skipped</span><strong>{patientReport.counts.skipped}</strong></article><article className="summary-card"><span>Missed</span><strong>{patientReport.counts.missed}</strong></article></div>}</section>}
        {page === 'Patient dashboard' && <section className="settings-section"><h2>Recent missed-dose alerts</h2>{patientAlerts.length ? patientAlerts.map((alert) => <p key={alert._id}>⚠ {alert.medicineName} · {alert.scheduledDate} at {alert.scheduledTime}</p>) : <p>No missed-dose alerts.</p>}</section>}
        {page === 'Patient dashboard' && patientDashboard && <section className="settings-section"><h2>Correct a dose status</h2><p>Corrections are recorded with caregiver, time, previous status, new status and reason.</p>{patientDashboard.doses.filter((dose) => ['TAKEN', 'SKIPPED', 'MISSED'].includes(dose.status)).map((dose) => <div className="settings-row" key={`correction-${dose._id}`}><div><strong>{dose.medicineName}</strong><p>{dose.scheduledTime} · {getStatusLabel(dose.status)}</p></div><button className="button button-quiet" type="button" onClick={() => { setOverrideTarget(dose); setOverrideForm({ newStatus: dose.status, reason: '' }); }}>Correct status</button></div>)}</section>}
        {page === 'Patient dashboard' && <section className="settings-section"><h2>Trusted devices</h2>{patientDevices.length ? patientDevices.map((device) => <div className="settings-row" key={device._id}><div><strong>{device.deviceName}</strong><p>Last used {device.lastSeenAt ? formatDate(new Date(device.lastSeenAt), { month: 'short', day: 'numeric', year: 'numeric' }) : 'unknown'}</p></div><button className="button button-danger-quiet" type="button" onClick={() => revokePatientDevice(device._id)}>Revoke</button></div>) : <p>No trusted devices.</p>}</section>}

        {page === 'Help' && <section className="page-section senior-help"><div className="page-title-row"><div><span className="eyebrow">HELP</span><h1>Need a hand?</h1><p>You can ask your caregiver for help with your medicine plan.</p></div></div>{user?.caregiverPhone ? <a className="button button-primary" href={`tel:${user.caregiverPhone}`}>Call {user.caregiverName || 'your caregiver'}</a> : <p>Ask your caregiver to add their phone number to your profile.</p>}</section>}

        {page === 'Schedule' && <section className="page-section"><div className="page-title-row"><div><span className="eyebrow">DAILY PLAN</span><h1>Schedule</h1><p>Upcoming doses, one day at a time.</p></div><div className="date-navigation"><button className="icon-button" type="button" aria-label="Previous day" onClick={() => setSelectedDate(getLocalDateKey(addCalendarDays(dateFromKey(selectedDate), -1)))}>‹</button><input type="date" aria-label="Choose schedule date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} /><button className="icon-button" type="button" aria-label="Next day" onClick={() => setSelectedDate(getLocalDateKey(addCalendarDays(dateFromKey(selectedDate), 1)))}>›</button><button className="button button-quiet" type="button" onClick={() => setSelectedDate(todayKey)}>Today</button></div></div><div className="schedule-days">{[0, 1, 2].map((offset) => { const day = addCalendarDays(dateFromKey(selectedDate), offset); const dayKey = getLocalDateKey(day); const doses = getDailyDoses(medicines, history, dayKey); return <section className="schedule-day" key={dayKey}><div className="schedule-day-heading"><div><span className="eyebrow">{dayKey === todayKey ? 'TODAY' : offset === 1 && dayKey === getLocalDateKey(addCalendarDays(new Date(), 1)) ? 'TOMORROW' : formatDate(day, { weekday: 'long' }).toUpperCase()}</span><h2>{formatDate(day, { month: 'long', day: 'numeric' })}</h2></div><span>{doses.length} dose{doses.length === 1 ? '' : 's'}</span></div>{doses.length ? <div className="dose-list">{doses.map((dose) => renderDoseRow(dose, dayKey === todayKey))}</div> : <p className="day-empty">No scheduled medicines for this day.</p>}</section>; })}</div></section>}

        {page === 'History' && <section className="page-section"><div className="page-title-row"><div><span className="eyebrow">YOUR DOSE LOG</span><h1>History</h1><p>A record of the doses you’ve handled.</p></div></div><div className="filter-tabs" role="group" aria-label="Filter history">{['ALL', 'TAKEN', 'SKIPPED', 'MISSED'].map((filter) => <button type="button" key={filter} className={historyFilter === filter ? 'selected' : ''} onClick={() => setHistoryFilter(filter)}>{filter === 'ALL' ? 'All' : getStatusLabel(filter)}</button>)}</div>{filteredHistory.length ? <div className="history-table-wrap"><table className="history-table"><thead><tr><th>Date</th><th>Time</th><th>Medicine</th><th>Dosage</th><th>Status</th></tr></thead><tbody>{filteredHistory.map((entry) => { const entryDate = entry.scheduledDate || getCalendarDateKey(entry.doseDate); return <tr key={`${entry.medicine}-${entryDate}-${entry.scheduledTime}`}><td>{formatDate(dateFromKey(entryDate), { month: 'long', day: 'numeric', year: 'numeric' })}</td><td>{entry.scheduledTime ? formatTime(createScheduledDateTime(entryDate, entry.scheduledTime)) : '—'}</td><td><strong>{entry.medicineName || 'Medicine'}</strong></td><td>{entry.dosage || '—'}</td><td><span className={`status-pill status-${entry.status.toLowerCase()}`}>{getStatusLabel(entry.status)}</span></td></tr>; })}</tbody></table></div> : <div className="empty-state page-empty"><strong>No doses to show.</strong><p>Handled doses will appear here.</p></div>}</section>}

        {page === 'Profile' && <section className="page-section settings-page"><div className="page-title-row"><div><span className="eyebrow">ACCOUNT</span><h1>Profile</h1><p>Your account details.</p></div></div><section className="settings-section profile-section"><span className="avatar profile-avatar">{initials(user?.name)}</span><div className="profile-fields"><label className="form-field">Name<input value={user?.name || ''} readOnly /></label><label className="form-field">Email<input value={user?.email || ''} readOnly /></label></div><p>Profile editing isn’t available for this account yet.</p></section></section>}

        {page === 'Settings' && <section className="settings-section"><div className="settings-row"><div><strong>Voice guidance</strong><p>Speak medicine reminders and dose confirmations when supported.</p></div><button className={`switch ${voiceGuidance ? 'on' : ''}`} type="button" role="switch" aria-checked={voiceGuidance} onClick={() => { const enabled = !voiceGuidance; localStorage.setItem('medreminder_voice_guidance', String(enabled)); setVoiceGuidance(enabled); if (enabled) speak('Voice guidance enabled.'); }}><span /></button></div></section>}

        {page === 'Settings' && <section className="page-section settings-page"><div className="page-title-row"><div><span className="eyebrow">PREFERENCES</span><h1>Settings</h1><p>Choose how MedReminder keeps you in the loop.</p></div></div><section className="settings-section"><div className="settings-section-heading"><span className="settings-mark">◷</span><div><h2>Reminders</h2><p>{pushStatus === 'subscribed' ? 'Background push is active for this device.' : 'App-open browser reminders are available; background push may require server keys.'}</p></div></div><div className="settings-row"><div><strong>Browser notifications</strong><p>Show a reminder when a dose is due.</p></div><button className={`switch ${remindersEnabled ? 'on' : ''}`} type="button" role="switch" aria-checked={remindersEnabled} onClick={toggleReminders}><span /></button></div><div className="settings-row"><div><strong>Reminder sound</strong><p>Play a brief tone with browser reminders.</p></div><button className={`switch ${soundEnabled ? 'on' : ''}`} type="button" role="switch" aria-checked={soundEnabled} onClick={() => toggleSound(!soundEnabled)}><span /></button></div><div className="settings-row"><div><strong>Repeat alarm</strong><p>Keep ringing until the medicine is resolved.</p></div><button className={`switch ${alarmRepeating ? 'on' : ''}`} type="button" role="switch" aria-checked={alarmRepeating} onClick={() => { localStorage.setItem('medreminder_alarm_repeat', String(!alarmRepeating)); setAlarmRepeating((current) => !current); }}><span /></button></div><div className="settings-row"><div><strong>Alarm volume</strong><p>Volume for sound reminder.</p></div><input type="range" min="0.1" max="1" step="0.05" value={alarmVolume} onChange={(event) => { const next = Number(event.target.value); localStorage.setItem('medreminder_alarm_volume', String(next)); setAlarmVolume(next); }} /></div><div className="settings-row"><div><strong>Alarm duration</strong><p>How long each reminder tone lasts.</p></div><input type="range" min="2" max="20" step="1" value={alarmDuration} onChange={(event) => { const next = Number(event.target.value); localStorage.setItem('medreminder_alarm_duration', String(next)); setAlarmDuration(next); }} /></div><div className="settings-row settings-inline-action"><div><strong>Test alarm</strong><p>Preview the reminder tone.</p></div><button className="button button-quiet" type="button" onClick={() => playAlarm(alarmRepeating)}>Test Alarm</button></div><div className="permission-status"><span className={`permission-dot permission-${notificationPermission}`} />Notification permission <strong>{notificationPermission}</strong>{notificationPermission !== 'granted' && <button className="text-button" type="button" onClick={requestNotificationPermission}>Enable Notifications</button>}</div></section>
        <section className="settings-section"><div className="settings-section-heading"><span className="settings-mark">☰</span><div><h2>Caregiver support</h2><p>Optional contact details for family or caregivers.</p></div></div><form className="caregiver-form" onSubmit={saveCaregiver}><div className="form-columns"><label className="form-field">Caregiver name<input value={caregiver.name} onChange={(event) => setCaregiver((current) => ({ ...current, name: event.target.value }))} /></label><label className="form-field">Phone<input value={caregiver.phone} onChange={(event) => setCaregiver((current) => ({ ...current, phone: event.target.value }))} /></label></div><label className="form-field">Email<input type="email" value={caregiver.email} onChange={(event) => setCaregiver((current) => ({ ...current, email: event.target.value }))} /></label><button className="button button-primary" type="submit">Save caregiver</button></form></section></section>}

        {page === 'Profile' && <section className="page-section"><div className="page-title-row"><div><span className="eyebrow">YOUR ACCOUNT</span><h1>Profile</h1><p>Keep your care details organized.</p></div></div><section className="settings-section"><div className="profile-summary"><div className="avatar profile-avatar">{initials(user?.name)}</div><div><strong>{user?.name || 'User'}</strong><p>{user?.email || ''}</p></div></div><dl className="profile-list"><div><dt>Caregiver</dt><dd>{caregiver.name || 'No caregiver saved yet'}</dd></div><div><dt>Phone</dt><dd>{caregiver.phone || 'Not added'}</dd></div><div><dt>Email</dt><dd>{caregiver.email || 'Not added'}</dd></div></dl><button className="button button-primary" type="button" onClick={() => setPage('Settings')}>Edit preferences</button></section></section>}
      </main>
    </div>

    {reminderAlert && <div className="modal-backdrop reminder-backdrop" role="presentation"><section className="medicine-dialog reminder-dialog" role="alertdialog" aria-modal="true" aria-labelledby="reminder-title"><p className="eyebrow">MEDICINE TIME</p><h2 id="reminder-title">💊 {reminderAlert.dose.medicine.name}</h2><p>{reminderAlert.dose.medicine.dosage || 'It is time to take your medicine.'}</p><p>Scheduled for {formatTime(reminderAlert.dose.scheduledDateTime)}</p><div className="reminder-dialog-actions"><button className="button button-primary" type="button" onClick={() => markDoseStatus(reminderAlert.dose, 'TAKEN')}>✓ Taken</button><button className="button button-quiet" type="button" onClick={() => markDoseStatus(reminderAlert.dose, 'SKIPPED')}>Skip</button><div className="snooze-options"><span>Snooze for</span>{[5, 10, 15].map((minutes) => <button className="button button-quiet" type="button" key={minutes} onClick={() => snoozeDose(reminderAlert.dose, minutes)}>{minutes} min</button>)}</div><button className="text-button" type="button" onClick={dismissReminder}>Dismiss alarm</button></div></section></div>}
    {overrideTarget && <div className="modal-backdrop" role="presentation"><section className="medicine-dialog" role="dialog" aria-modal="true" aria-labelledby="override-title"><div className="dialog-heading"><h2 id="override-title">Correct dose status</h2><button className="icon-button close-button" type="button" aria-label="Cancel correction" onClick={() => setOverrideTarget(null)}>×</button></div><p>{overrideTarget.medicineName} · {overrideTarget.scheduledDate} {overrideTarget.scheduledTime}</p><form className="medicine-form" onSubmit={submitDoseOverride}><label className="form-field">New status<select value={overrideForm.newStatus} onChange={(event) => setOverrideForm((current) => ({ ...current, newStatus: event.target.value }))}><option value="TAKEN">Taken</option><option value="SKIPPED">Skipped</option><option value="MISSED">Missed</option></select></label><label className="form-field">Reason for correction<textarea rows="3" value={overrideForm.reason} onChange={(event) => setOverrideForm((current) => ({ ...current, reason: event.target.value }))} required maxLength={500} /></label><div className="dialog-actions"><button className="button button-quiet" type="button" onClick={() => setOverrideTarget(null)}>Cancel</button><button className="button button-primary" type="submit">Confirm correction</button></div></form></section></div>}
    {medicineDialogOpen && <MedicineDialog form={medicineForm} setForm={setMedicineForm} editing={Boolean(editingMedicine)} loading={loading} onClose={() => setMedicineDialogOpen(false)} onSubmit={saveMedicine} />}
    <nav className="mobile-nav" aria-label="Mobile navigation">{navigation.map((item) => <button type="button" key={item.label} className={page === item.label ? 'active' : ''} onClick={() => setPage(item.label)}><span aria-hidden="true">{item.glyph}</span><small>{item.label}</small></button>)}<button type="button" className={page === 'Settings' ? 'active' : ''} onClick={() => setPage('Settings')}><span aria-hidden="true">⚙</span><small>Settings</small></button></nav>
  </div>;
}

export default App;
