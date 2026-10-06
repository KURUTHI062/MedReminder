const webpush = require('web-push');
const PushSubscription = require('../models/PushSubscription');

const getVapidConfig = () => {
  const { WEB_PUSH_PUBLIC_KEY, WEB_PUSH_PRIVATE_KEY, WEB_PUSH_SUBJECT } = process.env;
  if (!WEB_PUSH_PUBLIC_KEY || !WEB_PUSH_PRIVATE_KEY || !WEB_PUSH_SUBJECT) {
    return null;
  }
  return { publicKey: WEB_PUSH_PUBLIC_KEY, privateKey: WEB_PUSH_PRIVATE_KEY, subject: WEB_PUSH_SUBJECT };
};

const sendPushToUser = async (userId, payload) => {
  const config = getVapidConfig();
  if (!config) return { configured: false, sent: 0 };
  webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
  const subscriptions = await PushSubscription.find({ user: userId });
  let sent = 0;

  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification({
        endpoint: subscription.endpoint,
        keys: subscription.keys,
      }, JSON.stringify(payload), { TTL: 3600 });
      subscription.lastUsedAt = new Date();
      await subscription.save();
      sent += 1;
    } catch (error) {
      if (error.statusCode === 404 || error.statusCode === 410) {
        await subscription.deleteOne();
        continue;
      }
      console.error('Web Push delivery failed:', error.statusCode || error.message);
    }
  }

  return { configured: true, sent };
};

module.exports = { getVapidConfig, sendPushToUser };
