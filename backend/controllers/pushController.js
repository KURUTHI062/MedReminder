const PushSubscription = require('../models/PushSubscription');
const { getVapidConfig } = require('../services/pushService');

exports.getVapidPublicKey = (req, res) => {
  const config = getVapidConfig();
  if (!config) {
    return res.status(503).json({ message: 'Background push is not configured on this server.' });
  }
  return res.json({ publicKey: config.publicKey });
};

exports.savePushSubscription = async (req, res) => {
  const subscription = req.body;
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    return res.status(400).json({ message: 'A valid browser push subscription is required.' });
  }
  try {
    const saved = await PushSubscription.findOneAndUpdate(
      { endpoint: subscription.endpoint },
      {
        $set: {
          user: req.user._id,
          endpoint: subscription.endpoint,
          keys: {
            p256dh: subscription.keys.p256dh,
            auth: subscription.keys.auth,
          },
          expirationTime: subscription.expirationTime ? new Date(subscription.expirationTime) : null,
          lastUsedAt: new Date(),
        },
      },
      { upsert: true, new: true, runValidators: true }
    );
    return res.status(201).json({ success: true, subscriptionId: saved._id });
  } catch (error) {
    console.error('Push subscription save failed:', error);
    return res.status(500).json({ message: 'Unable to save browser push subscription.' });
  }
};

exports.deletePushSubscription = async (req, res) => {
  try {
    await PushSubscription.deleteOne({ _id: req.params.subscriptionId, user: req.user._id });
    return res.json({ success: true });
  } catch (error) {
    console.error('Push subscription removal failed:', error);
    return res.status(500).json({ message: 'Unable to remove browser push subscription.' });
  }
};
