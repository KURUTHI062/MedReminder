const crypto = require('crypto');
const TrustedDevice = require('../models/TrustedDevice');

const migrateLegacyTrustedDevices = async () => {
  try {
    await TrustedDevice.collection.dropIndex('deviceToken_1');
  } catch (error) {
    if (![26, 27].includes(error.code) && error.codeName !== 'IndexNotFound' && error.codeName !== 'NamespaceNotFound') {
      throw error;
    }
  }

  const legacyDevices = await TrustedDevice.collection
    .find({ deviceToken: { $exists: true }, deviceTokenHash: { $exists: false } })
    .toArray();

  for (const device of legacyDevices) {
    await TrustedDevice.collection.updateOne(
      { _id: device._id, deviceToken: device.deviceToken },
      {
        $set: {
          deviceTokenHash: crypto.createHash('sha256').update(device.deviceToken).digest('hex'),
          expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        },
        $unset: { deviceToken: '' },
      }
    );
  }
};

module.exports = migrateLegacyTrustedDevices;
