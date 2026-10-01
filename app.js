import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { fileURLToPath } from 'node:url';

const app = express();
const publicDir = fileURLToPath(new URL('./public/', import.meta.url));
const { SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;
const supabase = SUPABASE_URL && SUPABASE_ANON_KEY
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    })
  : null;

app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', databaseConfigured: Boolean(supabase) });
});

app.get('/api/scholarships', async (_req, res) => {
  if (!supabase) {
    return res.status(503).json({ error: 'Scholarship database is not configured. Add Supabase settings to your host environment.' });
  }

  try {
    const pageSize = 1000;
    const rows = [];
    for (let from = 0; from < 10000; from += pageSize) {
      const { data, error } = await supabase
        .from('Scholarships')
        .select('*')
        .order('scholarship_name', { ascending: true })
        .range(from, from + pageSize - 1);
      if (error) throw error;
      rows.push(...(data || []));
      if (!data || data.length < pageSize) break;
    }
    res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    res.json({ data: rows, count: rows.length });
  } catch (error) {
    console.error('Scholarship query failed:', error.message);
    res.status(502).json({ error: 'Scholarship data could not be loaded. Check the Supabase table and permissions.' });
  }
});

app.use(express.static(publicDir, { extensions: ['html'] }));

export default app;
