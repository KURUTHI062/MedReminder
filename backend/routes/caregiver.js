const express = require('express');
const protect = require('../middleware/auth');
const {
  createSeniorProfile,
  listSeniorProfiles,
  resetSeniorPin,
  getSeniorDashboard,
  getSeniorAlerts,
  getSeniorReport,
  overrideDoseStatus,
  listTrustedDevices,
  revokeTrustedDevice,
} = require('../controllers/seniorController');

const router = express.Router();

router.use(protect);
router.get('/patients', listSeniorProfiles);
router.post('/patients', createSeniorProfile);
router.get('/patients/:seniorId/dashboard', getSeniorDashboard);
router.get('/patients/:seniorId/alerts', getSeniorAlerts);
router.get('/patients/:seniorId/reports', getSeniorReport);
router.post('/patients/:seniorId/doses/:doseId/override', overrideDoseStatus);
router.post('/patients/:seniorId/pin', resetSeniorPin);
router.get('/patients/:seniorId/devices', listTrustedDevices);
router.delete('/patients/:seniorId/devices/:deviceId', revokeTrustedDevice);

module.exports = router;
