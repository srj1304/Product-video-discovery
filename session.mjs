import { createHash, randomBytes } from 'node:crypto';
import { db } from '../db/database.mjs';
import { id } from '../utils/id.mjs';
import { nowIso } from '../utils/time.mjs';
import { CONFIG } from '../config.mjs';

const sha = (v) => createHash('sha256').update(v).digest('hex');
export function createSession(userId, meta = {}) {
  const raw = randomBytes(32).toString('base64url');
  const created = nowIso();
  const expires = new Date(Date.now() + CONFIG.sessionTtlMs).toISOString();
  db.prepare(`INSERT INTO sessions(id,user_id,token_hash,created_at,expires_at,last_seen_at,ip_hash,user_agent) VALUES(?,?,?,?,?,?,?,?)`)
    .run(id('ses'), userId, sha(raw), created, expires, created, meta.ip ? sha(meta.ip) : null, meta.userAgent || null);
  return { raw, expiresAt: expires };
}
export function getSession(raw) {
  if (!raw) return null;
  const row = db.prepare(`SELECT s.*,u.email,u.role,u.status FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.revoked_at IS NULL`).get(sha(raw));
  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= Date.now() || row.status !== 'ACTIVE') return null;
  db.prepare(`UPDATE sessions SET last_seen_at=? WHERE id=?`).run(nowIso(), row.id);
  return row;
}
export function revokeSession(raw) {
  if (!raw) return;
  db.prepare(`UPDATE sessions SET revoked_at=? WHERE token_hash=?`).run(nowIso(), sha(raw));
}
