import { tokenOverlap, tokenCoverage, normalizeText } from './normalization.mjs';

const COLORS = new Set(['black','white','red','blue','green','yellow','pink','brown','grey','gray','beige','purple','orange']);

function textForCandidate(candidate) {
  return normalizeText([candidate.caption, candidate.ad_copy, candidate.publisherName, candidate.queryUsed].filter(Boolean).join(' '));
}

export function hardConstraintGate(intent, candidate) {
  const constraints = intent.explicit_constraints || {};
  const text = textForCandidate(candidate);
  const violations = [];
  for (const [key, value] of Object.entries(constraints)) {
    if (value == null || value === '') continue;
    const v = normalizeText(String(value));
    if (key === 'color' && COLORS.has(v)) {
      for (const c of COLORS) if (c !== v && new RegExp(`\\b${c}\\b`).test(text)) { violations.push({ key, expected: v, observed: c }); break; }
    }
    if (key === 'edition' && /limited edition/.test(v) && /standard|regular|classic/.test(text)) violations.push({ key, expected: v, observed: 'standard' });
  }
  return { pass: violations.length === 0, violations };
}

export function candidateScore(intent, candidate) {
  const identity = [intent.brand, intent.product_family, intent.model, intent.variant].filter(Boolean).join(' ');
  const rawInput = intent.raw_extraction?.raw_input || intent.raw_input || '';
  const retrievalIdentity = identity || rawInput || intent.category || '';
  const meta = [candidate.caption, candidate.ad_copy, candidate.publisherName, candidate.queryUsed].filter(Boolean).join(' ');
  const query = candidate.queryUsed || '';
  const applicable = [];
  const identityScore = retrievalIdentity ? Math.max(tokenCoverage(retrievalIdentity, meta), tokenOverlap(retrievalIdentity, meta)) : 0;
  applicable.push(retrievalIdentity ? identityScore * 35 : 0);
  const brand = intent.brand ? (normalizeText(meta).includes(normalizeText(intent.brand)) ? 15 : 0) : 0; applicable.push(brand);
  const attrs = Object.values(intent.explicit_constraints || {}).filter(Boolean);
  const attrScore = attrs.length ? attrs.filter((v) => normalizeText(meta).includes(normalizeText(v))).length / attrs.length * 25 : 0;
  if (attrs.length) applicable.push(attrScore);
  const queryScore = query ? Math.max(tokenCoverage(retrievalIdentity, query), tokenOverlap(retrievalIdentity, query)) * 10 : 0; applicable.push(queryScore);
  const captionScore = meta ? Math.max(tokenCoverage(retrievalIdentity, meta), tokenOverlap(retrievalIdentity, meta)) * 10 : 0; applicable.push(captionScore);
  const contextScore = intent.category ? tokenOverlap(intent.category, meta) * 5 : 0; applicable.push(contextScore);
  const totalWeight = (retrievalIdentity ? 35 : 0) + (intent.brand ? 15 : 0) + (attrs.length ? 25 : 0) + (query ? 10 : 0) + (meta ? 10 : 0) + (intent.category ? 5 : 0);
  return totalWeight ? Math.round(Math.min(100, applicable.reduce((a, b) => a + b, 0) * (100 / totalWeight))) : 0;
}

export function finalScore(candidateScoreValue, visualScore, candidateWeight = 0.4, visualWeight = 0.6) {
  const c = Number(candidateWeight ?? 0.4); const v = Number(visualWeight ?? 0.6);
  const denom = c + v || 1;
  if (visualScore == null) return Math.round(candidateScoreValue);
  return Math.round((candidateScoreValue * c + visualScore * v) / denom);
}
