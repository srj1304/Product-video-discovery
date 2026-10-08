import { createHash } from 'node:crypto';
import { normalizeText } from './normalization.mjs';
import { phashDistance } from './phash.mjs';

export const urlHash = (url) => createHash('sha256').update(String(url)).digest('hex');

export function dedupeCandidates(candidates, { phashThreshold = 6 } = {}) {
  const seen = new Set();
  const seenHashes = [];
  const out = [];
  for (const c of candidates) {
    const key = c.externalVideoId ? `${c.platform}:${c.externalVideoId}` : `${c.platform}:${urlHash(normalizeText(c.canonicalUrl))}`;
    if (seen.has(key)) continue;
    if (c.perceptualHash) {
      const near = seenHashes.some((x) => x.platform === c.platform && phashDistance(x.hash, c.perceptualHash) <= phashThreshold);
      if (near) continue;
    }
    seen.add(key);
    if (c.perceptualHash) seenHashes.push({ platform: c.platform, hash: c.perceptualHash });
    out.push({ ...c, dedupeKey: key });
  }
  return out;
}
