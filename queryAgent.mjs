import { normalizeText } from '../pipeline/normalization.mjs';

function add(arr, q, type, level) {
  const text = String(q || '').trim();
  if (!text) return;
  const k = normalizeText(text);
  if (arr.some((x) => normalizeText(x.query) === k)) return;
  arr.push({ query: text, queryType: type, expansionLevel: level });
}

function hashtags(parts) { return parts.filter(Boolean).map((v) => `#${String(v).replace(/[^a-zA-Z0-9]/g, '')}`).filter((x) => x.length > 2); }

export function buildQueries(intent, platform) {
  const identity = [intent.brand, intent.product_family, intent.model, intent.variant].filter(Boolean).join(' ').trim();
  const attrs = Object.values(intent.explicit_constraints || {}).filter(Boolean).join(' ');
  const visualKeywords = intent.inferred_evidence?.visual_attributes?.visual_keywords || [];
  const visual = visualKeywords.filter(Boolean).slice(0, 4).join(' ');
  const base = [identity, attrs].filter(Boolean).join(' ').trim();
  const out = [];
  let level = 0;
  add(out, base, 'exact', level);
  if (intent.model) {
    add(out, `${intent.brand || ''} ${intent.model} ${attrs}`, 'model', ++level);
    add(out, `"${intent.model}" ${attrs}`, 'phrase', ++level);
    add(out, `${intent.model} ${attrs} review`, 'model-review', ++level);
    add(out, `${intent.model} ${attrs} unboxing`, 'model-unboxing', ++level);
  }
  if (intent.product_family) add(out, `${intent.brand || ''} ${intent.product_family} ${attrs}`, 'family', ++level);
  if (visual) add(out, `${base} ${visual}`.trim(), 'visual-attributes', ++level);
  for (const tag of hashtags([intent.model, intent.product_family, intent.brand, ...(Object.values(intent.explicit_constraints || {}))])) add(out, tag, 'hashtag', ++level);
  if (intent.target_granularity === 'FAMILY' || intent.target_granularity === 'BRAND') {
    add(out, `${intent.brand || ''} ${intent.product_family || intent.category || ''} demo`, 'family-demo', ++level);
    add(out, `${intent.brand || ''} ${intent.product_family || intent.category || ''} review`, 'family-review', ++level);
  }
  return out;
}
