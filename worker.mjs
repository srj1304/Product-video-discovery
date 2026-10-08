import { db } from '../db/database.mjs';
import { executeSearch } from '../searchService.mjs';
import { nowIso } from '../utils/time.mjs';

let timer = null;
let running = false;


function recoverStaleJobs() {
  const cutoff = new Date(Date.now() - 10 * 60_000).toISOString();
  db.prepare("UPDATE jobs SET status='PENDING',next_run_at=?,error_code='STALE_RECOVERY',error_message='Recovered after worker restart or timeout' WHERE status='RUNNING' AND started_at<?").run(nowIso(), cutoff);
}

function claimJob() {
  const now = nowIso();
  const candidate = db.prepare(`SELECT id FROM jobs WHERE status='PENDING' AND (next_run_at IS NULL OR next_run_at<=?) ORDER BY priority ASC, COALESCE(next_run_at, created_at) ASC LIMIT 1`).get(now);
  if (!candidate) return null;
  const result = db.prepare(`UPDATE jobs SET status='RUNNING', attempts=attempts+1, started_at=? WHERE id=? AND status='PENDING'`).run(now, candidate.id);
  return result.changes ? db.prepare('SELECT * FROM jobs WHERE id=?').get(candidate.id) : null;
}

async function tick() {
  if (running) return;
  running = true;
  try {
    recoverStaleJobs();
    const job = claimJob();
    if (!job) return;
    const search = db.prepare('SELECT * FROM searches WHERE id=?').get(job.search_id);
    if (!search) {
      db.prepare('UPDATE jobs SET status=?,completed_at=?,error_code=?,error_message=? WHERE id=?').run('FAILED', nowIso(), 'SEARCH_NOT_FOUND', 'Search not found', job.id);
      return;
    }
    const input = { inputType: search.input_type, input: search.raw_input, showPreviouslySeen: Boolean(search.show_previously_seen) };
    await executeSearch(search.id, { id: search.user_id }, input, job.id);
  } finally { running = false; }
}

export function startJobWorker() {
  if (timer) return;
  timer = setInterval(() => tick().catch(() => {}), 500);
  timer.unref?.();
  tick().catch(() => {});
}

export function stopJobWorker() { if (timer) clearInterval(timer); timer = null; }
