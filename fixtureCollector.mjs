function svgThumb(label, platform, index) {
  const hue = (index * 47) % 360;
  const fill = `hsl(${hue} 38% 18%)`;
  const accent = `hsl(${(hue + 90) % 360} 70% 62%)`;
  const x = 180 + ((index * 17) % 180);
  const y = 245 + ((index * 13) % 120);
  const safe = encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="100%" height="100%" rx="32" fill="${fill}"/><circle cx="${x}" cy="${y}" r="145" fill="${accent}" fill-opacity="0.28"/><path d="M120 390 Q300 ${180 + (index % 80)} 480 390 L420 470 H180 Z" fill="#111827" stroke="#f8fafc" stroke-width="8"/><text x="50%" y="560" dominant-baseline="middle" text-anchor="middle" font-family="Arial" font-size="28" fill="white">${label}</text><text x="50%" y="605" dominant-baseline="middle" text-anchor="middle" font-family="Arial" font-size="20" fill="#cbd5e1">${platform} • ${String(index).padStart(2,'0')}</text></svg>`);
  return `data:image/svg+xml;charset=utf-8,${safe}`;
}
export function fixtureCandidates(platform, query, count=120) {
  const out=[];
  for (let i=0;i<count;i++) {
    const exact = i < Math.floor(count*0.70);
    const variant = !exact && i < Math.floor(count*0.85);
    const id = `${platform}-fixture-${query.replace(/[^a-z0-9]/gi,'').slice(0,20)}-${i+1}`;
    const base = exact ? query : variant ? `${query} variant` : `related ${query}`;
    out.push({
      platform,
      externalVideoId:id,
      canonicalUrl:`https://example.com/${platform.toLowerCase()}/${encodeURIComponent(id)}`,
      normalizedUrl:`https://example.com/${platform.toLowerCase()}/${encodeURIComponent(id)}`,
      thumbnailUrl:svgThumb(exact?'Exact product':'Related product',platform,i+1),
      caption: exact ? `${query} exact product demo ${i+1}` : variant ? `${query} different colour variant ${i+1}` : `related category content ${i+1}`,
      adCopy: platform==='META' ? (exact ? `Shop ${query}` : `Discover related products`) : null,
      publisherName: exact ? 'Product Creator' : 'Related Creator',
      publishedAt:new Date(Date.now() - i*86_400_000).toISOString(),
      metadata:{fixture:true, exact, variant, queryUsed:query},
      queryUsed:query,
    });
  }
  return out;
}
