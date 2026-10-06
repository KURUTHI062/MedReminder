const User = require('../models/User');

const patientScope = async (req, res, next) => {
  const patientId = req.headers['x-senior-id'];
  if (!patientId || req.user.role !== 'caregiver') return next();

  try {
    const senior = await User.findOne({
      _id: patientId,
      caregiverId: req.user._id,
      role: 'senior',
    }).select('-password');
    if (!senior) {
      return res.status(404).json({ message: 'Senior profile not found or access denied.' });
    }

    req.caregiver = req.user;
    req.user = senior;
    return next();
  } catch (error) {
    console.error('Caregiver patient-scope authorization failed:', error);
    return res.status(500).json({ message: 'Unable to authorize patient data access.' });
  }
};

module.exports = patientScope;
