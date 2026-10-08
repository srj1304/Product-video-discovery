import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const envPath = path.join(root, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const idx = t.indexOf('=');
    if (idx < 1) continue;
    const key = t.slice(0, idx).trim();
    const value = t.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!(key in process.env)) process.env[key] = value;
  }
}

const n = (v, d) => Number.isFinite(Number(v)) ? Number(v) : d;
export const CONFIG = {
  host: process.env.HOST || '127.0.0.1',
  port: n(process.env.PORT, 8787),
  nodeEnv: process.env.NODE_ENV || 'development',
  appOrigin: process.env.APP_ORIGIN || 'http://localhost:5173',
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  sessionTtlMs: n(process.env.SESSION_TTL_HOURS, 12) * 3600_000,
  sourceMode: process.env.SOURCE_MODE || 'fixture',
  maxCandidatesPerSource: n(process.env.MAX_CANDIDATES_PER_SOURCE, 100),
  maxQueriesPerSource: n(process.env.MAX_QUERIES_PER_SOURCE, 8),
  maxSearchRuntimeMs: n(process.env.MAX_SEARCH_RUNTIME_MS, 120_000),
  geminiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-3.8-flash',
  adminEmail: process.env.ADMIN_EMAIL || 'admin@example.com',
  adminPassword: process.env.ADMIN_PASSWORD || 'change-me-now',
};
