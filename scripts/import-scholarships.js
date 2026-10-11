import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const csvPath = fileURLToPath(new URL('../data/scholarships.csv', import.meta.url));
const databasePath = fileURLToPath(new URL('../data/scholly.sqlite', import.meta.url));
const headers = [
  'scholarship_name', 'provider_name', 'scholarship_type', 'target_state',
  'target_gender', 'eligible_categories', 'eligible_courses',
  'max_family_income_inr', 'min_academic_percentage', 'reward_amount_text',
  'deadline_month', 'application_link'
];

function parseCsv(input) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"' && field.length === 0) {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[i + 1] === '\n') i += 1;
      row.push(field);
      if (row.some(value => value !== '')) rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (field.length || row.length) {
    row.push(field);
    if (row.some(value => value !== '')) rows.push(row);
  }
  return rows;
}

function asNumber(value) {
  if (!value?.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

const csv = readFileSync(csvPath, 'utf8').replace(/^\uFEFF/, '');
const [csvHeaders, ...rows] = parseCsv(csv);
if (!csvHeaders || headers.some((header, i) => csvHeaders[i]?.trim() !== header)) {
  throw new Error('CSV headers do not match the expected scholarship columns.');
}
if (rows.some(row => row.length !== headers.length)) {
  throw new Error('A CSV row has an unexpected number of columns.');
}

const database = new DatabaseSync(databasePath);
database.exec(`
  DROP TABLE IF EXISTS scholarships;
  CREATE TABLE scholarships (
    id INTEGER PRIMARY KEY,
    scholarship_name TEXT NOT NULL,
    provider_name TEXT,
    scholarship_type TEXT,
    target_state TEXT,
    target_gender TEXT,
    eligible_categories TEXT,
    eligible_courses TEXT,
    max_family_income_inr REAL,
    min_academic_percentage REAL,
    reward_amount_text TEXT,
    deadline_month TEXT,
    application_link TEXT
  );
`);

const insert = database.prepare(`
  INSERT INTO scholarships (
    scholarship_name, provider_name, scholarship_type, target_state,
    target_gender, eligible_categories, eligible_courses,
    max_family_income_inr, min_academic_percentage, reward_amount_text,
    deadline_month, application_link
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

database.exec('BEGIN');
try {
  for (const item of rows) {
    insert.run(
      item[0], item[1], item[2], item[3], item[4], item[5], item[6],
      asNumber(item[7]), asNumber(item[8]), item[9], item[10], item[11]
    );
  }
  database.exec('COMMIT');
} catch (error) {
  database.exec('ROLLBACK');
  throw error;
}
database.exec('CREATE INDEX scholarships_name_idx ON scholarships(scholarship_name COLLATE NOCASE)');
database.close();

console.log(`Imported ${rows.length} scholarships into ${databasePath}`);
