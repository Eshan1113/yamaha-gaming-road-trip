import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '.env');

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
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
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
}

loadDotEnv(envPath);

const PORT = Number(process.env.PORT || 3000);
const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_PUBLISHABLE_KEY = String(process.env.SUPABASE_PUBLISHABLE_KEY || '').trim();
const SUPABASE_SECRET_KEY = String(process.env.SUPABASE_SECRET_KEY || '').trim();
const SUPABASE_TABLE = String(process.env.SUPABASE_TABLE || 'leaderboard_entries').trim();
const CAMPAIGN_FOLLOW_URL = String(process.env.CAMPAIGN_FOLLOW_URL || 'https://www.facebook.com/YamahaLK/').trim();

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
};

function buildSupabaseHeaders(apiKey, extra = {}) {
  const headers = {
    apikey: apiKey,
    Accept: 'application/json',
    ...extra
  };
  if (apiKey.startsWith('eyJ')) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  return headers;
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > 64 * 1024) {
        reject(new Error('Payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

async function handleApiRequest(req, res, urlPath) {
  const activeKey = SUPABASE_SECRET_KEY || SUPABASE_PUBLISHABLE_KEY;

  if (urlPath === '/api/health' && req.method === 'GET') {
    if (!SUPABASE_URL || !activeKey) {
      return sendJson(res, 500, { ok: false, error: 'Missing Supabase .env variables' });
    }
    try {
      const resp = await fetch(
        `${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}?select=id&limit=1`,
        { headers: buildSupabaseHeaders(activeKey) }
      );
      const text = await resp.text();
      if (resp.ok) {
        return sendJson(res, 200, { ok: true, table: SUPABASE_TABLE, mode: SUPABASE_SECRET_KEY ? 'secret_key' : 'publishable_key' });
      }
      const pendingSetup = resp.status === 404 || text.includes('PGRST205');
      return sendJson(res, resp.status, { ok: false, pendingSetup, detail: text });
    } catch (err) {
      return sendJson(res, 502, { ok: false, error: err.message || 'Network error' });
    }
  }

  if (urlPath === '/api/leaderboard' && req.method === 'GET') {
    if (!SUPABASE_URL || !activeKey) {
      return sendJson(res, 500, { error: 'Missing Supabase .env configuration' });
    }
    try {
      const resp = await fetch(
        `${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}?select=id,player_name,mobile_number,score,markers_collected,obstacles_avoided,created_at&order=score.desc,created_at.asc&limit=50`,
        { headers: buildSupabaseHeaders(activeKey) }
      );
      const text = await resp.text();
      res.writeHead(resp.status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
      });
      return res.end(text);
    } catch (err) {
      return sendJson(res, 502, { error: err.message || 'Supabase fetch failed' });
    }
  }

  if (urlPath === '/api/leaderboard' && req.method === 'POST') {
    if (!SUPABASE_URL || !activeKey) {
      return sendJson(res, 500, { error: 'Missing Supabase .env configuration' });
    }
    try {
      const body = await readJsonBody(req);
      const entry = {
        player_name: String(body.player_name || '').trim().slice(0, 60),
        mobile_number: String(body.mobile_number || '').trim().slice(0, 24),
        score: Math.max(0, Math.round(Number(body.score) || 0)),
        markers_collected: Math.max(0, Math.round(Number(body.markers_collected) || 0)),
        obstacles_avoided: Math.max(0, Math.round(Number(body.obstacles_avoided) || 0))
      };
      if (entry.player_name.length < 2 || entry.mobile_number.replace(/\D/g, '').length < 7) {
        return sendJson(res, 400, { error: 'Invalid rider name or mobile number' });
      }
      const resp = await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}`, {
        method: 'POST',
        headers: buildSupabaseHeaders(activeKey, {
          'Content-Type': 'application/json',
          Prefer: 'return=representation'
        }),
        body: JSON.stringify(entry)
      });
      const text = await resp.text();
      res.writeHead(resp.status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
      });
      return res.end(text);
    } catch (err) {
      return sendJson(res, 400, { error: err.message || 'Invalid request' });
    }
  }

  return sendJson(res, 404, { error: 'Unknown API endpoint' });
}

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url || '/', `http://localhost:${PORT}`);
  const urlPath = decodeURIComponent(reqUrl.pathname);

  if (urlPath.startsWith('/api/')) {
    return handleApiRequest(req, res, urlPath);
  }

  // Serve dynamic client config from .env (with apiBase enabled, NEVER exposing SUPABASE_SECRET_KEY)
  if (urlPath === '/config.js') {
    const clientCfg = {
      supabaseUrl: SUPABASE_URL,
      supabasePublishableKey: SUPABASE_PUBLISHABLE_KEY,
      supabaseTable: SUPABASE_TABLE,
      campaignFollowUrl: CAMPAIGN_FOLLOW_URL,
      apiBase: '/api'
    };
    res.writeHead(200, {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-store'
    });
    return res.end(`window.__XSR_CONFIG__ = ${JSON.stringify(clientCfg, null, 2)};\n`);
  }

  // Block dotfiles (.env, .gitignore) and private server/scripts from HTTP serving
  const relPath = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const segments = relPath.split(/[\\/]/).filter(Boolean);
  if (
    segments.some((s) => s.startsWith('.') || s === '..') ||
    relPath === 'server.mjs' ||
    relPath === 'package.json' ||
    relPath.startsWith('scripts/') ||
    relPath.startsWith('supabase/')
  ) {
    res.writeHead(404);
    return res.end('Not found');
  }

  const fullPath = path.resolve(__dirname, relPath);
  if (!fullPath.startsWith(__dirname + path.sep) && fullPath !== path.join(__dirname, 'index.html')) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.readFile(fullPath, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not found');
    }
    const ext = path.extname(fullPath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=86400'
    });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Yamaha XSR Kiosk Server running at http://localhost:${PORT}`);
  console.log(`Supabase URL: ${SUPABASE_URL || '(NOT SET)'} | Table: ${SUPABASE_TABLE}`);
});
