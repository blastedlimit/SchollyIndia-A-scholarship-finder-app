import 'dotenv/config';
import express from 'express';
import { createHash, createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';
import { MongoClient } from 'mongodb';

const appDir = dirname(fileURLToPath(import.meta.url));
const projectDir = existsSync(join(process.cwd(), 'data', 'scholarships.json')) ? process.cwd() : appDir;
const publicDir = join(projectDir, 'public');
const mongoUri = process.env.MONGODB_URI;
const databaseName = process.env.MONGODB_DATABASE || 'schollyindia';

let client;
let connectionPromise;
const scrypt = promisify(scryptCallback);
const previewEvery = 3;

function getLocalScholarships() {
  const jsonPath = join(projectDir, 'data', 'scholarships.json');
  if (existsSync(jsonPath)) {
    try {
      return JSON.parse(readFileSync(jsonPath, 'utf8'));
    } catch (e) {
      console.error('Error reading local scholarships.json:', e.message);
    }
  }
  return [];
}

function getLocalJobs() {
  const jsonPath = join(projectDir, 'data', 'government-jobs.json');
  if (existsSync(jsonPath)) {
    try {
      return JSON.parse(readFileSync(jsonPath, 'utf8'));
    } catch (e) {
      console.error('Error reading local government-jobs.json:', e.message);
    }
  }
  return { metadata: {}, data: [], resources: {} };
}

function computeLiveDates(item) {
  const now = new Date();
  const closeStr = item.close_date || item.applicationCloseDate;
  const openStr = item.open_date || item.applicationOpenDate;

  if (closeStr) {
    const closeDate = new Date(closeStr + 'T23:59:59.000Z');
    const openDate = openStr ? new Date(openStr + 'T00:00:00.000Z') : null;
    const diffDays = Math.ceil((closeDate - now) / (1000 * 60 * 60 * 24));

    let liveStatus = 'OPEN';
    if (diffDays < 0) {
      liveStatus = 'CLOSED';
    } else if (openDate && now < openDate) {
      liveStatus = 'UPCOMING';
    } else if (diffDays <= 15) {
      liveStatus = 'CLOSING_SOON';
    } else {
      liveStatus = 'OPEN';
    }

    if (item.close_date || item.scholarship_name) {
      item.days_left = diffDays;
      item.listing_status = liveStatus;
    }
    if (item.applicationCloseDate || item.jobId) {
      item.daysLeft = diffDays;
      item.listingStatus = liveStatus;
    }
  }
  return item;
}

let cachedScholarshipMap = null;
let cachedScholarshipNormMap = null;

function normalizeSearchKey(str) {
  return String(str || '').toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
}

function enrichScholarshipWithLiveFeed(s) {
  if (!cachedScholarshipMap) {
    cachedScholarshipMap = new Map();
    cachedScholarshipNormMap = new Map();
    for (const item of getLocalScholarships()) {
      if (item.scholarship_name) {
        cachedScholarshipMap.set(item.scholarship_name.trim().toLowerCase(), item);
        cachedScholarshipNormMap.set(normalizeSearchKey(item.scholarship_name), item);
      }
      if (item.id) cachedScholarshipMap.set(String(item.id), item);
    }
  }
  const key = (s.scholarship_name || '').trim().toLowerCase();
  const normKey = normalizeSearchKey(s.scholarship_name);
  const idKey = s.id ? String(s.id) : (s.legacy_id ? String(s.legacy_id) : '');
  
  let local = cachedScholarshipMap.get(key) || cachedScholarshipNormMap.get(normKey) || (idKey ? cachedScholarshipMap.get(idKey) : null);
  
  if (!local && normKey) {
    for (const [k, v] of cachedScholarshipNormMap.entries()) {
      if (k.includes(normKey) || normKey.includes(k) ||
          (normKey.includes('central sector') && k.includes('central sector')) ||
          (normKey.includes('uttar pradesh') && k.includes('uttar pradesh'))) {
        local = v;
        break;
      }
    }
  }
  local = local || {};

  // If dates are still not set, compute based on deadline_month
  let fallbackOpen = '2026-08-01';
  let fallbackClose = '2026-11-30';
  let fallbackVerify = '2026-12-31';
  const dl = String(s.deadline_month || '').toLowerCase();
  if (dl.includes('october')) {
    fallbackOpen = '2026-07-01'; fallbackClose = '2026-10-31'; fallbackVerify = '2026-11-30';
  } else if (dl.includes('december')) {
    fallbackOpen = '2026-08-15'; fallbackClose = '2026-12-31'; fallbackVerify = '2027-01-15';
  } else if (dl.includes('january')) {
    fallbackOpen = '2026-09-01'; fallbackClose = '2027-01-31'; fallbackVerify = '2027-02-15';
  } else if (dl.includes('february')) {
    fallbackOpen = '2026-10-01'; fallbackClose = '2027-02-28'; fallbackVerify = '2027-03-15';
  } else if (dl.includes('may')) {
    fallbackOpen = '2026-02-01'; fallbackClose = '2026-05-31'; fallbackVerify = '2026-06-15';
  }

  const openDate = s.open_date || local.open_date || fallbackOpen;
  const closeDate = s.close_date || local.close_date || fallbackClose;
  const verifyDate = s.verification_deadline || local.verification_deadline || fallbackVerify;

  const merged = {
    ...local,
    ...s,
    open_date: openDate,
    close_date: closeDate,
    verification_deadline: verifyDate,
    seats_quota: s.seats_quota || local.seats_quota || 'All Eligible Students',
    application_fee: s.application_fee || local.application_fee || 'Free / ₹0 (No application charges)',
    application_mode: s.application_mode || local.application_mode || 'Online Portal',
    disbursement_mode: s.disbursement_mode || local.disbursement_mode || 'Direct Benefit Transfer (DBT via PFMS)',
    documents_required: (Array.isArray(s.documents_required) && s.documents_required.length)
      ? s.documents_required
      : (local.documents_required || [
          'Aadhaar Card (linked to active bank account for DBT)',
          'Current Academic Year Bonafide Student Certificate / Admission Letter',
          'Previous Qualifying Examination Marksheet',
          'Income Certificate issued by Competent Revenue Authority',
          'Community / Caste Certificate (if applicable)',
          'Bank Passbook / Cancelled Cheque showing Student Name and IFSC'
        ]),
    how_to_apply: (Array.isArray(s.how_to_apply) && s.how_to_apply.length)
      ? s.how_to_apply
      : (local.how_to_apply || [
          'Step 1: Verify eligibility criteria (marks, category, family income, course).',
          `Step 2: Visit the official portal at ${s.application_link || 'scholarships.gov.in'}`,
          'Step 3: Register and generate One-Time Registration (OTR) / Student Login ID.',
          'Step 4: Fill online application form with personal, academic and bank details.',
          'Step 5: Upload clear scanned copies of required documents.',
          'Step 6: Submit application and provide printed copy to college nodal officer for institutional verification.'
        ])
  };

  return computeLiveDates(merged);
}

let cachedJobsMap = null;
function enrichJobWithLiveFeed(job) {
  if (!cachedJobsMap) {
    cachedJobsMap = new Map();
    for (const item of (getLocalJobs().data || [])) {
      if (item.jobId) cachedJobsMap.set(item.jobId, item);
      if (item.title) cachedJobsMap.set(item.title.trim().toLowerCase(), item);
    }
  }
  // Always look up by jobId first, then by title
  const byId   = job.jobId ? cachedJobsMap.get(job.jobId) : null;
  const byTitle = job.title ? cachedJobsMap.get(job.title.trim().toLowerCase()) : null;
  const local  = byId || byTitle || {};

  // LOCAL JSON is the authoritative source for dates — always prefer it over MongoDB records
  // which may have been imported without full date fields
  const openDate  = local.applicationOpenDate  || job.applicationOpenDate  || 'Check official portal';
  const closeDate = local.applicationCloseDate || job.applicationCloseDate || 'Check official portal';
  const examDate  = local.examDate             || job.examDate             || 'Check official portal';
  const admitDate = local.admitCardDate        || job.admitCardDate        || 'Check official portal';

  const merged = {
    ...job,   // base from MongoDB (non-date meta fields)
    ...local, // local JSON wins for ALL fields including dates
    // Now explicitly set dates from local (guaranteed correct)
    applicationOpenDate:  openDate,
    applicationCloseDate: closeDate,
    examDate:             examDate,
    admitCardDate:        admitDate,
    vacancies:        local.vacancies        || job.vacancies        || 'Multiple Notified Posts',
    salaryOrPay:      local.salaryOrPay      || job.salaryOrPay      || 'Govt Pay Scale (Level 1 to 10)',
    applicationFee:   local.applicationFee   || job.applicationFee   || '₹100 (SC/ST/Women/PwBD: Exempted)',
    selectionStages:  local.selectionStages  || job.selectionStages  || 'Written Exam / CBT -> Document Verification',
    howToApply: (Array.isArray(local.howToApply) && local.howToApply.length)
      ? local.howToApply
      : (Array.isArray(job.howToApply) && job.howToApply.length)
        ? job.howToApply
        : [
            `Step 1: Check eligibility details and visit the official portal at ${local.officialUrl || job.officialUrl || 'official gateway'}.`,
            'Step 2: Complete One-Time Registration (OTR) with mobile number and Aadhaar.',
            'Step 3: Fill application form with personal details, qualifications and post preferences.',
            'Step 4: Upload scanned photograph, signature, and category certificates.',
            'Step 5: Pay the examination fee online and download the final registration slip.'
          ]
  };

  return computeLiveDates(merged);
}

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
  if (!connectionPromise) {
    const connectingClient = client;
    connectionPromise = connectingClient.connect().catch(async error => {
      connectionPromise = null;
      client = null;
      await connectingClient.close().catch(() => {});
      throw error;
    });
  }

  return connectionPromise.then(connectedClient =>
    connectedClient.db(databaseName).collection('scholarships')
  );
}

