import 'dotenv/config';
import express from 'express';
import { createHash, createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { MongoClient } from 'mongodb';

const projectDir = process.cwd();
const publicDir = join(projectDir, 'public');
const mongoUri = process.env.MONGODB_URI;
const databaseName = process.env.MONGODB_DATABASE || 'schollyindia';

let client;
let connectionPromise;
const scrypt = promisify(scryptCallback);
const previewEvery = 3;

function getUsersCollection() {
  return getScholarshipCollection().then(collection => collection.db.collection('users'));
}

function authSecret() {
  if (!process.env.AUTH_SECRET || process.env.AUTH_SECRET.length < 32) {
    throw new Error('AUTH_SECRET must be set to a random value at least 32 characters long.');
  }
  return process.env.AUTH_SECRET;
}

function signToken(user) {
  const payload = Buffer.from(JSON.stringify({
    sub: String(user._id),
    email: user.email,
    name: user.displayName,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7
  })).toString('base64url');
  const signature = createHmac('sha256', authSecret()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function readToken(token) {
  try {
    const [payload, signature] = String(token || '').split('.');
    if (!payload || !signature) return null;
    const expected = createHmac('sha256', authSecret()).update(payload).digest();
    const supplied = Buffer.from(signature, 'base64url');
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
    const user = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!user.sub || !user.exp || user.exp <= Math.floor(Date.now() / 1000)) return null;
    return { id: user.sub, email: user.email, displayName: user.name };
  } catch {
    return null;
  }
}

function requestUser(req) {
  const cookies = (req.headers.cookie || '').split(';');
  const authCookie = cookies.map(part => part.trim()).find(part => part.startsWith('scholly_session='));
  return readToken(authCookie?.slice('scholly_session='.length));
}

function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `scholly_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${secure}`);
}

