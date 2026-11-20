import 'dotenv/config';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI;

if (!uri) {
  throw new Error('MONGODB_URI is missing. Check the .env file in the project root.');
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectDir = existsSync(join(process.cwd(), 'data', 'scholarships.json')) ? process.cwd() : join(scriptDir, '..');
const jsonPath = join(projectDir, 'data', 'scholarships.json');

const rows = JSON.parse(readFileSync(jsonPath, 'utf8'));

const client = new MongoClient(uri);

try {
  await client.connect();

  const collection = client.db('schollyindia').collection('scholarships');
  await collection.createIndex({ legacy_id: 1 }, { unique: true });
  await collection.createIndex({ scholarship_name: 1 });

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

  console.log(`Imported or updated ${rows.length} scholarships with live dates and feed details in MongoDB Atlas.`);
} finally {
  await client.close();
}
