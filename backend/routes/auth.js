const express = require('express');
const { registerUser, loginUser, getMe, updateMe } = require('../controllers/authController');
const {
  loginSeniorPin,
  loginTrustedDevice,
  listTrustedDevices,
  revokeTrustedDevice,
} = require('../controllers/seniorController');
const protect = require('../middleware/auth');
const seniorPinRateLimit = require('../middleware/seniorPinRateLimit');

const router = express.Router();

router.post('/register', registerUser);
router.post('/login', loginUser);
router.post('/senior-pin/login', seniorPinRateLimit, loginSeniorPin);
router.post('/senior-pin/trusted-login', loginTrustedDevice);
router.get('/senior-pin/devices', protect, listTrustedDevices);
router.delete('/senior-pin/devices/:deviceId', protect, revokeTrustedDevice);
router.get('/me', protect, getMe);
router.put('/me', protect, updateMe);

module.exports = router;