function clearSessionCookie(res) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `scholly_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
}

function publicUser(user) {
  return { id: String(user._id), email: user.email, displayName: user.displayName };
}

function getScholarshipCollection() {
  if (!mongoUri) {
    throw new Error('MONGODB_URI is not configured. Add it to .env locally or Netlify environment variables when deployed.');
  }

  if (!client) client = new MongoClient(mongoUri);
  if (!connectionPromise) connectionPromise = client.connect();

  return connectionPromise.then(connectedClient =>
    connectedClient.db(databaseName).collection('scholarships')
  );
}

const app = express();

app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));

app.post('/api/auth/register', async (req, res, next) => {
  try {
    const displayName = String(req.body?.name || '').trim().slice(0, 80);
    const email = String(req.body?.email || '').normalize('NFKC').trim().toLowerCase();
    const password = String(req.body?.password || '');
    if (displayName.length < 2) return res.status(400).json({ error: 'Enter your name (at least 2 characters).' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return res.status(400).json({ error: 'Enter a valid email address.' });
    if (password.length < 8 || password.length > 128) return res.status(400).json({ error: 'Password must be 8 to 128 characters.' });

    const users = await getUsersCollection();
    await users.createIndex({ email: 1 }, { unique: true });
    if (await users.findOne({ email }, { projection: { _id: 1 } })) {
      return res.status(409).json({ error: 'An account with this email already exists. Sign in or reset your password.' });
    }
    const salt = randomBytes(16).toString('hex');
    const passwordHash = (await scrypt(password, salt, 64)).toString('hex');
    const user = { displayName, email, passwordHash, salt, createdAt: new Date() };
    const result = await users.insertOne(user);
    user._id = result.insertedId;
    setSessionCookie(res, signToken(user));
    res.status(201).json({ user: publicUser(user) });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ error: 'An account with this email already exists. Sign in or reset your password.' });
    next(error);
  }
});

app.post('/api/auth/login', async (req, res, next) => {
  try {
    const email = String(req.body?.email || '').normalize('NFKC').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const users = await getUsersCollection();
    const user = await users.findOne({ email });
    if (!user || password.length > 128) return res.status(401).json({ error: 'Email or password is incorrect.' });
    const candidate = await scrypt(password, user.salt, 64);
    const saved = Buffer.from(user.passwordHash, 'hex');
    if (candidate.length !== saved.length || !timingSafeEqual(candidate, saved)) {
      return res.status(401).json({ error: 'Email or password is incorrect.' });
    }
    setSessionCookie(res, signToken(user));
    res.json({ user: publicUser(user) });
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/forgot-password', async (req, res, next) => {
  try {
    const apiKey = process.env.RESEND_API_KEY;
    const mailFrom = process.env.MAIL_FROM;
    const appBaseUrl = process.env.APP_BASE_URL || (process.env.NODE_ENV !== 'production' ? 'http://localhost:3000' : '');
    if (!apiKey || !mailFrom || !appBaseUrl) {
      return res.status(503).json({ error: 'Password recovery email is not configured yet. Ask the site administrator to finish email setup.' });
    }

    const email = String(req.body?.email || '').normalize('NFKC').trim().toLowerCase();
    const users = await getUsersCollection();
    const user = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? await users.findOne({ email }) : null;
    if (user) {
      const token = randomBytes(32).toString('base64url');
      const tokenHash = createHash('sha256').update(token).digest('hex');
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
      await users.updateOne({ _id: user._id }, { $set: { passwordResetHash: tokenHash, passwordResetExpiresAt: expiresAt } });

      const resetUrl = new URL('/', appBaseUrl);
      resetUrl.searchParams.set('reset', token);
      const mailResponse = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: mailFrom,
          to: [email],
          subject: 'Reset your Scholly India password',
          text: `Hello ${user.displayName},\n\nUse this link to set a new password. It expires in 30 minutes and works once:\n${resetUrl.href}\n\nIf you did not request this, you can ignore this email.`
        })
      });
      if (!mailResponse.ok) {
        console.error('Password reset email service returned status', mailResponse.status);
        return res.status(503).json({ error: 'We could not send the reset email. Please try again later.' });
      }
    }
    res.json({ message: 'If an account exists for that email, a password reset link will arrive shortly.' });
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/reset-password', async (req, res, next) => {
  try {
    const token = String(req.body?.token || '');
    const password = String(req.body?.password || '');
    if (token.length < 32 || token.length > 200) return res.status(400).json({ error: 'This reset link is invalid or expired. Request a new one.' });
    if (password.length < 8 || password.length > 128) return res.status(400).json({ error: 'Password must be 8 to 128 characters.' });

    const users = await getUsersCollection();
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const user = await users.findOne({ passwordResetHash: tokenHash, passwordResetExpiresAt: { $gt: new Date() } });
    if (!user) return res.status(400).json({ error: 'This reset link is invalid or expired. Request a new one.' });

    const salt = randomBytes(16).toString('hex');
    const passwordHash = (await scrypt(password, salt, 64)).toString('hex');
    const result = await users.updateOne(
      { _id: user._id, passwordResetHash: tokenHash, passwordResetExpiresAt: { $gt: new Date() } },
      { $set: { passwordHash, salt, passwordChangedAt: new Date() }, $unset: { passwordResetHash: '', passwordResetExpiresAt: '' } }
    );
    if (!result.modifiedCount) return res.status(400).json({ error: 'This reset link is invalid or expired. Request a new one.' });
    clearSessionCookie(res);
    res.json({ message: 'Password updated. Sign in with your new password.' });
  } catch (error) {
    next(error);
  }
});

app.get('/api/auth/me', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ user: requestUser(req) });
});

app.post('/api/auth/logout', (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get('/api/health', async (_req, res, next) => {
  try {
    const collection = await getScholarshipCollection();
    const scholarshipCount = await collection.countDocuments();
    const recoveryConfigured = Boolean(
      process.env.RESEND_API_KEY && process.env.MAIL_FROM &&
      (process.env.APP_BASE_URL || process.env.NODE_ENV !== 'production')
    );
    res.json({ status: 'ok', databaseConfigured: true, emailRecoveryConfigured: recoveryConfigured, scholarshipCount });
  } catch (error) {
    next(error);
  }
});

app.get('/api/scholarships', async (_req, res, next) => {
  try {
    res.set('Cache-Control', 'private, no-store');
    const collection = await getScholarshipCollection();
    const all = await collection
      .find({}, { projection: { _id: 0, legacy_id: 0 } })
      .sort({ scholarship_name: 1 })
      .toArray();
    const user = requestUser(_req);
    const data = user ? all : all.filter((_scholarship, index) => index % previewEvery === 0);

    res.json({ data, count: data.length, totalCount: all.length, preview: !user });
  } catch (error) {
    next(error);
  }
});

app.get('/', (_req, res) => {
  res.sendFile(join(publicDir, 'index.html'));
});

app.use(express.static(publicDir, { extensions: ['html'] }));

app.use((error, _req, res, _next) => {
  console.error('API request failed:', error.message);
  res.status(503).json({ error: 'Scholarship database is unavailable. Please try again shortly.' });
});

export default app;
