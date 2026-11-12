import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnvFile } from './sync-env.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const envVars = parseEnvFile(path.join(rootDir, '.env'));

const supabaseUrl = (process.env.SUPABASE_URL || envVars.SUPABASE_URL || '').replace(/\/+$/, '');
const secretKey = process.env.SUPABASE_SECRET_KEY || envVars.SUPABASE_SECRET_KEY || '';
const pubKey = process.env.SUPABASE_PUBLISHABLE_KEY || envVars.SUPABASE_PUBLISHABLE_KEY || '';
const table = process.env.SUPABASE_TABLE || envVars.SUPABASE_TABLE || 'leaderboard_entries';

if (!supabaseUrl || !(secretKey || pubKey)) {
  console.error('Missing SUPABASE_URL or API key in .env');
  process.exit(1);
}

const activeKey = secretKey || pubKey;
const headers = { apikey: activeKey, Accept: 'application/json' };
if (activeKey.startsWith('eyJ')) {
  headers.Authorization = `Bearer ${activeKey}`;
}

const endpoint = `${supabaseUrl}/rest/v1/${table}?select=id,player_name,score,created_at&order=score.desc&limit=5`;
try {
  const resp = await fetch(endpoint, { headers });
  const body = await resp.text();
  if (resp.ok) {
    console.log(`Supabase OK (${resp.status}) - table "${table}" exists! Sample rows:`, body);
    process.exit(0);
  }
  console.error(`Supabase returned HTTP ${resp.status}:`, body);
  if (resp.status === 404 || body.includes('PGRST205')) {
    console.error(`Action needed: Run supabase/schema.sql inside Supabase Dashboard -> SQL Editor to create "${table}".`);
  }
  process.exit(2);
} catch (err) {
  console.error('Network error reaching Supabase:', err.message || err);
  process.exit(3);
}
