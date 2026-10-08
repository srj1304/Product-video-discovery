import { CONFIG } from '../config.mjs';
import { fixtureCandidates } from './fixtureCollector.mjs';
import { collectInstagram, collectMeta } from './browserCollector.mjs';

export async function collectSource(platform, query, target = 60, mode = CONFIG.sourceMode) {
  if (mode === 'fixture') return { candidates: fixtureCandidates(platform, query, target), mode: 'fixture' };
  if (mode === 'browser') {
    if (platform === 'INSTAGRAM') return { candidates: await collectInstagram(query, target), mode: 'browser' };
    if (platform === 'META') return { candidates: await collectMeta(query, target), mode: 'browser' };
  }
  throw new Error(`Unsupported source mode: ${mode}`);
}
