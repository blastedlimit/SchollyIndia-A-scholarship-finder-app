# Scholly India

Scholarship search app with an Express API and a local SQLite database. The database is seeded from the included CSV and contains 222 scholarship records, including 100 MBBS scholarships.

## Run locally

1. Install Node.js 24 or newer.
2. Run `npm install` in this folder.
3. Run `npm run dev` and open `http://localhost:3000`.

The API is available at `/api/scholarships`; `/api/health` reports the database status and record count. Supabase is not used and no database credentials are required.

## Scholarship database

`data/scholly.sqlite` is the SQLite database read by the app. `data/scholarships.csv` is the source data. To refresh the database after editing the CSV, run `npm run seed`, then commit the updated CSV and SQLite file.

The app opens the SQLite file read-only. On Netlify the database is packaged with the function, so scholarship data changes take effect after rebuilding and redeploying. This project does not provide a live admin editor or persistent database writes. Deadlines and eligibility are indicative catalogue data and must be confirmed with the scholarship provider; entries marked `Varies` do not have a dependable date in this dataset. Application-link values may identify a provider homepage rather than a specific application form.

## Deploy to Netlify

Import this repository from GitHub. The included `netlify.toml` sets `public/` as the publish directory, packages the SQLite file with the function, and rewrites `/api/*` requests to the Express function. No Supabase environment variables are needed. Push commits to the production branch to trigger a new deploy.
