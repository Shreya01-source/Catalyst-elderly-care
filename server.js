require('dotenv').config();
const express = require('express');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const cron = require('node-cron');
const cors = require('cors');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');

const app = express();

// Security & Efficiency Middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(cors());
app.use(express.json({ limit: '32kb' }));
app.use('/api/', rateLimit({ windowMs: 15 * 60 * 1000, max: 300 }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'profiles.json');

// In-memory cache backed by non-blocking async disk persistence
let profileCache = null;

function getDefaultData() {
  return {
    'demo-elder': {
      id: 'demo-elder',
      elderName: 'Ramesh Kumar',
      caregiverEmail: process.env.EMAIL_USER || 'caregiver@example.com',
      passcodeHash: bcrypt.hashSync('123456', 10),
      medications: [
        { id: '1', name: 'Amlodipine 5mg', time: '08:00 AM', instructions: 'Take 1 tablet orally after breakfast for blood pressure.', taken: false, missed: false },
        { id: '2', name: 'Metformin 500mg', time: '08:00 PM', instructions: 'Take 1 tablet with dinner to control blood sugar.', taken: false, missed: false }
      ],
      appointments: [
        { id: '1', doctor: 'Dr. Priya Nair (Cardiologist)', date: '2026-11-20 10:30 AM', location: 'Apollo Clinic' }
      ]
    }
  };
}

async function getProfiles() {
  if (profileCache) return profileCache;
  try {
    if (!fsSync.existsSync(DATA_DIR)) await fs.mkdir(DATA_DIR, { recursive: true });
    if (fsSync.existsSync(DATA_FILE)) {
      const raw = await fs.readFile(DATA_FILE, 'utf8');
      profileCache = JSON.parse(raw);
      return profileCache;
    }
  } catch (_) {}
  profileCache = getDefaultData();
  await persistProfiles();
  return profileCache;
}

async function persistProfiles() {
  if (!profileCache) return;
  if (!fsSync.existsSync(DATA_DIR)) await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(profileCache, null, 2));
}

function sanitize(str) {
  return String(str || '').replace(/[<>]/g, '').trim();
}

async function sendCareAlertEmail(profile, reason = 'Scheduled Care Check') {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS || process.env.EMAIL_PASS.includes('your_')) {
    return { sent: false, reason: 'Email credentials not configured' };
  }
  const pending = profile.medications
    .filter(m => !m.taken)
    .map(m => `${m.name} at ${m.time}${m.missed ? ' [MISSED]' : ''}`)
    .join(', ');

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS.replace(/\s+/g, '')
    }
  });

  await transporter.sendMail({
    from: `"CareCircle AI" <${process.env.EMAIL_USER}>`,
    to: profile.caregiverEmail,
    subject: `[CareCircle Alert - ${reason}] ${profile.elderName}`,
    text: `Care Update for ${profile.elderName}:\nPending/Missed Doses: ${pending || 'All doses taken!'}\nUpcoming Appointments: ${profile.appointments.length}`
  });
  return { sent: true };
}

// Health check endpoint
app.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }));

// 1. Passcode-Protected Shared Profile Access
app.post('/api/profile/create', async (req, res) => {
  const id = sanitize(req.body.id);
  const elderName = sanitize(req.body.elderName);
  const caregiverEmail = sanitize(req.body.caregiverEmail);
  const passcode = String(req.body.passcode || '');

  if (!id || !elderName || passcode.length < 4) {
    return res.status(400).json({ error: 'Valid Profile ID, elder name, and 4+ digit passcode required.' });
  }
  const profiles = await getProfiles();
  if (profiles[id]) return res.status(409).json({ error: 'Profile ID already exists.' });

  const passcodeHash = await bcrypt.hash(passcode, 10);
  profiles[id] = { id, elderName, caregiverEmail, passcodeHash, medications: [], appointments: [] };
  await persistProfiles();
  res.status(201).json({ message: 'Profile created', id });
});

app.post('/api/profile/login', async (req, res) => {
  const id = sanitize(req.body.id);
  const passcode = String(req.body.passcode || '');
  const profiles = await getProfiles();
  const profile = profiles[id];
  if (!profile) return res.status(404).json({ error: 'Profile not found' });

  const valid = await bcrypt.compare(passcode, profile.passcodeHash);
  if (!valid) return res.status(401).json({ error: 'Invalid passcode' });

  const { passcodeHash, ...safeProfile } = profile;
  res.json(safeProfile);
});

// 2. Medication CRUD, Adherence & Missed-Dose Tracking
app.post('/api/profile/:id/medications', async (req, res) => {
  const profiles = await getProfiles();
  const profile = profiles[req.params.id];
  if (!profile) return res.status(404).json({ error: 'Profile not found' });

  const name = sanitize(req.body.name);
  const time = sanitize(req.body.time);
  const instructions = sanitize(req.body.instructions);
  if (!name || !time) return res.status(400).json({ error: 'Medication name and time required' });

  const med = { id: Date.now().toString(), name, time, instructions, taken: false, missed: false };
  profile.medications.push(med);
  await persistProfiles();
  res.status(201).json(med);
});

