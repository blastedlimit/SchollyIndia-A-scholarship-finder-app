import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';

const sourcePath = fileURLToPath(new URL('../data/government-jobs.json', import.meta.url));
const source = JSON.parse(await readFile(sourcePath, 'utf8'));
const uri = process.env.MONGODB_URI;
const databaseName = process.env.MONGODB_DATABASE || 'schollyindia';

if (!uri) throw new Error('MONGODB_URI is missing. Add your Atlas URI to the project .env file.');
if (!Array.isArray(source.data) || source.data.length === 0) throw new Error('The government jobs data file has no records.');

const client = new MongoClient(uri);
try {
  await client.connect();
  const collection = client.db(databaseName).collection('government_jobs');
  await collection.createIndex({ jobId: 1 }, { unique: true });
  await collection.createIndex({ sourceSheet: 1, region: 1, title: 1 });
  const operations = source.data.map(record => ({
    updateOne: {
      filter: { jobId: record.jobId },
      update: { $set: record },
      upsert: true
    }
  }));
  const result = await collection.bulkWrite(operations, { ordered: false });
  await collection.updateOne(
    { _id: 'catalog-metadata' },
    { $set: { ...source.metadata, resources: source.resources, recordCount: source.data.length } },
    { upsert: true }
  );
  console.log(`Government jobs guide imported: ${source.data.length} records (${result.upsertedCount} new, ${result.modifiedCount} updated).`);
} finally {
  await client.close();
}
