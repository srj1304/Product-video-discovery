const bounded = (value, min, max, name) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${name} must be between ${min} and ${max}`);
  return n;
};

export function validateConfigUpdate(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Config must be an object');
  const out = structuredClone(input);
  const m = out.matching || (out.matching = {});
  if (m.candidate_threshold !== undefined) m.candidate_threshold = bounded(m.candidate_threshold, 0, 100, 'candidate_threshold');
  if (m.high_visual_threshold !== undefined) m.high_visual_threshold = bounded(m.high_visual_threshold, 0, 100, 'high_visual_threshold');
  if (m.possible_visual_threshold !== undefined) m.possible_visual_threshold = bounded(m.possible_visual_threshold, 0, 100, 'possible_visual_threshold');
  if (m.high_confidence !== undefined) m.high_confidence = bounded(m.high_confidence, 0, 1, 'high_confidence');
  if (m.final_candidate_weight !== undefined) m.final_candidate_weight = bounded(m.final_candidate_weight, 0, 1, 'final_candidate_weight');
  if (m.final_visual_weight !== undefined) m.final_visual_weight = bounded(m.final_visual_weight, 0, 1, 'final_visual_weight');
  if (m.final_candidate_weight !== undefined || m.final_visual_weight !== undefined) {
    const cw = Number(m.final_candidate_weight ?? 0.4); const vw = Number(m.final_visual_weight ?? 0.6);
    if (Math.abs((cw + vw) - 1) > 1e-6) throw new Error('final_candidate_weight + final_visual_weight must equal 1');
  }
  const r = out.retrieval || (out.retrieval = {});
  if (r.max_queries_per_source !== undefined) r.max_queries_per_source = Math.round(bounded(r.max_queries_per_source, 1, 30, 'max_queries_per_source'));
  if (r.max_candidates_per_query !== undefined) r.max_candidates_per_query = Math.round(bounded(r.max_candidates_per_query, 5, 500, 'max_candidates_per_query'));
  if (r.max_total_candidates_per_source !== undefined) r.max_total_candidates_per_source = Math.round(bounded(r.max_total_candidates_per_source, 20, 1000, 'max_total_candidates_per_source'));
  const ai = out.ai || (out.ai = {});
  if (ai.max_verification_calls !== undefined) ai.max_verification_calls = Math.round(bounded(ai.max_verification_calls, 1, 200, 'max_verification_calls'));
  if (ai.max_frame_passes !== undefined) ai.max_frame_passes = Math.round(bounded(ai.max_frame_passes, 0, 5, 'max_frame_passes'));
  if (ai.frames_per_pass !== undefined) ai.frames_per_pass = Math.round(bounded(ai.frames_per_pass, 1, 10, 'frames_per_pass'));
  if (out.runtime?.source_mode && !['fixture', 'browser'].includes(out.runtime.source_mode)) throw new Error('runtime.source_mode must be fixture or browser');
  return out;
}
