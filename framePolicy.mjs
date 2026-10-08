export function thumbnailDecision({score, confidence, evidenceQuality, visibility}) {
  if (score < 55) return {decision:'REJECT', reason:['Low thumbnail match score']};
  if (confidence >= 0.85 && evidenceQuality==='HIGH' && visibility==='HIGH' && score >= 88) return {decision:'ACCEPT', reason:['High-confidence thumbnail evidence']};
  return {decision:'ESCALATE', reason:['Thumbnail evidence is insufficient for exact-match decision']};
}
