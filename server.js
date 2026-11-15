require('dotenv').config();
const express = require('express');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Pre-seeded demo profile (Profile ID: demo-elder | Passcode: 123456)
const profiles = {
  'demo-elder': {
    id: 'demo-elder',
    elderName: 'Ramesh Kumar',
    caregiverEmail: process.env.EMAIL_USER || 'caregiver@example.com',
    passcodeHash: bcrypt.hashSync('123456', 10),
    medications: [
      { id: '1', name: 'Amlodipine 5mg', time: '08:00 AM', instructions: 'Take 1 tablet orally after breakfast for blood pressure.', taken: false },
      { id: '2', name: 'Metformin 500mg', time: '08:00 PM', instructions: 'Take 1 tablet with dinner to control blood sugar.', taken: false }
    ],
    appointments: [
      { id: '1', doctor: 'Dr. Priya Nair (Cardiologist)', date: '2026-11-20 10:30 AM', location: 'Apollo Clinic' }
    ]
  }
};

// 1. Create or Join Profile with Passcode Verification
app.post('/api/profile/create', async (req, res) => {
  const { id, elderName, passcode, caregiverEmail } = req.body;
  if (!id || !passcode || passcode.length < 4) return res.status(400).json({ error: 'Valid ID and 4+ digit passcode required' });
  const passcodeHash = await bcrypt.hash(passcode, 10);
  profiles[id] = { id, elderName, caregiverEmail, passcodeHash, medications: [], appointments: [] };
  res.json({ message: 'Profile created', id });
});

app.post('/api/profile/login', async (req, res) => {
  const { id, passcode } = req.body;
  const profile = profiles[id];
  if (!profile) return res.status(404).json({ error: 'Profile not found' });
  const valid = await bcrypt.compare(passcode, profile.passcodeHash);
  if (!valid) return res.status(401).json({ error: 'Invalid passcode' });
  const { passcodeHash, ...safeProfile } = profile;
  res.json(safeProfile);
});

// 2. Medication & Appointment Management
app.post('/api/profile/:id/medications', (req, res) => {
  const profile = profiles[req.params.id];
  if (!profile) return res.status(404).json({ error: 'Profile not found' });
  const med = { id: Date.now().toString(), ...req.body, taken: false };
  profile.medications.push(med);
  res.json(med);
});

app.patch('/api/profile/:id/medications/:medId/toggle', (req, res) => {
  const profile = profiles[req.params.id];
  const med = profile?.medications.find(m => m.id === req.params.medId);
  if (!med) return res.status(404).json({ error: 'Medication not found' });
  med.taken = !med.taken;
  res.json(med);
});

app.post('/api/profile/:id/appointments', (req, res) => {
  const profile = profiles[req.params.id];
  if (!profile) return res.status(404).json({ error: 'Profile not found' });
  const appt = { id: Date.now().toString(), ...req.body };
  profile.appointments.push(appt);
  res.json(appt);
});

// 3. Adaption Labs AI: Simplify Prescription Instructions
app.post('/api/ai/simplify', async (req, res) => {
  const { instructions } = req.body;
  try {
    if (!process.env.ADAPTION_API_KEY || process.env.ADAPTION_API_KEY === 'your_adaption_labs_key_here') {
      return res.json({ simplified: `Simple Guide: ${instructions} (Tip: Drink a full glass of water and sit upright.)` });
    }
    const response = await fetch(process.env.ADAPTION_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.ADAPTION_API_KEY}` },
      body: JSON.stringify({
        model: 'adaption-default',
        messages: [{ role: 'user', content: `Rewrite this medication instruction in warm, ultra-simple 1-sentence language for an elderly person: "${instructions}"` }]
      })
    });
    const data = await response.json();
    res.json({ simplified: data.choices?.[0]?.message?.content || instructions });
  } catch (err) {
    res.json({ simplified: `Simple Guide: ${instructions}` });
  }
});

// 4. Proactive Email Reminder Trigger
app.post('/api/profile/:id/remind', async (req, res) => {
  const profile = profiles[req.params.id];
  if (!profile) return res.status(404).json({ error: 'Profile not found' });
  const pending = profile.medications.filter(m => !m.taken).map(m => `${m.name} at ${m.time}`).join(', ');
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
    });
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: profile.caregiverEmail,
      subject: `Care Alert for ${profile.elderName}: Medication & Appointment Update`,
      text: `Pending medications today: ${pending || 'All taken!'}.\nUpcoming appointments: ${profile.appointments.length}.`
    });
    res.json({ message: `Reminder email sent to ${profile.caregiverEmail}` });
  } catch (err) {
    res.status(500).json({ error: 'Email config incomplete—check EMAIL_USER and EMAIL_PASS in .env' });
  }
});

const PORT = process.env.PORT || 8080;
if (require.main === module) {
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}
module.exports = app;
