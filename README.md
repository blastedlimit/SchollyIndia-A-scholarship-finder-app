# Scholly India

Scholarship discovery site backed by a Node.js/Express API and Supabase.

## Run locally

1. Install Node.js 20 or newer.
2. Run `npm install` in this folder.
3. Copy `.env.example` to `.env` and set `SUPABASE_URL` and `SUPABASE_ANON_KEY` from your Supabase project settings.
4. Run `npm run dev` and open `http://localhost:3000`.

The browser requests scholarship data from `/api/scholarships`; Supabase credentials are read by the server from `.env` and are not embedded in the frontend. The health endpoint is `/api/health`.

## Supabase table

The existing `Scholarships` table should expose these columns (names are case-sensitive where your database requires it):

| Column | Suggested type |
| --- | --- |
| scholarship_name | text |
| provider_name | text |
| scholarship_type | text |
| target_state | text |
| target_gender | text |
| eligible_categories | text |
| eligible_courses | text |
| max_family_income_inr | numeric |
| min_academic_percentage | numeric |
| reward_amount_text | text |
| deadline_month | text |
| application_link | text |

For public scholarship browsing, enable Row Level Security and add a SELECT policy for `anon` on this table. Keep write access restricted to trusted administrators. The application uses the publishable/anon key on the server, so the database policy remains the access boundary. Never put a service role key in the browser or commit `.env`.

## CSV data

The supplied CSV has matching scholarship columns. Import it into the `Scholarships` table using the Supabase Table Editor's CSV import, mapping each column by name. Ensure numeric columns are imported as numbers and application links are text/URLs. The site reads the table live, so imported or edited records appear on the next request.

## Deploy

Deploy this folder to a Node.js host, set the same environment variables in the host's secret settings, and use `npm start`. Configure the host's build step as `npm install` and its start command as `npm start`.
