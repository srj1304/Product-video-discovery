import dns from 'node:dns/promises';
import net from 'node:net';
import { createHash } from 'node:crypto';

function privateIPv4(ip){ const [a,b]=ip.split('.').map(Number); return a===10 || a===127 || (a===172&&b>=16&&b<=31) || (a===192&&b===168) || a===0 || a>=224; }
function privateIPv6(ip){ const x=ip.toLowerCase(); return x==='::1' || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe8') || x.startsWith('fe9') || x.startsWith('fea') || x.startsWith('feb'); }
async function assertPublicHost(hostname){
  if(['localhost','localhost.localdomain'].includes(hostname.toLowerCase())) throw new Error('Unsafe URL host');
  const addresses=await dns.lookup(hostname,{all:true});
  if(!addresses.length) throw new Error('Could not resolve host');
  for (const {address} of addresses) { if((net.isIP(address)===4&&privateIPv4(address))||(net.isIP(address)===6&&privateIPv6(address))) throw new Error('Unsafe URL resolves to private/internal address'); }
}
function extractMeta(html){
  const get=(name)=>{ const re=new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']*)["'][^>]*>`,`i`); return html.match(re)?.[1]||null; };
  const title=(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
  const ogTitle=get('og:title')||title; const desc=get('og:description')||get('description'); const image=get('og:image');
  let sku=null; let structured=[];
  for(const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){ try { const obj=JSON.parse(m[1]); structured.push(obj); if(obj?.sku) sku=obj.sku; } catch {} }
  return {title:ogTitle,description:desc,mainImageUrl:image,sku,structured};
}
export async function resolveProductUrl(input, searchId, saveFetch){
  let current=new URL(input); if(!['http:','https:'].includes(current.protocol)) throw new Error('Only http/https URLs are allowed');
  const start=Date.now(); let redirects=0;
  for(let hop=0;hop<4;hop++){
    await assertPublicHost(current.hostname);
    const r=await fetch(current,{redirect:'manual',headers:{'User-Agent':'ProductVideoDiscovery/0.1 (+assignment prototype)'},signal:AbortSignal.timeout(20_000)});
    const loc=r.headers.get('location');
    if(r.status>=300&&r.status<400&&loc){ redirects++; current=new URL(loc,current); continue; }
    if(!r.ok) throw new Error(`Product page returned HTTP ${r.status}`);
    const contentType=r.headers.get('content-type')||''; if(!/text\/html|application\/xhtml\+xml/i.test(contentType)) throw new Error('Product URL did not return HTML');
    const text=await r.text(); if(text.length>2_000_000) throw new Error('Product page exceeds size limit');
    const meta=extractMeta(text); const contentHash=createHash('sha256').update(text).digest('hex');
    saveFetch({searchId,url:input,normalizedUrl:current.toString(),status:'SUCCESS',httpStatus:r.status,redirectCount:redirects,contentType,contentHash,durationMs:Date.now()-start});
    return {url:input,normalizedUrl:current.toString(),domain:current.hostname,title:meta.title,description:meta.description,mainImageUrl:meta.mainImageUrl,sku:meta.sku,structuredData:meta.structured,contentHash};
  }
  throw new Error('Too many redirects');
}
