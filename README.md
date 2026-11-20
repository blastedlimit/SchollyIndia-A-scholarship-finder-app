# Scholly India — Build Your Future

**Live site:** https://schollyindia.netlify.app/

India's all-in-one scholarship and government career discovery platform. Students can explore **219 live scholarships** and **232 government recruitment routes** — with real application open dates, closing deadlines, exam dates, admit card dates, and direct official portal links — all in one place.

---

## ✨ Features

- 🎓 **219 Scholarships** with live open/close dates, days-left countdown, and eligibility details
- 🏛️ **232 Government Career Routes** (UPSC, SSC, RRB, IBPS, State PSCs, Defence, and more) with real 2026–2027 exam schedules
- 📅 **Live Date Feed** — real application windows and exam dates sourced from official portals (upsc.gov.in, ssc.nic.in, ibps.in, scholarships.gov.in, etc.)
- 🔔 Status badges: `OPEN`, `CLOSING SOON`, `UPCOMING`, `CLOSED` — computed in real time
- 🔍 Smart search + filters (category, state, qualification, route type)
- ⭐ Save scholarships and government career routes across sessions
- 🤖 **AI-powered recommender** — ranks scholarships by profile match (course, category, state, income, marks) using TF-IDF + cosine similarity, computed locally
- 🔐 Full auth system — register, login, password recovery via email
- 👁️ Guest preview mode — ~1/3 of catalogue visible without login; full catalogue unlocked on sign-in

---

## 🚀 Run Locally

### 1. Prerequisites

