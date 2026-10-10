const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET || db.data.secret;
const IS_PROD = process.env.NODE_ENV === 'production';

app.use(express.json({ limit: '50kb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

/* ---------- helpers ---------- */

const hits = new Map();
function limit(max, windowMs) {
  return (req, res, next) => {
    const key = req.ip + req.path;
    const now = Date.now();
    const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (recent.length >= max) {
      return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
    }
    recent.push(now);
    hits.set(key, recent);
    next();
  };
}

function cleanPhone(value) {
  const s = String(value || '').replace(/[\s\-()]/g, '');
  return /^\+?\d{10,15}$/.test(s) ? s : null;
}

function generateVirtualNumber() {
  // +92 51 is the Islamabad area code. Retry until the number is unused.
  for (let i = 0; i < 1000; i++) {
    const a = String(crypto.randomInt(2000, 9999));
    const b = String(crypto.randomInt(1000, 9999));
    const number = `+92 51 ${a} ${b}`;
    if (!db.data.users.some((u) => u.virtualNumber === number)) return number;
  }
  throw new Error('No free numbers left');
}

function publicUser(u) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    virtualNumber: u.virtualNumber,
    settings: u.settings,
    createdAt: u.createdAt,
  };
}

function setSession(res, user) {
  const token = jwt.sign({ uid: user.id }, SECRET, { expiresIn: '7d' });
  res.cookie('token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PROD,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

function auth(req, res, next) {
  try {
    const { uid } = jwt.verify(req.cookies.token || '', SECRET);
    const user = db.data.users.find((u) => u.id === uid);
    if (!user) throw new Error('no user');
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: 'Please log in.' });
  }
}

/* ---------- auth ---------- */

app.post('/api/signup', limit(10, 15 * 60 * 1000), async (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 60);
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const forwardRaw = String(req.body.forwardTo || '').trim();

  if (name.length < 2) return res.status(400).json({ error: 'Enter your name.' });
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email.' });
  if (password.length < 8) return res.status(400).json({ error: 'Password needs at least 8 characters.' });
  if (db.data.users.some((u) => u.email === email)) {
    return res.status(409).json({ error: 'That email already has an account. Log in instead.' });
  }
  let forwardTo = '';
  if (forwardRaw) {
    forwardTo = cleanPhone(forwardRaw);
    if (!forwardTo) return res.status(400).json({ error: 'Forwarding number must be 10 to 15 digits.' });
  }

  const user = {
    id: db.newId(),
    name,
    email,
    passwordHash: await bcrypt.hash(password, 10),
    virtualNumber: generateVirtualNumber(),
    settings: {
      forwardEnabled: !!forwardTo,
      forwardTo,
      ringSeconds: 20,
      voicemailEnabled: true,
      voicemailMaxSeconds: 60,
      greeting: `Hi, you've reached ${name}. Please leave a message after the tone and I'll call you back.`,
    },
    createdAt: new Date().toISOString(),
  };
  db.data.users.push(user);
  db.save();
  setSession(res, user);
  res.status(201).json({ user: publicUser(user) });
});

app.post('/api/login', limit(10, 15 * 60 * 1000), async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const user = db.data.users.find((u) => u.email === email);
  const ok = user && (await bcrypt.compare(password, user.passwordHash));
  if (!ok) return res.status(401).json({ error: 'Email or password is wrong.' });
  setSession(res, user);
  res.json({ user: publicUser(user) });
});

