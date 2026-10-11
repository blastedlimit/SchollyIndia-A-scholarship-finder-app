import express from 'express';
import { createRequire } from 'node:module';
import { join } from 'node:path';

// Load this Node built-in at runtime so Netlify's bundler doesn't rewrite
// `node:sqlite` to a nonexistent npm package named `sqlite`.
const require = createRequire(join(process.cwd(), 'package.json'));
const { DatabaseSync } = require('node:sqlite');

const app = express();
const projectDir = process.cwd();
const publicDir = join(projectDir, 'public');
const databasePath = join(projectDir, 'data', 'scholly.sqlite');
const database = new DatabaseSync(databasePath, { readOnly: true });
const allScholarships = database.prepare(`
  SELECT scholarship_name, provider_name, scholarship_type, target_state,
    target_gender, eligible_categories, eligible_courses, max_family_income_inr,
    min_academic_percentage, reward_amount_text, deadline_month, application_link
  FROM scholarships
  ORDER BY scholarship_name COLLATE NOCASE
`).all();

app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', databaseConfigured: true, scholarshipCount: allScholarships.length });
});

app.get('/api/scholarships', (_req, res) => {
  res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
  res.json({ data: allScholarships, count: allScholarships.length });
});

app.use(express.static(publicDir, { extensions: ['html'] }));

export default app;
