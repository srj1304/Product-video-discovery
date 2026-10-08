const STOP = new Set(['the','a','an','and','or','for','with','of','in','on','new','best','official','shop','buy']);
export function normalizeText(value='') {
  return value.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
}
export function tokens(value='') {
  return [...new Set(normalizeText(value).split(/\s+/).filter(t => t && !STOP.has(t)))];
}
export function tokenOverlap(a,b) {
  const A = new Set(tokens(a)); const B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  let hit = 0; for (const t of A) if (B.has(t)) hit++;
  return hit / Math.max(A.size, B.size);
}

// Directional coverage: what fraction of the requested terms are present in the evidence?
export function tokenCoverage(requested, evidence) {
  const A = new Set(tokens(requested)); const B = new Set(tokens(evidence));
  if (!A.size || !B.size) return 0;
  let hit = 0; for (const t of A) if (B.has(t)) hit++;
  return hit / A.size;
}
export function canonicalUrl(url) {
  const u = new URL(url); u.hash=''; u.username=''; u.password='';
  for (const k of [...u.searchParams.keys()]) if (/utm_|fbclid|gclid|ref/i.test(k)) u.searchParams.delete(k);
  return u.toString();
}
