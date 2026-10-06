const caregiverOnly = (req, res, next) => {
  if (req.user.role !== 'caregiver' && !req.caregiver) {
    return res.status(403).json({ message: 'Your caregiver manages medicines for this profile.' });
  }
  return next();
};

module.exports = caregiverOnly;
