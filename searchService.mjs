import { db } from './db/database.mjs';
import { id } from './utils/id.mjs';
import { nowIso } from './utils/time.mjs';
import { emitSearchEvent } from './events/eventBus.mjs';
import { productUnderstand } from './agents/productAgent.mjs';
import { extractVisualAttributes } from './agents/visualAttributes.mjs';
import { visualMatch } from './agents/visualAgent.mjs';
import { buildQueries } from './agents/queryAgent.mjs';
import { collectSource } from './collectors/sourceCollector.mjs';
import { candidateScore, hardConstraintGate, finalScore } from './pipeline/scoring.mjs';
import { dedupeCandidates, urlHash } from './pipeline/dedup.mjs';
import { safePerceptualHash, imageKey } from './pipeline/phash.mjs';
import { thumbnailDecision } from './pipeline/framePolicy.mjs';
import { sampleVideoFrames } from './pipeline/frameExtractor.mjs';
import { resolveProductUrl } from './urlResolver.mjs';
import { findReferenceImage } from './collectors/browserCollector.mjs';
import { CONFIG } from './config.mjs';
import { getActiveConfig } from './configStore.mjs';
import { safeJson } from './utils/json.mjs';
import { withRetry } from './utils/retry.mjs';

const TARGET = 20;
const PROMPT_VERSION = 'v2';

function latestIntent(searchId) { return db.prepare('SELECT * FROM product_intents WHERE search_id=? ORDER BY version DESC LIMIT 1').get(searchId); }
function parseIntent(row) {
  if (!row) return null;
  return { ...row, explicit_constraints: safeJson(row.explicit_constraints_json, {}), inferred_evidence: safeJson(row.inferred_evidence_json, {}), raw_extraction: safeJson(row.raw_extraction_json, {}) };
}
function sourceStats(searchId) {
  const rows = db.prepare(`SELECT platform, COUNT(*) c FROM search_results WHERE search_id=? GROUP BY platform`).all(searchId);
  return Object.fromEntries(rows.map((r) => [r.platform, Number(r.c)]));
}
function nowMs(searchId) { const row = db.prepare('SELECT created_at FROM searches WHERE id=?').get(searchId); return row ? Date.now() - new Date(row.created_at).getTime() : 0; }

function getSourceMode(cfg) { return cfg.runtime?.source_mode || CONFIG.sourceMode; }

async function enrichPerceptualHash(candidate) {
  if (!candidate.thumbnailUrl || candidate.perceptualHash) return candidate;
  const ph = await safePerceptualHash(candidate.thumbnailUrl);
  return { ...candidate, perceptualHash: ph };
}

