const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;
const MAX_TRACKED_IPS = 10000;
const attemptsByIp = new Map();

const seniorPinRateLimit = (req, res, next) => {
  const now = Date.now();
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  let entry = attemptsByIp.get(ip);

  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + WINDOW_MS };
  }

  if (entry.count >= MAX_ATTEMPTS) {
    res.set('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
    return res.status(429).json({ message: 'Too many PIN login attempts from this network. Please try again later.' });
  }

  entry.count += 1;
  attemptsByIp.set(ip, entry);

  if (attemptsByIp.size > MAX_TRACKED_IPS) {
    for (const [trackedIp, trackedEntry] of attemptsByIp) {
      if (trackedEntry.resetAt <= now) attemptsByIp.delete(trackedIp);
    }
    if (attemptsByIp.size > MAX_TRACKED_IPS) {
      const oldestIp = attemptsByIp.keys().next().value;
      attemptsByIp.delete(oldestIp);
    }
  }

  return next();
};

module.exports = seniorPinRateLimit;
