const express = require('express');
const protect = require('../middleware/auth');
const {
  getVapidPublicKey,
  savePushSubscription,
  deletePushSubscription,
} = require('../controllers/pushController');

const router = express.Router();

router.get('/vapid-public-key', getVapidPublicKey);
router.post('/subscriptions', protect, savePushSubscription);
router.delete('/subscriptions/:subscriptionId', protect, deletePushSubscription);

module.exports = router;