function upsertVideo(c) {
  const normalized = c.normalizedUrl || c.canonicalUrl;
  let existing = c.externalVideoId
    ? db.prepare('SELECT * FROM videos WHERE platform=? AND external_video_id=?').get(c.platform, c.externalVideoId)
    : null;
  if (!existing) existing = db.prepare('SELECT * FROM videos WHERE platform=? AND normalized_url=?').get(c.platform, normalized);
  const now = nowIso();
  if (existing) {
    db.prepare(`UPDATE videos SET last_seen_at=?, thumbnail_url=COALESCE(?,thumbnail_url), caption=COALESCE(?,caption), ad_copy=COALESCE(?,ad_copy), media_hash=COALESCE(?,media_hash), perceptual_hash=COALESCE(?,perceptual_hash), metadata_json=? WHERE id=?`)
      .run(now, c.thumbnailUrl || null, c.caption || null, c.adCopy || null, urlHash(c.canonicalUrl), c.perceptualHash || null, JSON.stringify(c.metadata || {}), existing.id);
    return existing.id;
  }
  const vid = id('vid');
  db.prepare(`INSERT INTO videos(id,platform,external_video_id,canonical_url,normalized_url,thumbnail_url,caption,ad_copy,publisher_name,published_at,media_hash,perceptual_hash,metadata_json,first_seen_at,last_seen_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(vid, c.platform, c.externalVideoId || null, c.canonicalUrl, normalized, c.thumbnailUrl || null, c.caption || null, c.adCopy || null, c.publisherName || null, c.publishedAt || null, urlHash(c.canonicalUrl), c.perceptualHash || null, JSON.stringify(c.metadata || {}), now, now);
  return vid;
}

function seedQueries(searchId, platform, intent, cfg) {
  const limit = Number(cfg.retrieval?.max_queries_per_source || CONFIG.maxQueriesPerSource);
  const queries = buildQueries(intent, platform).slice(0, limit);
  const existing = new Set(db.prepare('SELECT query FROM search_queries WHERE search_id=? AND platform=?').all(searchId, platform).map((r) => r.query.toLowerCase()));
  let priority = Number(db.prepare('SELECT COALESCE(MAX(priority),0) p FROM search_queries WHERE search_id=? AND platform=?').get(searchId, platform).p) + 1;
  for (const q of queries) {
    if (existing.has(q.query.toLowerCase())) continue;
    db.prepare(`INSERT INTO search_queries(id,search_id,platform,query,query_type,priority,expansion_level,status,attempt_count,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`)
      .run(id('qry'), searchId, platform, q.query, q.queryType, priority++, q.expansionLevel, 'PENDING', 0, nowIso());
    existing.add(q.query.toLowerCase());
  }
}

function recordDiscovery(searchQueryId, candidate, videoId, index) {
  db.prepare(`INSERT OR IGNORE INTO video_discoveries(id,search_query_id,video_id,source_page,raw_position,raw_metadata_json,discovered_at) VALUES(?,?,?,?,?,?,?)`)
    .run(id('dsc'), searchQueryId, videoId, candidate.sourcePage || null, candidate.rawPosition ?? index, JSON.stringify(candidate.metadata || {}), nowIso());
}

function alreadyShownToUser(userId, searchId) {
  return new Set(db.prepare(`SELECT sr.video_id FROM search_results sr JOIN searches s ON s.id=sr.search_id WHERE s.user_id=? AND sr.search_id<>?`).all(userId, searchId).map((r) => r.video_id));
}

function visualCacheKey(videoId, referenceUrl, stage) { return `${videoId}:${imageKey(referenceUrl)}:${stage}:${CONFIG.geminiModel}:${PROMPT_VERSION}`; }
function readVisualCache(videoId, referenceUrl, stage) {
  if (!referenceUrl) return null;
  const row = db.prepare('SELECT result_json FROM visual_cache WHERE cache_key=?').get(visualCacheKey(videoId, referenceUrl, stage));
  if (!row) return null;
  db.prepare('UPDATE visual_cache SET last_used_at=? WHERE cache_key=?').run(nowIso(), visualCacheKey(videoId, referenceUrl, stage));
  return safeJson(row.result_json, null);
}
function writeVisualCache(videoId, referenceUrl, stage, result) {
  if (!referenceUrl || !result) return;
  const key = visualCacheKey(videoId, referenceUrl, stage); const now = nowIso();
  db.prepare(`INSERT OR REPLACE INTO visual_cache(id,cache_key,video_id,product_image_key,provider,model,prompt_version,stage,result_json,created_at,last_used_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id('vcache'), key, videoId, imageKey(referenceUrl), CONFIG.geminiKey ? 'gemini' : 'heuristic', CONFIG.geminiModel, PROMPT_VERSION, stage, JSON.stringify(result), now, now);
}

function referenceImageFromIntent(intent) { return intent?.inferred_evidence?.reference_image_url || intent?.inferred_evidence?.visual_reference_url || null; }

async function getProductVisuals(searchId, intent, referenceUrl) {
  if (!referenceUrl || !CONFIG.geminiKey) return null;
  const key = imageKey(referenceUrl); const cached = db.prepare('SELECT result_json FROM image_analysis_cache WHERE image_key=?').get(key);
  if (cached) {
    db.prepare('UPDATE image_analysis_cache SET last_used_at=? WHERE image_key=?').run(nowIso(), key);
    return safeJson(cached.result_json, null);
  }
  try {
    const result = await extractVisualAttributes(referenceUrl, searchId);
    const now = nowIso();
    db.prepare(`INSERT OR REPLACE INTO image_analysis_cache(id,image_key,provider,model,prompt_version,result_json,created_at,last_used_at) VALUES(?,?,?,?,?,?,?,?)`)
      .run(id('icache'), key, 'gemini', CONFIG.geminiModel, PROMPT_VERSION, JSON.stringify(result), now, now);
    return result;
  } catch { return null; }
}

async function verifyThumbnail(searchId, intent, candidate, referenceUrl, fixture, cfg) {
  if (fixture) {
    const exact = Boolean(candidate.metadata?.exact);
    const variant = Boolean(candidate.metadata?.variant);
    return { classification: exact ? 'EXACT_MATCH' : variant ? 'VARIANT_MATCH' : 'IRRELEVANT', score: exact ? 94 : variant ? 72 : 35, confidence: exact ? 0.94 : 0.60, evidence_quality: exact ? 'HIGH' : 'MEDIUM', product_visibility: 'HIGH', matched_evidence: exact ? ['candidate fixture represents the requested product'] : [], mismatched_evidence: variant ? ['fixture is a variant rather than exact'] : [], unknown_evidence: [] };
  }
  const cached = readVisualCache(candidate.videoId, referenceUrl, 'THUMBNAIL');
  if (cached) return cached;
  if (!referenceUrl || !candidate.thumbnailUrl || !CONFIG.geminiKey) return { classification: 'UNCERTAIN', score: 0, confidence: 0, evidence_quality: 'LOW', product_visibility: 'UNKNOWN', matched_evidence: [], mismatched_evidence: [], unknown_evidence: ['Reference image or AI provider unavailable'] };
  const result = await visualMatch({ productImageUrl: referenceUrl, candidateImageUrl: candidate.thumbnailUrl, intent, candidate, searchId, stage: 'THUMBNAIL' });
  writeVisualCache(candidate.videoId, referenceUrl, 'THUMBNAIL', result);
  return result;
}

async function escalateFrames(searchId, intent, candidate, referenceUrl, currentVisual, cfg) {
  if (!cfg.ai?.frame_escalation_enabled || !candidate.mediaUrl || !referenceUrl || !CONFIG.geminiKey) return { visual: currentVisual, framesChecked: 0, stage: 'THUMBNAIL' };
  const passes = Math.max(1, Number(cfg.ai?.max_frame_passes || 2));
  const perPass = Math.max(1, Number(cfg.ai?.frames_per_pass || 3));
  let best = currentVisual; let framesChecked = 0;
  for (let pass = 0; pass < passes; pass += 1) {
    try {
      const frames = await sampleVideoFrames(candidate.mediaUrl, perPass);
      for (const frame of frames) {
        framesChecked += 1;
        try {
          const result = await visualMatch({ productImageUrl: referenceUrl, candidateImageData: frame, intent, candidate, searchId, stage: 'FRAME' });
          const currentQuality = Number(best.confidence || 0) * Number(best.score || 0);
          const resultQuality = Number(result.confidence || 0) * Number(result.score || 0);
          if (resultQuality > currentQuality) best = result;
          const decision = thumbnailDecision({ score: Number(result.score || 0), confidence: Number(result.confidence || 0), evidenceQuality: result.evidence_quality, visibility: result.product_visibility });
          if (decision.decision === 'ACCEPT' && result.classification === 'EXACT_MATCH') return { visual: result, framesChecked, stage: 'FRAME' };
        } catch {}
      }
    } catch { break; }
  }
  return { visual: best, framesChecked, stage: framesChecked ? 'FRAME' : 'THUMBNAIL' };
}

async function evaluateCandidates(searchId, userId, intent, candidates, jobId, state, referenceUrl) {
  const cfg = getActiveConfig();
  const searchRow = db.prepare('SELECT show_previously_seen FROM searches WHERE id=?').get(searchId);
  const seenIds = searchRow?.show_previously_seen ? new Set() : alreadyShownToUser(userId, searchId);
  const eligible = [];
  for (const raw of candidates) {
    if (state.evaluated.has(raw.videoId)) continue;
    state.evaluated.add(raw.videoId);
    if (seenIds.has(raw.videoId)) continue;
    const gate = hardConstraintGate(intent, raw);
    if (!gate.pass) continue;
    const cs = candidateScore(intent, raw);
    if (cs < Number(cfg.matching?.candidate_threshold ?? 55)) continue;
    eligible.push({ ...raw, candidateScore: cs, gate });
  }
  eligible.sort((a, b) => b.candidateScore - a.candidateScore);
  const budget = Math.max(0, Number(cfg.ai?.max_verification_calls || 30) - state.aiCalls);
  const shortlist = eligible.slice(0, budget);
  const accepted = [];
  emitSearchEvent(searchId, 'thumbnail.verification.started', { count: shortlist.length }, jobId);
  const fixture = getSourceMode(cfg) === 'fixture';

  for (const c of shortlist) {
    state.aiCalls += 1;
    let visual;
    try { visual = await verifyThumbnail(searchId, intent, c, referenceUrl, fixture, cfg); }
    catch (e) { visual = { classification: 'UNCERTAIN', score: 0, confidence: 0, evidence_quality: 'LOW', product_visibility: 'UNKNOWN', matched_evidence: [], mismatched_evidence: [], unknown_evidence: [e.message] }; }
    const thumbDecision = thumbnailDecision({ score: Number(visual.score || 0), confidence: Number(visual.confidence || 0), evidenceQuality: visual.evidence_quality, visibility: visual.product_visibility });
    let framesChecked = 0; let verificationStage = 'THUMBNAIL';
    if (thumbDecision.decision === 'ESCALATE') {
      const escalated = await escalateFrames(searchId, intent, c, referenceUrl, visual, cfg);
      visual = escalated.visual; framesChecked = escalated.framesChecked; verificationStage = escalated.stage;
      if (verificationStage === 'FRAME') emitSearchEvent(searchId, 'frame.verification.completed', { videoId: c.videoId, framesChecked, classification: visual.classification, score: visual.score }, jobId);
    }
    const score = Number(visual.score || 0); const confidence = Number(visual.confidence || 0);
    const hardMismatch = (visual.mismatched_evidence || []).some((x) => /hard constraint|requested|colour|color|edition|model/i.test(String(x))) && visual.classification !== 'EXACT_MATCH';
    const acceptedNow = !hardMismatch && visual.classification === 'EXACT_MATCH' && score >= Number(cfg.matching?.high_visual_threshold ?? 88) && confidence >= Number(cfg.matching?.high_confidence ?? 0.85);
    const classification = acceptedNow ? 'EXACT_MATCH' : (visual.classification || 'UNCERTAIN');
    const fs = finalScore(c.candidateScore, score, cfg.matching?.final_candidate_weight, cfg.matching?.final_visual_weight);
    db.prepare(`INSERT INTO video_evaluations(id,video_id,search_id,candidate_score,visual_score,final_score,confidence,classification,hard_constraint_status,evidence_quality,matched_evidence_json,mismatched_evidence_json,unknown_evidence_json,verification_stage,frames_checked,model_provider,model_name,prompt_version,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id('eval'), c.videoId, searchId, c.candidateScore, score, fs, confidence, classification, 'PASS', visual.evidence_quality || 'UNKNOWN', JSON.stringify(visual.matched_evidence || []), JSON.stringify(visual.mismatched_evidence || []), JSON.stringify(visual.unknown_evidence || []), verificationStage, framesChecked, fixture ? 'heuristic' : CONFIG.geminiKey ? 'gemini' : 'none', fixture ? 'fixture' : CONFIG.geminiModel, PROMPT_VERSION, nowIso());
    if (acceptedNow) accepted.push({ ...c, finalScore: fs, verificationStage, framesChecked, visual });
  }
  return accepted.sort((a, b) => b.finalScore - a.finalScore);
}

async function runSource(searchId, platform, intent, userId, jobId, referenceUrl) {
  const cfg = getActiveConfig();
  const sourceMode = getSourceMode(cfg);
  emitSearchEvent(searchId, 'source.search.started', { platform }, jobId);
  seedQueries(searchId, platform, intent, cfg);
  const all = []; const accepted = []; const acceptedIds = new Set(); const state = { evaluated: new Set(), aiCalls: 0 };
  let sourceQueries = 0;
  while (accepted.length < TARGET && sourceQueries < Number(cfg.retrieval?.max_queries_per_source || CONFIG.maxQueriesPerSource) && nowMs(searchId) < CONFIG.maxSearchRuntimeMs) {
    const q = db.prepare(`SELECT * FROM search_queries WHERE search_id=? AND platform=? AND status='PENDING' ORDER BY priority ASC LIMIT 1`).get(searchId, platform);
    if (!q) break;
    sourceQueries += 1;
    db.prepare('UPDATE search_queries SET status=?,attempt_count=attempt_count+1 WHERE id=?').run('RUNNING', q.id);
    try {
      const { candidates, mode } = await withRetry(
        () => collectSource(platform, q.query, Math.min(Number(cfg.retrieval?.max_candidates_per_query || 60), Number(cfg.retrieval?.max_total_candidates_per_source || CONFIG.maxCandidatesPerSource)), sourceMode),
        {
          retries: 2,
          baseDelayMs: 500,
          maxDelayMs: 4000,
          shouldRetry: (error) => !error?.code || ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN'].includes(error.code),
        }
      );
      for (let i = 0; i < candidates.length; i += 1) {
        const candidate = await enrichPerceptualHash(candidates[i]);
        const vid = upsertVideo(candidate);
        recordDiscovery(q.id, candidate, vid, i);
        const existing = db.prepare('SELECT * FROM videos WHERE id=?').get(vid);
        all.push({ ...candidate, ...existing, videoId: vid });
      }
      db.prepare('UPDATE search_queries SET status=?,completed_at=? WHERE id=?').run('COMPLETED', nowIso(), q.id);
      emitSearchEvent(searchId, 'source.candidates.found', { platform, query: q.query, count: candidates.length, mode, accepted: accepted.length }, jobId);
      const unique = dedupeCandidates(all);
      const newAccepted = await evaluateCandidates(searchId, userId, intent, unique, jobId, state, referenceUrl);
      for (const item of newAccepted) if (!acceptedIds.has(item.videoId)) { acceptedIds.add(item.videoId); accepted.push(item); }
    } catch (e) {
      db.prepare('UPDATE search_queries SET status=?,completed_at=? WHERE id=?').run('FAILED', nowIso(), q.id);
      emitSearchEvent(searchId, 'source.query.failed', { platform, query: q.query, error: e.message }, jobId);
    }
  }
  emitSearchEvent(searchId, 'source.collection.completed', { platform, rawCount: all.length, uniqueCount: dedupeCandidates(all).length, acceptedCount: accepted.length, target: TARGET }, jobId);
  if (accepted.length < TARGET) emitSearchEvent(searchId, 'source.shortfall', { platform, count: accepted.length, target: TARGET, reason: 'No more queries/candidates or source limits reached' }, jobId);
  return { candidates: dedupeCandidates(all), accepted: accepted.slice(0, TARGET) };
}

async function resolveReferenceForText(input, intentObj, searchId, cfg) {
  if (intentObj.inferred_evidence?.reference_image_url) return intentObj.inferred_evidence.reference_image_url;
  const mode = getSourceMode(cfg);
  if (mode !== 'browser') return null;
  try {
    const query = [intentObj.brand, intentObj.product_family, intentObj.model, intentObj.variant, ...Object.values(intentObj.explicit_constraints || {})].filter(Boolean).join(' ');
    const image = await findReferenceImage(query);
    return image || null;
  } catch { return null; }
}

async function resolveListingFromCache(searchId, input) {
  let normalizedInput = input;
  try { normalizedInput = new URL(input).toString(); } catch {}
  const cached = db.prepare('SELECT * FROM product_sources WHERE normalized_url IN (?,?) ORDER BY created_at DESC LIMIT 1').get(input, normalizedInput);
  if (!cached || cached.fetch_status !== 'SUCCESS') return null;
  const source = { url: cached.url, normalizedUrl: cached.normalized_url, domain: cached.domain, title: cached.title, description: cached.description, mainImageUrl: cached.main_image_url, sku: null, structuredData: safeJson(cached.structured_data_json, []), contentHash: cached.content_hash };
  return source;
}

export async function executeSearch(searchId, user, input, jobId) {
  db.prepare('UPDATE searches SET status=?,started_at=COALESCE(started_at,?) WHERE id=?').run('RUNNING', nowIso(), searchId);
  emitSearchEvent(searchId, 'search.started', { searchId }, jobId);
  try {
    const cfg = getActiveConfig();
    let listing = null;
    if (input.inputType === 'URL') {
      const cached = await resolveListingFromCache(searchId, input.input);
      if (cached) listing = cached;
      else {
        emitSearchEvent(searchId, 'product.fetch.started', { url: input.input }, jobId);
        listing = await resolveProductUrl(input.input, searchId, (f) => db.prepare(`INSERT INTO url_fetches(id,search_id,url,normalized_url,status,http_status,redirect_count,content_type,content_hash,duration_ms,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(id('fetch'), f.searchId, f.url, f.normalizedUrl, f.status, f.httpStatus, f.redirectCount, f.contentType, f.contentHash, f.durationMs, nowIso()));
        db.prepare(`INSERT INTO product_sources(id,search_id,url,normalized_url,domain,title,description,main_image_url,structured_data_json,fetch_status,content_hash,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(id('src'), searchId, listing.url, listing.normalizedUrl, listing.domain, listing.title, listing.description, listing.mainImageUrl, JSON.stringify(listing.structuredData || []), 'SUCCESS', listing.contentHash, nowIso());
      }
      emitSearchEvent(searchId, 'product.fetch.completed', { title: listing.title, hasImage: Boolean(listing.mainImageUrl), cached: Boolean(db.prepare('SELECT 1 FROM product_sources WHERE normalized_url=? AND search_id<>?').get(listing.normalizedUrl, searchId)) }, jobId);
    }

    const intentObj = await productUnderstand({ source: input.inputType, text: input.input, listing, useAi: Boolean(CONFIG.geminiKey) });
    if (CONFIG.geminiKey && listing?.mainImageUrl) {
      const existingImageAnalysis = db.prepare(`SELECT result_json FROM image_analysis_cache WHERE image_key=?`).get(imageKey(listing.mainImageUrl));
      if (existingImageAnalysis) intentObj.inferred_evidence = { ...(intentObj.inferred_evidence || {}), visual_attributes: safeJson(existingImageAnalysis.result_json, {}) };
      else {
        const attrs = await getProductVisuals(searchId, intentObj, listing.mainImageUrl);
        if (attrs) intentObj.inferred_evidence = { ...(intentObj.inferred_evidence || {}), visual_attributes: attrs };
      }
    }

    const rawListingText = listing ? [listing.title, listing.description].filter(Boolean).join(' ') : '';
    const colors = ['black','white','red','blue','green','yellow','pink','brown','grey','gray','beige'];
    const listingColor = colors.find((c) => new RegExp(`\\b${c}\\b`, 'i').test(rawListingText)) || null;
    const userColor = intentObj.explicit_constraints?.color;
    const conflicts = [...(intentObj.conflicts || [])];
    if (userColor && listingColor && listingColor !== String(userColor).toLowerCase()) conflicts.push({ attribute_key: 'color', source_a: 'USER_TEXT', value_a: userColor, source_b: 'PRODUCT_URL', value_b: listingColor, severity: 'HIGH' });
    if (input.inputType === 'URL' && listing?.sku && intentObj.sku && listing.sku !== intentObj.sku) conflicts.push({ attribute_key: 'sku', source_a: 'PRODUCT_INTENT', value_a: intentObj.sku, source_b: 'PRODUCT_URL', value_b: listing.sku, severity: 'HIGH' });
    intentObj.conflicts = conflicts;

    if (!listing?.mainImageUrl && input.inputType === 'TEXT') {
      const reference = await resolveReferenceForText(input, intentObj, searchId, cfg);
      if (reference) intentObj.inferred_evidence = { ...(intentObj.inferred_evidence || {}), reference_image_url: reference, reference_image_source: 'PUBLIC_IMAGE_SEARCH' };
    } else if (listing?.mainImageUrl) intentObj.inferred_evidence = { ...(intentObj.inferred_evidence || {}), reference_image_url: listing.mainImageUrl, reference_image_source: 'PRODUCT_URL' };

    const version = Number(db.prepare('SELECT COALESCE(MAX(version),0) v FROM product_intents WHERE search_id=?').get(searchId).v) + 1;
    const intentId = id('intent');
    const intentStatus = intentObj.conflicts?.length ? 'WAITING_FOR_CLARIFICATION' : 'CONFIRMED';
    db.prepare(`INSERT INTO product_intents(id,search_id,version,category,brand,product_family,model,variant,sku,target_granularity,identity_confidence,ambiguity_level,explicit_constraints_json,inferred_evidence_json,raw_extraction_json,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(intentId, searchId, version, intentObj.category || null, intentObj.brand || null, intentObj.product_family || null, intentObj.model || null, intentObj.variant || null, intentObj.sku || null, intentObj.target_granularity, intentObj.identity_confidence, intentObj.ambiguity_level, JSON.stringify(intentObj.explicit_constraints || {}), JSON.stringify(intentObj.inferred_evidence || {}), JSON.stringify(intentObj), intentStatus, nowIso());
    for (const c of intentObj.conflicts || []) db.prepare(`INSERT INTO intent_conflicts(id,product_intent_id,attribute_key,source_a,value_a,source_b,value_b,severity,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(id('conf'), intentId, c.attribute_key || c.attribute || 'unknown', c.source_a || 'UNKNOWN', c.value_a || null, c.source_b || 'UNKNOWN', c.value_b || null, c.severity || 'HIGH', 'UNRESOLVED', nowIso());

    if (intentStatus === 'WAITING_FOR_CLARIFICATION') {
      db.prepare('UPDATE searches SET status=? WHERE id=?').run('WAITING_FOR_CLARIFICATION', searchId);
      db.prepare('UPDATE jobs SET status=?,completed_at=? WHERE id=?').run('WAITING', nowIso(), jobId);
      emitSearchEvent(searchId, 'product.conflict_detected', { intentId, conflicts: intentObj.conflicts }, jobId);
      return;
    }

    emitSearchEvent(searchId, 'product.resolved', { intentId, identity: { category: intentObj.category, brand: intentObj.brand, productFamily: intentObj.product_family, model: intentObj.model, variant: intentObj.variant }, targetGranularity: intentObj.target_granularity, ambiguity: intentObj.ambiguity_level, referenceImage: Boolean(intentObj.inferred_evidence?.reference_image_url) }, jobId);
    const intent = parseIntent(db.prepare('SELECT * FROM product_intents WHERE id=?').get(intentId));
    const referenceUrl = referenceImageFromIntent(intent);

    const [ig, meta] = await Promise.all([
      runSource(searchId, 'INSTAGRAM', intent, user.id || user.user_id, jobId, referenceUrl),
      runSource(searchId, 'META', intent, user.id || user.user_id, jobId, referenceUrl),
    ]);

    const insertResults = (platform, arr) => {
      const top = arr.slice(0, TARGET);
      top.forEach((c, i) => db.prepare(`INSERT OR IGNORE INTO search_results(id,search_id,video_id,platform,rank,final_score,display_status,shown_at) VALUES(?,?,?,?,?,?,?,?)`).run(id('res'), searchId, c.videoId, platform, i + 1, c.finalScore, 'SHOWN', nowIso()));
      return top.length;
    };
    const igCount = insertResults('INSTAGRAM', ig.accepted); const metaCount = insertResults('META', meta.accepted);
    emitSearchEvent(searchId, 'dedup.completed', { instagramCandidates: ig.candidates.length, metaCandidates: meta.candidates.length, instagramAccepted: igCount, metaAccepted: metaCount }, jobId);
    const status = (igCount >= TARGET && metaCount >= TARGET) ? 'COMPLETED' : 'COMPLETED_WITH_SHORTFALL';
    db.prepare('UPDATE searches SET status=?,completed_at=? WHERE id=?').run(status, nowIso(), searchId);
    db.prepare('UPDATE jobs SET status=?,completed_at=? WHERE id=?').run('COMPLETED', nowIso(), jobId);
    emitSearchEvent(searchId, 'search.completed', { status, counts: { INSTAGRAM: igCount, META: metaCount }, target: TARGET }, jobId);
  } catch (e) {
    const job = db.prepare('SELECT attempts FROM jobs WHERE id=?').get(jobId);
    if (job && Number(job.attempts) < 2) {
      const retryAt = new Date(Date.now() + 2000 * Number(job.attempts || 1)).toISOString();
      db.prepare('UPDATE jobs SET status=?,completed_at=?,next_run_at=?,error_code=?,error_message=? WHERE id=?').run('PENDING', null, retryAt, 'SEARCH_RETRY', e.message, jobId);
      db.prepare('UPDATE searches SET status=? WHERE id=?').run('QUEUED', searchId);
      emitSearchEvent(searchId, 'search.retry_scheduled', { retryAt, error: e.message }, jobId);
    } else {
      db.prepare('UPDATE searches SET status=?,completed_at=? WHERE id=?').run('FAILED', nowIso(), searchId);
      db.prepare('UPDATE jobs SET status=?,completed_at=?,error_code=?,error_message=? WHERE id=?').run('FAILED', nowIso(), 'SEARCH_FAILED', e.message, jobId);
      emitSearchEvent(searchId, 'search.failed', { error: e.message }, jobId);
    }
  }
}

export function serializeSearch(searchId) {
  const s = db.prepare('SELECT * FROM searches WHERE id=?').get(searchId); if (!s) return null;
  const intent = latestIntent(searchId);
  const results = db.prepare(`SELECT r.*,v.canonical_url,v.thumbnail_url,v.caption,v.ad_copy,v.publisher_name,v.published_at,ev.visual_score,ev.confidence,ev.classification,ev.verification_stage,ev.frames_checked,ev.matched_evidence_json FROM search_results r JOIN videos v ON v.id=r.video_id LEFT JOIN video_evaluations ev ON ev.id=(SELECT id FROM video_evaluations WHERE video_id=r.video_id AND search_id=r.search_id ORDER BY created_at DESC LIMIT 1) WHERE r.search_id=? ORDER BY r.platform,r.rank`).all(searchId);
  const events = db.prepare('SELECT event_type,payload_json,sequence_no,created_at FROM events WHERE search_id=? ORDER BY sequence_no DESC LIMIT 50').all(searchId).reverse().map((e) => ({ type: e.event_type, payload: safeJson(e.payload_json, {}), sequence_no: e.sequence_no, created_at: e.created_at }));
  const conflicts = db.prepare('SELECT * FROM intent_conflicts WHERE product_intent_id=? ORDER BY created_at ASC').all(intent?.id || '');
  return { search: s, intent: intent ? parseIntent(intent) : null, conflicts, counts: sourceStats(searchId), results, events };
}
