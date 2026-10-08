import fs from 'node:fs';
import { fixtureCandidates } from '../backend/src/collectors/fixtureCollector.mjs';
import { candidateScore, hardConstraintGate, finalScore } from '../backend/src/pipeline/scoring.mjs';

const products = JSON.parse(fs.readFileSync(new URL('../tests/evaluation-fixtures.json', import.meta.url), 'utf8'));
const report = [];
for (const product of products) {
  const intent = { ...product, raw_input: product.name, raw_extraction: { raw_input: product.name } };
  const candidates = fixtureCandidates('INSTAGRAM', product.name, 60);
  const passed = candidates.filter((c) => hardConstraintGate(intent, c).pass);
  const scored = passed.map((c) => ({ score: candidateScore(intent, c), exact: c.metadata?.exact, variant: c.metadata?.variant }));
  const accepted = scored.filter((x) => x.exact && x.score >= 55);
  const bad = scored.filter((x) => !x.exact).slice(0, 3);
  report.push({
    product: product.name,
    candidates: candidates.length,
    hard_gate_passed: passed.length,
    expected_exact_candidates: accepted.length,
    sample_bad_matches: bad.length,
    top_retrieval_score: Math.max(...scored.map((x) => x.score), 0),
    note: 'Deterministic fixture-mode evidence; live-source accuracy must be evaluated separately.'
  });
}
console.log(JSON.stringify(report, null, 2));