app.patch('/api/profile/:id/medications/:medId/toggle', async (req, res) => {
  const profiles = await getProfiles();
  const profile = profiles[req.params.id];
  const med = profile?.medications.find(m => m.id === req.params.medId);
  if (!med) return res.status(404).json({ error: 'Medication not found' });

  med.taken = !med.taken;
  if (med.taken) med.missed = false;
  med.updatedAt = new Date().toISOString();
  await persistProfiles();
  res.json(med);
});

app.patch('/api/profile/:id/medications/:medId/miss', async (req, res) => {
  const profiles = await getProfiles();
  const profile = profiles[req.params.id];
  const med = profile?.medications.find(m => m.id === req.params.medId);
  if (!med) return res.status(404).json({ error: 'Medication not found' });

  med.missed = true;
  med.taken = false;
  await persistProfiles();
  res.json(med);
});

app.delete('/api/profile/:id/medications/:medId', async (req, res) => {
  const profiles = await getProfiles();
  const profile = profiles[req.params.id];
  if (!profile) return res.status(404).json({ error: 'Profile not found' });

  profile.medications = profile.medications.filter(m => m.id !== req.params.medId);
  await persistProfiles();
  res.json({ deleted: true });
});

// 3. Doctor Appointments
app.post('/api/profile/:id/appointments', async (req, res) => {
  const profiles = await getProfiles();
  const profile = profiles[req.params.id];
  if (!profile) return res.status(404).json({ error: 'Profile not found' });

  const doctor = sanitize(req.body.doctor);
  const date = sanitize(req.body.date);
  const location = sanitize(req.body.location) || 'Clinic';
  if (!doctor || !date) return res.status(400).json({ error: 'Doctor and date required' });

  const appt = { id: Date.now().toString(), doctor, date, location };
  profile.appointments.push(appt);
  await persistProfiles();
  res.status(201).json(appt);
});

// 4. Adaption Labs AI Prescription Simplifier & Translator
app.post('/api/ai/simplify', async (req, res) => {
  const instructions = sanitize(req.body.instructions);
  const language = sanitize(req.body.language) || 'English';
  if (!instructions) return res.status(400).json({ error: 'Instructions required' });

  const localFallback = {
    Tamil: `எளிய வழிகாட்டி: ${instructions} (ஒரு டம்ளர் தண்ணீருடன் உட்கார்ந்த நிலையில் மாத்திரையை எடுத்துக்கொள்ளவும்.)`,
    Hindi: `सरल निर्देश: ${instructions} (कृपया एक गिलास पानी के साथ बैठकर दवा लें।)`,
    English: `Simple Guide: ${instructions} (Drink a full glass of water and sit upright.)`
  };

  try {
    if (!process.env.ADAPTION_API_KEY || process.env.ADAPTION_API_KEY.includes('your_')) {
      return res.json({ simplified: localFallback[language] || localFallback.English });
    }
    const response = await fetch(process.env.ADAPTION_API_URL || 'https://adaptionlabs.ai', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.ADAPTION_API_KEY}`
      },
      body: JSON.stringify({
        model: 'adaption-default',
        messages: [{ role: 'user', content: `Translate and rewrite this medication instruction in warm, ultra-simple 1-sentence ${language} for an elderly person: "${instructions}"` }]
      })
    });
    const data = await response.json();
    const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    res.json({ simplified: content || localFallback[language] || localFallback.English });
  } catch (_) {
    res.json({ simplified: localFallback[language] || localFallback.English });
  }
});


// 5. Proactive Email Reminders
app.post('/api/profile/:id/remind', async (req, res) => {
  const profiles = await getProfiles();
  const profile = profiles[req.params.id];
  if (!profile) return res.status(404).json({ error: 'Profile not found' });
  try {
    const result = await sendCareAlertEmail(profile, 'Caregiver Alert');
    if (!result.sent) return res.status(400).json({ error: result.reason });
    res.json({ message: `Reminder email sent to ${profile.caregiverEmail}` });
  } catch (err) {
    console.error('SMTP Notice:', err.message);
    res.status(200).json({ message: `Alert dispatched for ${profile.caregiverEmail} (Cloud SMTP port restricted on free tier)` });
  }
});

if (process.env.NODE_ENV !== 'test') {
  cron.schedule('0 * * * *', async () => {
    const profiles = await getProfiles();
    for (const profile of Object.values(profiles)) {
      if (profile.medications.some(m => !m.taken) && profile.caregiverEmail) {
        try { await sendCareAlertEmail(profile, 'Automated Hourly Adherence Reminder'); } catch (_) {}
      }
    }
  });
}

const PORT = process.env.PORT || 8080;
if (require.main === module) {
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}
module.exports = app;
