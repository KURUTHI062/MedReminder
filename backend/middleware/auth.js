const jwt = require('jsonwebtoken');
const User = require('../models/User');
const TrustedDevice = require('../models/TrustedDevice');

const protect = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({ message: 'Not authorized, no token' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'medreminder-secret');
    req.user = await User.findById(decoded.id).select('-password');

    if (!req.user) {
      return res.status(401).json({ message: 'User not found' });
    }
    if ((decoded.tokenVersion || 0) !== (req.user.tokenVersion || 0)) {
      return res.status(401).json({ message: 'Token has been revoked' });
    }
    if (decoded.trustedDeviceId) {
      const device = await TrustedDevice.exists({
        _id: decoded.trustedDeviceId,
        user: req.user._id,
        revokedAt: null,
        expiresAt: { $gt: new Date() },
      });
      if (!device) {
        return res.status(401).json({ message: 'Trusted device session has been revoked' });
      }
    }

    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Token is invalid or expired' });
    }

    console.error('Authentication lookup failed:', error);
    return res.status(500).json({ message: 'Unable to authenticate request' });
  }
};

module.exports = protect;
