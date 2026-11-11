import 'dotenv/config';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI;

if (!uri) {
  throw new Error('MONGODB_URI is missing. Check the .env file in the project root.');
}

const projectDir = process.cwd();
const require = createRequire(join(projectDir, 'package.json'));
const { DatabaseSync } = require('node:sqlite');
const sqlite = new DatabaseSync(join(projectDir, 'data', 'scholly.sqlite'), {
  readOnly: true
});

const rows = sqlite.prepare(`
  SELECT id, scholarship_name, provider_name, scholarship_type, target_state,
    target_gender, eligible_categories, eligible_courses, max_family_income_inr,
    min_academic_percentage, reward_amount_text, deadline_month, application_link
  FROM scholarships
`).all();

const client = new MongoClient(uri);

try {
  await client.connect();

  const collection = client.db('schollyindia').collection('scholarships');
  await collection.createIndex({ legacy_id: 1 }, { unique: true });

  const operations = rows.map(row => ({
    updateOne: {
      filter: { legacy_id: row.id },
      update: { $set: { ...row, legacy_id: row.id } },
      upsert: true
    }
  }));

  if (operations.length) {
    await collection.bulkWrite(operations);
  }

  console.log(`Imported or updated ${rows.length} scholarships in MongoDB Atlas.`);
} finally {
  sqlite.close();
  await client.close();
}
