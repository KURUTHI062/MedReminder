const express = require('express');
const protect = require('../middleware/auth');
const patientScope = require('../middleware/patientScope');
const caregiverOnly = require('../middleware/caregiverOnly');
const {
  getMedicines,
  createMedicine,
  updateMedicine,
  deleteMedicine,
  markMedicineStatus,
  snoozeMedicineDose,
} = require('../controllers/medicineController');

const router = express.Router();

router.get('/', protect, patientScope, getMedicines);
router.post('/', protect, patientScope, caregiverOnly, createMedicine);
router.put('/:id', protect, patientScope, caregiverOnly, updateMedicine);
router.delete('/:id', protect, patientScope, caregiverOnly, deleteMedicine);
router.post('/:id/taken', protect, patientScope, (req, res) => {
  req.body = { ...req.body, status: 'TAKEN' };
  return markMedicineStatus(req, res);
});
router.post('/:id/skip', protect, patientScope, (req, res) => {
  req.body = { ...req.body, status: 'SKIPPED' };
  return markMedicineStatus(req, res);
});
router.post('/:id/missed', protect, patientScope, (req, res) => {
  req.body = { ...req.body, status: 'MISSED' };
  return markMedicineStatus(req, res);
});
router.post('/:id/snooze', protect, patientScope, snoozeMedicineDose);
router.post('/:id/status', protect, patientScope, markMedicineStatus);

module.exports = router;
