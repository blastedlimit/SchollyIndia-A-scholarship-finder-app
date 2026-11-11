# Scholly India

Live site: https://schollyindia.netlify.app/

Scholarship discovery app with an Express API, MongoDB Atlas storage, and a static frontend. The initial scholarship catalogue is imported from `data/scholly.sqlite` into the `schollyindia.scholarships` collection.

## Run locally

1. Install Node.js 24 or newer and run `npm install`.
2. Create a `.env` file in the project root with:

   ```env
   MONGODB_URI="your MongoDB Atlas connection string"
   AUTH_SECRET="a random secret of at least 32 characters"
   RESEND_API_KEY="your Resend API key"
   MAIL_FROM="Scholly India <passwords@send.yourdomain.com>"
   APP_BASE_URL="http://localhost:3000"
   ```

3. Import the starter catalogue with `node scripts/import-to-mongodb.js`.
4. Run `npm run dev` and open `http://localhost:3000`.

`.env.example` shows the required variable names and formats. Copy it to `.env`, replace the placeholders, and keep `.env` private. To make password recovery email work, use a sender domain you control:

1. Create a Resend account and open its **Domains** page.
2. Add a domain or sending subdomain that you own, such as `send.example.com`.
3. Resend will show the DNS records required for verification. Add those records at the company where that domain's DNS is managed, then wait until Resend marks the domain verified. Resend's SPF/DKIM records authorize sending for your domain; use the exact values shown in your account. See [Resend domain verification](https://resend.com/docs/dashboard/domains/introduction).
4. In Resend, create an API key and put it in `RESEND_API_KEY`.
5. Set `MAIL_FROM` to a sender on the verified domain, for example `Scholly India <passwords@send.example.com>`. Replace `example.com` with your own verified domain; a Gmail address is not a substitute for a verified sending domain. Resend's email API expects a `from` sender and recipient; see its [email API docs](https://resend.com/docs/api-reference/emails/send-email).
6. Set `APP_BASE_URL` to `http://localhost:3000` for local use. On Netlify, use the full deployed site URL, such as `https://your-site.netlify.app`.

For a first test, send a reset link to an account you control and check Resend's **Emails** page for delivery status. Keep the Resend API key only in `.env` locally and in Netlify's function-scoped environment variables when deployed.

The API is available at `/api/scholarships`; `/api/health` reports the MongoDB connection status, scholarship count, and whether password-recovery mail is configured. Guests receive a stable preview of about one third of the catalogue. Registered users receive the full catalogue. Account endpoints are `/api/auth/register`, `/api/auth/login`, `/api/auth/me`, `/api/auth/logout`, `/api/auth/forgot-password`, and `/api/auth/reset-password`.

## Data and accounts

MongoDB Atlas is the runtime database. The SQLite file and CSV are retained as the source catalogue for the initial import and future manual refreshes. The importer upserts records by their original SQLite ID, so it can be rerun safely.

User passwords are hashed with Node's `scrypt`; sessions use a signed, HTTP-only cookie. Sign-up normalizes email addresses and MongoDB enforces a unique email index. Password recovery uses one-time, 30-minute reset links sent through Resend. Configure a Resend API key and verified sender before recovery emails can be delivered. Set a strong, unique `AUTH_SECRET` locally and in your hosting provider's environment settings. Never commit `.env` or expose secrets in browser code. Scholarship details and deadlines still need confirmation from the official provider.

## Deploy to Netlify

The included `netlify.toml` configures `public/` as the publish directory and routes `/api/*` to the Netlify Function. In Netlify's environment variable settings, add `MONGODB_URI`, `AUTH_SECRET`, `RESEND_API_KEY`, `MAIL_FROM`, and `APP_BASE_URL`, with Function runtime scope enabled. `APP_BASE_URL` must be your deployed site URL. Deploy after saving the variables.
