import { db } from './db/database.mjs';
import { id } from './utils/id.mjs';
import { nowIso } from './utils/time.mjs';
import { CONFIG } from './config.mjs';

const defaults = {
  matching: {
    candidate_threshold: 55,
    high_visual_threshold: 88,
    possible_visual_threshold: 60,
    high_confidence: 0.85,
    frame_escalation_enabled: true,
    final_candidate_weight: 0.4,
    final_visual_weight: 0.6,
  },
  retrieval: {
    max_queries_per_source: CONFIG.maxQueriesPerSource,
    max_candidates_per_query: 60,
    max_total_candidates_per_source: CONFIG.maxCandidatesPerSource,
    target_per_source: 20,
  },
  ai: {
    primary_provider: CONFIG.geminiKey ? 'gemini' : 'heuristic',
    model: CONFIG.geminiModel,
    max_verification_calls: 30,
    max_frame_passes: 2,
    frames_per_pass: 3,
    frame_escalation_enabled: true,
  },
  runtime: { source_mode: CONFIG.sourceMode },
};

export function ensureConfig() {
  if (!db.prepare('SELECT 1 FROM config_versions LIMIT 1').get()) {
    db.prepare(`INSERT INTO config_versions(id,version,config_json,created_by,reason,is_active,created_at) VALUES(?,?,?,?,?,?,?)`).run(id('cfg'), 1, JSON.stringify(defaults), null, 'MVP defaults', 1, nowIso());
  }
}
export function getActiveConfig() {
  const row = db.prepare('SELECT * FROM config_versions WHERE is_active=1 ORDER BY version DESC LIMIT 1').get();
  return row ? JSON.parse(row.config_json) : defaults;
}