- Node.js 24 or newer
- A free [MongoDB Atlas](https://www.mongodb.com/atlas) cluster
- A free [Resend](https://resend.com) account (for password recovery emails)

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment

Create a `.env` file in the project root (copy from `.env.example`):

```env
MONGODB_URI="your MongoDB Atlas connection string"
AUTH_SECRET="a random secret of at least 32 characters"
RESEND_API_KEY="your Resend API key"
MAIL_FROM="Scholly India <passwords@send.yourdomain.com>"
APP_BASE_URL="http://localhost:3000"
```

### 4. Seed the database

```bash
# Import scholarship catalogue (219 records)
node scripts/import-scholarships.js

# Import government careers catalogue (232 records)
npm run seed:jobs
```

### 5. Start the server

```bash
npm run dev
```

Open `http://localhost:3000` in your browser.

> **Note:** The app works without MongoDB too — it falls back to the local JSON files in `data/` automatically.

---

## 📅 Live Dates System

Scholarship and government career dates are stored in:

| File | Records | Fields |
|------|---------|--------|
| `data/scholarships.json` | 219 | `open_date`, `close_date`, `listing_status`, `days_left`, `application_fee`, `documents_required`, `how_to_apply` |
| `data/government-jobs.json` | 232 | `applicationOpenDate`, `applicationCloseDate`, `examDate`, `admitCardDate`, `vacancies`, `salaryOrPay`, `applicationFee`, `selectionStages`, `howToApply` |

All dates are in `YYYY-MM-DD` format, verified against official government portals for the **2026–2027 recruitment cycle**. The `computeLiveDates()` function in `app.js` dynamically calculates `listing_status` and `days_left` on every API request so the displayed status is always current.

**Official sources used:**
- Scholarships: `scholarships.gov.in`, `mahadbt.maharashtra.gov.in`, `minorityaffairs.gov.in`, state scholarship portals
- Government Careers: `upsc.gov.in`, `ssc.nic.in`, `ibps.in`, `indianrailways.gov.in`, `nta.ac.in`, state PSC portals

> **Important:** Always verify exact dates, eligibility, and vacancies on the official portal before applying. Deadlines can change via corrigenda after our data was last verified.

---

## 🏛️ Government Careers Guide

`data/government-jobs.json` contains **232 records** across three recruitment categories:

| Category | Examples |
|----------|---------|
| **National Exams** | UPSC CSE, IFoS, ESE, NDA, CDS; SSC CGL, CHSL, MTS, CPO; RRB NTPC, ALP, Group D; IBPS PO, Clerk, SO; NTA JEE, NEET |
| **State / UT Routes** | All 28 States + 8 UTs — PSC exams, subordinate service commissions |
| **Sector Routes** | Defence (Army, Navy, Air Force); Teaching (NVS, KVS, DSSSB); Banking; Insurance; PSUs |

Each record includes: exam dates, application window, admit card release, vacancies, pay scale, eligibility, selection stages, application fee, and direct official URL.

---

## 🤖 AI-Powered Scholarship Recommender

When a signed-in student saves a profile, Scholly India ranks scholarships using a local content-based recommender:

- Builds **TF-IDF vectors** from scholarship names, providers, courses, categories, and states
- Computes **cosine similarity** between the student profile and each listing
- Combines text similarity (20%) with weighted eligibility-fit score (80%):

| Factor | Weight |
|--------|--------|
| Course match | 28% |
| Category match | 24% |
| State match | 18% |
| Income eligibility | 16% |
| Academic percentage | 14% |

Computed entirely in the browser — no student data is sent to any external AI service.

---

## 🔐 Auth & Security

- Passwords hashed with Node's `scrypt`
- Sessions via signed, HTTP-only cookie
- Email normalized; unique index enforced in MongoDB
- Password recovery: one-time 30-minute reset links via Resend
- Never commit `.env` or expose `AUTH_SECRET` in client code

---

## 🌐 API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/scholarships` | All scholarships with live dates, status, days left |
| `GET /api/jobs` | All government career routes with live recruitment schedule |
| `GET /api/health` | MongoDB status, record counts, mail config status |
| `POST /api/auth/register` | Create account |
| `POST /api/auth/login` | Sign in |
| `GET /api/auth/me` | Current user info |
| `POST /api/auth/logout` | Sign out |
| `POST /api/auth/forgot-password` | Send reset link |
| `POST /api/auth/reset-password` | Reset password with token |

---

## ☁️ Deploy to Netlify

1. The included `netlify.toml` sets `public/` as publish directory and routes `/api/*` to the Netlify Function.
2. In Netlify → **Site settings → Environment variables**, add:
   - `MONGODB_URI`
   - `AUTH_SECRET`
   - `RESEND_API_KEY`
   - `MAIL_FROM`
   - `APP_BASE_URL` (your deployed site URL, e.g. `https://schollyindia.netlify.app`)
3. Enable **Function runtime scope** for environment variables.
4. Deploy — the app is live.

---

## 🗂️ Project Structure

```
SchollyIndia-A-scholarship-finder-app/
├── app.js                    # Express server, API routes, auth, live date enrichment
├── public/
│   ├── index.html            # Single-page app shell
│   ├── style.css             # All styles, animations, responsive layout
│   └── style.js              # Frontend logic (search, filter, detail modals, recommender)
├── data/
│   ├── scholarships.json     # 219 scholarships with live dates (source of truth)
│   └── government-jobs.json  # 232 govt career routes with live exam schedule
├── scripts/
│   ├── import-scholarships.js  # Seeds scholarship data to MongoDB
│   └── import-government-jobs.js  # Seeds govt jobs data to MongoDB
├── netlify/
│   └── functions/            # Netlify serverless function wrapper
├── .env.example              # Environment variable template
└── netlify.toml              # Netlify deployment config
```

---

## 📧 Email (Password Recovery) Setup

1. Create a [Resend](https://resend.com) account and go to **Domains**.
2. Add a domain you own (e.g. `send.example.com`) and add the DNS records Resend shows.
3. Wait for Resend to mark the domain **Verified**.
4. Create a Resend API key → add to `RESEND_API_KEY`.
5. Set `MAIL_FROM` to a sender on the verified domain (e.g. `Scholly India <passwords@send.example.com>`).
6. Test: send a reset link to yourself and check Resend's **Emails** dashboard.

> Gmail addresses cannot be used as the `MAIL_FROM` sender — a Resend-verified domain is required.

---

## 🛠️ Tech Stack

| Layer | Tech |
|-------|------|
| Backend | Node.js 24, Express |
| Database | MongoDB Atlas (with local JSON fallback) |
| Frontend | Vanilla JS, CSS3 animations |
| Auth | scrypt password hash, signed HTTP-only cookie |
| Email | Resend API |
| Deployment | Netlify (Functions + static site) |
| AI/Recommender | TF-IDF + cosine similarity (browser-side, no external API) |

---

*Built with ❤️ to help Indian students discover and apply for scholarships and government careers — all in one place.*