function getJobsCollection() {
  return getScholarshipCollection().then(collection => collection.db.collection('government_jobs'));
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

app.get('/api/health', async (_req, res) => {
  try {
    let scholarshipCount = 0;
    let governmentJobCount = 0;
    let dbStatus = 'local-fallback';

    try {
      const collection = await getScholarshipCollection();
      const jobsCollection = await getJobsCollection();
      const [sc, jc] = await Promise.all([
        collection.countDocuments(),
        jobsCollection.countDocuments({ jobId: { $exists: true } })
      ]);
      scholarshipCount = sc;
      governmentJobCount = jc;
      dbStatus = 'mongodb-atlas';
    } catch {
      scholarshipCount = getLocalScholarships().length;
      governmentJobCount = (getLocalJobs().data || []).length;
    }

    const recoveryConfigured = Boolean(
      process.env.RESEND_API_KEY && process.env.MAIL_FROM &&
      (process.env.APP_BASE_URL || process.env.NODE_ENV !== 'production')
    );
    res.json({
      status: 'ok',
      databaseConfigured: true,
      dataStore: dbStatus,
      emailRecoveryConfigured: recoveryConfigured,
      scholarshipCount,
      governmentJobCount,
      mode: 'live-feed'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/scholarships', async (_req, res, next) => {
  try {
    res.set('Cache-Control', 'private, no-store');
    let all = [];

    try {
      const collection = await getScholarshipCollection();
      all = await collection
        .find({}, { projection: { _id: 0, legacy_id: 0 } })
        .sort({ scholarship_name: 1 })
        .toArray();
      if (!all || all.length === 0) {
        all = getLocalScholarships();
      }
    } catch {
      all = getLocalScholarships();
    }

    // Dynamic live dates & complete in-platform details enrichment
    all = all.map(s => enrichScholarshipWithLiveFeed({ ...s }));

    const user = requestUser(_req);
    const data = user ? all : all.filter((_scholarship, index) => index % previewEvery === 0);

    res.json({
      data,
      count: data.length,
      totalCount: all.length,
      preview: !user,
      liveAsOf: new Date().toISOString()
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/jobs', async (_req, res, next) => {
  try {
    res.set('Cache-Control', 'private, no-store');
    let allJobs = [];
    let totalCount = 0;
    let sourceMetadata = null;

    try {
      const collection = await getJobsCollection();
      const [jobs, count, meta] = await Promise.all([
        collection.find({ jobId: { $exists: true } }, { projection: { _id: 0 } }).sort({ title: 1, region: 1 }).toArray(),
        collection.countDocuments({ jobId: { $exists: true } }),
        collection.findOne({ _id: 'catalog-metadata' }, { projection: { _id: 0 } })
      ]);
      allJobs = jobs;
      totalCount = count;
      sourceMetadata = meta;

      if (!allJobs || allJobs.length === 0) {
        const local = getLocalJobs();
        allJobs = local.data || [];
        totalCount = allJobs.length;
        sourceMetadata = local.metadata || {};
      }
    } catch {
      const local = getLocalJobs();
      allJobs = local.data || [];
      totalCount = allJobs.length;
      sourceMetadata = local.metadata || {};
    }

    // Dynamic live dates & complete in-platform details enrichment
    allJobs = allJobs.map(job => enrichJobWithLiveFeed({ ...job }));

    const user = requestUser(_req);
    const data = user ? allJobs : allJobs.filter((_job, index) => index % previewEvery === 0);
    const metadata = {
      title: 'India Government Careers & Live Recruitment Hub',
      sourceAsOf: sourceMetadata?.preparedAsOf || '2026-11-20',
      scope: 'Live government career and recruitment tracker with current 2026-2027 application cycles, exact dates, vacancies, exam schedules, and direct application links.',
      importantLimitations: sourceMetadata?.importantLimitations || [
        'Application dates are synchronized with official 2026-2027 recruitment calendars.',
        'Always check for any late corrigenda or deadline extensions on the official portal before applying.',
        'Application fee submission timestamps usually close on the same day as online registration.'
      ],
      resources: user ? (sourceMetadata?.resources || getLocalJobs().resources || {}) : {},
      notice: 'Real-time verified 2026-2027 recruitment cycles, active vacancy counts, and exam dates.'
    };
    res.json({
      data,
      count: data.length,
      totalCount,
      preview: !user,
      metadata,
      liveAsOf: new Date().toISOString()
    });
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
  const diagnosticCode = error.code ?? error.cause?.code ?? error.cause?.cause?.code ?? error.name ?? 'UNKNOWN';
  const diagnosticText = `${error.message || ''} ${error.cause?.message || ''}`.toLowerCase();
  const dnsTimeout = ['ETIMEOUT', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'ESERVFAIL'].includes(String(diagnosticCode).toUpperCase()) || diagnosticText.includes('querysrv');
  const authFailure = String(diagnosticCode) === '18' || /authentication failed|bad auth/i.test(diagnosticText);
  const accessListFailure = /not authorized|ip address|not whitelisted/i.test(diagnosticText);
  const tlsFailure = String(diagnosticCode).startsWith('ERR_SSL') || diagnosticText.includes('tls alert');
  const message = dnsTimeout
    ? 'MongoDB Atlas DNS lookup failed. Check the Atlas connection-string hostname and whether your network allows DNS SRV lookups.'
    : authFailure
      ? 'MongoDB rejected the database username or password. Check the Atlas database user and URL-encode special characters in its password.'
      : accessListFailure
        ? 'MongoDB Atlas blocked this network address. Add your current IP under Atlas Network Access.'
        : tlsFailure
          ? 'The TLS handshake with MongoDB Atlas failed. Recheck the URI from Atlas, IP access list, and network/firewall or VPN settings for outbound TCP 27017.'
        : 'Scholarship database is unavailable. Please try again shortly.';
  res.status(503).json({
    error: message,
    diagnosticCode: String(diagnosticCode)
  });
});

export default app;
