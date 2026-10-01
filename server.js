import 'dotenv/config';
import app from './app.js';

const port = Number(process.env.PORT) || 3000;

app.listen(port, () => {
  console.log(`Scholly India running at http://localhost:${port}`);
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    console.warn('Supabase is not configured. Copy .env.example to .env and add your project settings.');
  }
});
