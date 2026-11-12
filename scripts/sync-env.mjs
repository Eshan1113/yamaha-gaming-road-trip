import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const envPath = path.join(rootDir, '.env');
const outConfigPath = path.join(rootDir, 'config.js');

export function parseEnvFile(filePath) {
  const vars = {};
  if (!fs.existsSync(filePath)) return vars;
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIdx = line.indexOf('=');
    if (eqIdx <= 0) continue;
    const key = line.slice(0, eqIdx).trim();
    let val = line.slice(eqIdx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    vars[key] = val;
  }
  return vars;
}

const fileVars = parseEnvFile(envPath);
const getVar = (k, fallback = '') => String(process.env[k] || fileVars[k] || fallback).trim();

const publicConfig = {
  supabaseUrl: getVar('SUPABASE_URL'),
  supabasePublishableKey: getVar('SUPABASE_PUBLISHABLE_KEY'),
  supabaseTable: getVar('SUPABASE_TABLE', 'leaderboard_entries'),
  campaignFollowUrl: getVar('CAMPAIGN_FOLLOW_URL', 'https://www.facebook.com/YamahaLK/'),
  apiBase: ''
};

// Intentionally NEVER writes SUPABASE_SECRET_KEY into config.js (safe for GitHub Pages static hosting).
const content = `// Auto-generated from .env by scripts/sync-env.mjs (publishable browser config only)\nwindow.__XSR_CONFIG__ = ${JSON.stringify(publicConfig, null, 2)};\n`;
fs.writeFileSync(outConfigPath, content, 'utf8');
console.log(`Synced public client config -> ${path.relative(rootDir, outConfigPath)}`);