app.post('/api/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

app.get('/api/me', auth, (req, res) => res.json({ user: publicUser(req.user) }));

/* ---------- settings ---------- */

app.put('/api/settings', auth, (req, res) => {
  const b = req.body || {};
  const s = { ...req.user.settings };

  if ('forwardEnabled' in b) s.forwardEnabled = !!b.forwardEnabled;
  if ('forwardTo' in b) {
    const raw = String(b.forwardTo || '').trim();
    if (raw === '') s.forwardTo = '';
    else {
      const c = cleanPhone(raw);
      if (!c) return res.status(400).json({ error: 'Forwarding number must be 10 to 15 digits.' });
      s.forwardTo = c;
    }
  }
  if (s.forwardEnabled && !s.forwardTo) {
    return res.status(400).json({ error: 'Add a number to forward calls to.' });
  }
  if ('ringSeconds' in b) {
    const n = Number(b.ringSeconds);
    if (![10, 20, 30, 45].includes(n)) return res.status(400).json({ error: 'Pick a valid ring time.' });
    s.ringSeconds = n;
  }
  if ('voicemailEnabled' in b) s.voicemailEnabled = !!b.voicemailEnabled;
  if ('voicemailMaxSeconds' in b) {
    const n = Number(b.voicemailMaxSeconds);
    if (![30, 60, 120].includes(n)) return res.status(400).json({ error: 'Pick a valid message length.' });
    s.voicemailMaxSeconds = n;
  }
  if ('greeting' in b) {
    const g = String(b.greeting || '').trim();
    if (g.length < 5 || g.length > 300) {
      return res.status(400).json({ error: 'Greeting must be 5 to 300 characters.' });
    }
    s.greeting = g;
  }

  req.user.settings = s;
  db.save();
  res.json({ user: publicUser(req.user) });
});

/* ---------- calls ---------- */

app.post('/api/calls/simulate', auth, (req, res) => {
  const u = req.user;
  const s = u.settings;
  const callerName = String(req.body.callerName || '').trim().slice(0, 60) || 'Unknown caller';
  const callerNumber = cleanPhone(req.body.callerNumber) || 'Unknown number';
  const answered = req.body.answered !== false;
  const message = String(req.body.message || '').trim().slice(0, 500);

  const steps = [
    `Incoming call from ${callerName} (${callerNumber})`,
    `Dialing your HopLine number ${u.virtualNumber}`,
  ];
  let outcome;
  let resultText;
  let duration = 0;
  const canForward = s.forwardEnabled && s.forwardTo;

  if (canForward) {
    steps.push(`Call forwarded to [${s.forwardTo}]`);
    if (answered) {
      outcome = 'forwarded';
      duration = crypto.randomInt(25, 320);
      steps.push('Your phone picked up and the call connected');
      resultText = `Call forwarded to [${s.forwardTo}]`;
    } else {
      steps.push(`No answer after ${s.ringSeconds} seconds`);
    }
  } else {
    steps.push('Call forwarding is off');
  }

  if (!outcome) {
    if (s.voicemailEnabled) {
      outcome = 'voicemail';
      steps.push('Playing your greeting, then recording');
      steps.push('Voicemail saved to your inbox');
      resultText = 'Sent to voicemail';
      db.data.voicemails.push({
        id: db.newId(),
        userId: u.id,
        callerName,
        callerNumber,
        message: message || '(Caller hung up without leaving a message)',
        seconds: Math.min(s.voicemailMaxSeconds, Math.max(4, Math.ceil((message.length || 10) / 12))),
        read: false,
        at: new Date().toISOString(),
      });
    } else {
      outcome = 'missed';
      steps.push('Voicemail is off');
      resultText = 'Missed call';
    }
  }

  const call = {
    id: db.newId(),
    userId: u.id,
    callerName,
    callerNumber,
    outcome,
    forwardedTo: outcome === 'forwarded' || (canForward && outcome === 'voicemail') ? s.forwardTo : '',
    duration,
    at: new Date().toISOString(),
  };
  db.data.calls.push(call);
  db.save();
  res.json({ call, steps, message: resultText });
});

app.get('/api/calls', auth, (req, res) => {
  const calls = db.data.calls.filter((c) => c.userId === req.user.id).reverse().slice(0, 100);
  res.json({ calls });
});

/* ---------- voicemail ---------- */

app.get('/api/voicemails', auth, (req, res) => {
  const voicemails = db.data.voicemails.filter((v) => v.userId === req.user.id).reverse();
  res.json({ voicemails });
});

app.patch('/api/voicemails/:id/read', auth, (req, res) => {
  const v = db.data.voicemails.find((x) => x.id === req.params.id && x.userId === req.user.id);
  if (!v) return res.status(404).json({ error: 'Voicemail not found.' });
  v.read = true;
  db.save();
  res.json({ voicemail: v });
});

app.delete('/api/voicemails/:id', auth, (req, res) => {
  const i = db.data.voicemails.findIndex((x) => x.id === req.params.id && x.userId === req.user.id);
  if (i === -1) return res.status(404).json({ error: 'Voicemail not found.' });
  db.data.voicemails.splice(i, 1);
  db.save();
  res.json({ ok: true });
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

app.listen(PORT, () => console.log(`HopLine running on http://localhost:${PORT}`));
