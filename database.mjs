import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const dataDir = path.join(process.cwd(), 'backend', 'data');
fs.mkdirSync(dataDir, { recursive: true });
const dbPath = path.join(dataDir, 'app.sqlite');
export const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

export function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('USER','ADMIN')) DEFAULT 'USER',
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at TEXT NOT NULL,
      last_login_at TEXT
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT UNIQUE NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      ip_hash TEXT,
      user_agent TEXT,
      revoked_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);
    CREATE TABLE IF NOT EXISTS searches (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      input_type TEXT NOT NULL CHECK(input_type IN ('TEXT','URL')),
      raw_input TEXT NOT NULL,
      show_previously_seen INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      config_version_id TEXT,
      prompt_version TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_search_user_created ON searches(user_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS product_intents (
      id TEXT PRIMARY KEY,
      search_id TEXT NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      category TEXT,
      brand TEXT,
      product_family TEXT,
      model TEXT,
      variant TEXT,
      sku TEXT,
      target_granularity TEXT,
      identity_confidence REAL,
      ambiguity_level TEXT,
      explicit_constraints_json TEXT NOT NULL,
      inferred_evidence_json TEXT NOT NULL,
      raw_extraction_json TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(search_id, version)
    );
    CREATE INDEX IF NOT EXISTS idx_intent_search ON product_intents(search_id, version DESC);
    CREATE TABLE IF NOT EXISTS product_sources (
      id TEXT PRIMARY KEY,
      search_id TEXT NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
      product_intent_id TEXT REFERENCES product_intents(id),
      url TEXT NOT NULL,
      normalized_url TEXT NOT NULL,
      domain TEXT NOT NULL,
      title TEXT,
      description TEXT,
      main_image_url TEXT,
      structured_data_json TEXT,
      fetch_status TEXT NOT NULL,
      content_hash TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_product_sources_url ON product_sources(normalized_url);
    CREATE TABLE IF NOT EXISTS intent_conflicts (
      id TEXT PRIMARY KEY,
      product_intent_id TEXT NOT NULL REFERENCES product_intents(id) ON DELETE CASCADE,
      attribute_key TEXT NOT NULL,
      source_a TEXT NOT NULL,
      value_a TEXT,
      source_b TEXT NOT NULL,
      value_b TEXT,
      severity TEXT NOT NULL,
      status TEXT NOT NULL,
      resolution_source TEXT,
      resolution_value TEXT,
      created_at TEXT NOT NULL,
      resolved_at TEXT
    );
    CREATE TABLE IF NOT EXISTS search_queries (
      id TEXT PRIMARY KEY,
      search_id TEXT NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
      platform TEXT NOT NULL,
      query TEXT NOT NULL,
      query_type TEXT NOT NULL,
      priority INTEGER NOT NULL,
      expansion_level INTEGER NOT NULL,
      status TEXT NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_queries_search_platform ON search_queries(search_id, platform, status, priority);
    CREATE TABLE IF NOT EXISTS videos (
      id TEXT PRIMARY KEY,
      platform TEXT NOT NULL,
      external_video_id TEXT,
      canonical_url TEXT NOT NULL,
      normalized_url TEXT NOT NULL,
      thumbnail_url TEXT,
      caption TEXT,
      ad_copy TEXT,
      publisher_name TEXT,
      published_at TEXT,
      media_hash TEXT,
      perceptual_hash TEXT,
      metadata_json TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      UNIQUE(platform, external_video_id)
    );
    CREATE INDEX IF NOT EXISTS idx_videos_platform_hash ON videos(platform, perceptual_hash);
    CREATE INDEX IF NOT EXISTS idx_videos_normalized_url ON videos(normalized_url);
    CREATE TABLE IF NOT EXISTS video_discoveries (
      id TEXT PRIMARY KEY,
      search_query_id TEXT NOT NULL REFERENCES search_queries(id) ON DELETE CASCADE,
      video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
      source_page TEXT,
      raw_position INTEGER,
      raw_metadata_json TEXT NOT NULL,
      discovered_at TEXT NOT NULL,
      UNIQUE(search_query_id, video_id)
    );
    CREATE TABLE IF NOT EXISTS video_evaluations (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
      search_id TEXT NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
      candidate_score REAL NOT NULL,
      visual_score REAL,
      final_score REAL,
      confidence REAL,
      classification TEXT NOT NULL,
      hard_constraint_status TEXT NOT NULL,
      evidence_quality TEXT,
      matched_evidence_json TEXT NOT NULL,
      mismatched_evidence_json TEXT NOT NULL,
      unknown_evidence_json TEXT NOT NULL,
      verification_stage TEXT NOT NULL,
      frames_checked INTEGER NOT NULL DEFAULT 0,
      model_provider TEXT,
      model_name TEXT,
      prompt_version TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_eval_search_score ON video_evaluations(search_id, final_score DESC);
    CREATE TABLE IF NOT EXISTS search_results (
      id TEXT PRIMARY KEY,
      search_id TEXT NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
      video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
      platform TEXT NOT NULL,
      rank INTEGER NOT NULL,
      final_score REAL NOT NULL,
      display_status TEXT NOT NULL,
      shown_at TEXT NOT NULL,
      UNIQUE(search_id, video_id)
    );
    CREATE INDEX IF NOT EXISTS idx_results_search_platform ON search_results(search_id, platform, rank);
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      search_id TEXT NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
      job_type TEXT NOT NULL,
      status TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 100,
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at TEXT,
      started_at TEXT,
      completed_at TEXT,
      next_run_at TEXT,
      error_code TEXT,
      error_message TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, priority, next_run_at);
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      search_id TEXT NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
      job_id TEXT,
      event_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      sequence_no INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(search_id, sequence_no)
    );
    CREATE TABLE IF NOT EXISTS config_versions (
      id TEXT PRIMARY KEY,
      version INTEGER NOT NULL UNIQUE,
      config_json TEXT NOT NULL,
      created_by TEXT,
      reason TEXT,
      is_active INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS image_analysis_cache (
      id TEXT PRIMARY KEY,
      image_key TEXT UNIQUE NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt_version TEXT NOT NULL,
      result_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_used_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS visual_cache (
      id TEXT PRIMARY KEY,
      cache_key TEXT UNIQUE NOT NULL,
      video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
      product_image_key TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt_version TEXT NOT NULL,
      stage TEXT NOT NULL,
      result_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_used_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_visual_cache_video ON visual_cache(video_id, stage);

    CREATE TABLE IF NOT EXISTS ai_runs (
      id TEXT PRIMARY KEY,
      search_id TEXT,
      agent_name TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      operation TEXT NOT NULL,
      input_tokens INTEGER,
      output_tokens INTEGER,
      latency_ms INTEGER,
      status TEXT NOT NULL,
      error_code TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS url_fetches (
      id TEXT PRIMARY KEY,
      search_id TEXT NOT NULL,
      url TEXT NOT NULL,
      normalized_url TEXT NOT NULL,
      status TEXT NOT NULL,
      http_status INTEGER,
      redirect_count INTEGER NOT NULL DEFAULT 0,
      content_type TEXT,
      content_hash TEXT,
      error_code TEXT,
      duration_ms INTEGER,
      created_at TEXT NOT NULL
    );
  `);

  // Lightweight migrations for databases created by earlier prototype versions.
  const columns = (table) => new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((r) => r.name));
  const jobCols = columns('jobs');
  if (!jobCols.has('next_run_at')) db.exec('ALTER TABLE jobs ADD COLUMN next_run_at TEXT');
  if (!jobCols.has('created_at')) db.exec('ALTER TABLE jobs ADD COLUMN created_at TEXT');

  // New tables are idempotent; create them here too so an existing MVP DB upgrades in place.
  db.exec(`
    CREATE TABLE IF NOT EXISTS image_analysis_cache (
      id TEXT PRIMARY KEY, image_key TEXT UNIQUE NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL,
      prompt_version TEXT NOT NULL, result_json TEXT NOT NULL, created_at TEXT NOT NULL, last_used_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS visual_cache (
      id TEXT PRIMARY KEY, cache_key TEXT UNIQUE NOT NULL, video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
      product_image_key TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL, prompt_version TEXT NOT NULL,
      stage TEXT NOT NULL, result_json TEXT NOT NULL, created_at TEXT NOT NULL, last_used_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_visual_cache_video ON visual_cache(video_id, stage);
    CREATE INDEX IF NOT EXISTS idx_image_cache_key ON image_analysis_cache(image_key);
  `);
}
