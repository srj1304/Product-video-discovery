import http from 'node:http';
import { URL } from 'node:url';
import { db, initDb } from './db/database.mjs';
import { CONFIG } from './config.mjs';
import { hashPassword, verifyPassword } from './security/password.mjs';
import { createSession, getSession, revokeSession } from './security/session.mjs';
import { securityHeaders, rateLimit } from './security/http.mjs';
import { id } from './utils/id.mjs';
import { nowIso } from './utils/time.mjs';
import { executeSearch, serializeSearch } from './searchService.mjs';
import { ensureConfig, getActiveConfig } from './configStore.mjs';
import { bus, emitSearchEvent } from './events/eventBus.mjs';
import { safeJson } from './utils/json.mjs';
import { startJobWorker } from './jobs/worker.mjs';
import { validateConfigUpdate } from './configValidation.mjs';

initDb();
ensureConfig();
if(!db.prepare('SELECT 1 FROM users LIMIT 1').get()) db.prepare(`INSERT INTO users(id,email,password_hash,role,status,created_at) VALUES(?,?,?,?,?,?)`).run(id('usr'),CONFIG.adminEmail,hashPassword(CONFIG.adminPassword),'ADMIN','ACTIVE',nowIso());

const sseClients=new Map();
bus.on('newListener',()=>{});

function parseCookies(req){ const out={}; for(const p of String(req.headers.cookie||'').split(';')){const i=p.indexOf('='); if(i>0) out[p.slice(0,i).trim()]=decodeURIComponent(p.slice(i+1));} return out; }
function setCookie(res,name,value,maxAge){ const parts=[`${name}=${encodeURIComponent(value)}`,`Max-Age=${Math.floor(maxAge/1000)}`,'Path=/','HttpOnly',CONFIG.cookieSecure?'Secure':'','SameSite=Lax'].filter(Boolean); res.setHeader('Set-Cookie',parts.join('; ')); }
function clearCookie(res,name){ setCookie(res,name,'',0); }
function applyCors(req,res){ const origin=req.headers.origin; if(origin===CONFIG.appOrigin){ res.setHeader('Access-Control-Allow-Origin',origin); res.setHeader('Vary','Origin'); res.setHeader('Access-Control-Allow-Credentials','true'); } }
function send(res,status,payload,req=null){ securityHeaders(res); if(req) applyCors(req,res); res.statusCode=status; res.setHeader('Content-Type','application/json; charset=utf-8'); res.end(JSON.stringify(payload)); }
async function body(req){ const chunks=[]; let size=0; for await(const chunk of req){ size+=chunk.length; if(size>1_000_000) throw new Error('Request body too large'); chunks.push(chunk); } const raw=Buffer.concat(chunks).toString('utf8'); return raw?JSON.parse(raw):{}; }
function auth(req){ const token=parseCookies(req).sid; return getSession(token); }
function requireAuth(req,res){ const a=auth(req); if(!a){send(res,401,{error:'AUTH_REQUIRED'}); return null;} return a; }

function sse(res,searchId){
  res.statusCode=200; res.setHeader('Content-Type','text/event-stream'); res.setHeader('Cache-Control','no-cache'); res.setHeader('Connection','keep-alive'); res.setHeader('X-Accel-Buffering','no'); res.flushHeaders?.();
  const history=db.prepare('SELECT * FROM events WHERE search_id=? ORDER BY sequence_no ASC').all(searchId); for(const e of history) res.write(`id: ${e.id}\nevent: ${e.event_type}\ndata: ${e.payload_json}\n\n`);
  const handler=(evt)=>res.write(`id: ${evt.id}\nevent: ${evt.eventType}\ndata: ${JSON.stringify(evt.payload)}\n\n`);
  const channel=`search:${searchId}`; bus.on(channel,handler); res.write(`event: connected\ndata: {"searchId":"${searchId}"}\n\n`);
  reqClose.add(res); res.on('close',()=>{bus.off(channel,handler); reqClose.delete(res);});
}
const reqClose=new Set();

const server=http.createServer(async (req,res)=>{
  securityHeaders(res);
  applyCors(req,res);
  const u=new URL(req.url,`http://${req.headers.host}`); const path=u.pathname; const method=req.method;
  try {
    if(method==='OPTIONS'){ res.statusCode=204; res.setHeader('Access-Control-Allow-Origin',CONFIG.appOrigin); res.setHeader('Access-Control-Allow-Credentials','true'); res.setHeader('Access-Control-Allow-Headers','Content-Type'); res.setHeader('Access-Control-Allow-Methods','GET,POST,PUT,OPTIONS'); res.end(); return; }
    if(path==='/health'){ send(res,200,{ok:true,service:'product-video-discovery',time:nowIso(),sourceMode:CONFIG.sourceMode}); return; }
    if(path==='/api/auth/login'&&method==='POST'){
      const rl=rateLimit(`login:${req.socket.remoteAddress}`,8,60_000); if(!rl.ok){send(res,429,{error:'RATE_LIMITED'});return;}
      const b=await body(req); if(typeof b.email!=='string'||typeof b.password!=='string'){send(res,400,{error:'INVALID_INPUT'});return;}
      const user=db.prepare('SELECT * FROM users WHERE lower(email)=lower(?)').get(b.email); if(!user||!verifyPassword(b.password,user.password_hash)){send(res,401,{error:'INVALID_CREDENTIALS'});return;}
      db.prepare('UPDATE users SET last_login_at=? WHERE id=?').run(nowIso(),user.id); const sess=createSession(user.id,{ip:req.socket.remoteAddress,userAgent:req.headers['user-agent']}); setCookie(res,'sid',sess.raw,CONFIG.sessionTtlMs); send(res,200,{user:{id:user.id,email:user.email,role:user.role},expiresAt:sess.expiresAt}); return;
    }
    if(path==='/api/auth/logout'&&method==='POST'){ revokeSession(parseCookies(req).sid); clearCookie(res,'sid'); send(res,200,{ok:true}); return; }
    if(path==='/api/auth/me'&&method==='GET'){ const a=auth(req); send(res,200,{authenticated:Boolean(a),user:a?{id:a.user_id,email:a.email,role:a.role}:null}); return; }

    if(path==='/api/search'&&method==='POST'){
      const a=requireAuth(req,res); if(!a)return; const rl=rateLimit(`search:${a.user_id}`,10,60_000); if(!rl.ok){send(res,429,{error:'RATE_LIMITED'});return;}
      const b=await body(req); if(!['TEXT','URL'].includes(b.inputType)||typeof b.input!=='string'||b.input.length<2||b.input.length>2000){send(res,400,{error:'INVALID_SEARCH_INPUT'});return;}
      const config=db.prepare('SELECT id FROM config_versions WHERE is_active=1 ORDER BY version DESC LIMIT 1').get(); const sid=id('search'); db.prepare(`INSERT INTO searches(id,user_id,input_type,raw_input,show_previously_seen,status,created_at,config_version_id,prompt_version) VALUES(?,?,?,?,?,?,?,?,?)`).run(sid,a.user_id,b.inputType,b.input,b.showPreviouslySeen?1:0,'QUEUED',nowIso(),config?.id||null,'v2'); db.prepare(`INSERT INTO jobs(id,search_id,job_type,status,priority,attempts,created_at) VALUES(?,?,?,?,?,?,?)`).run(id('job'),sid,'SEARCH_PIPELINE','PENDING',100,0,nowIso()); send(res,202,{searchId:sid,status:'QUEUED'}); return;
    }

    const cl=path.match(/^\/api\/search\/([^/]+)\/clarify$/); if(cl&&method==='POST'){ const a=requireAuth(req,res); if(!a)return; const data=serializeSearch(cl[1]); if(!data||data.search.user_id!==a.user_id){send(res,404,{error:'NOT_FOUND'});return;} const b=await body(req); if(typeof b.input!=='string'||b.input.length<2||b.input.length>2000){send(res,400,{error:'INVALID_CLARIFICATION'});return;} const inputType=b.inputType||(/^https?:\/\//i.test(b.input)?'URL':'TEXT'); db.prepare('DELETE FROM search_results WHERE search_id=?').run(cl[1]); db.prepare("UPDATE search_queries SET status='CANCELLED',completed_at=? WHERE search_id=? AND status IN ('PENDING','RUNNING')").run(nowIso(),cl[1]); db.prepare("UPDATE intent_conflicts SET status='RESOLVED',resolution_source='USER_CLARIFICATION',resolution_value=?,resolved_at=? WHERE product_intent_id=(SELECT id FROM product_intents WHERE search_id=? ORDER BY version DESC LIMIT 1) AND status='UNRESOLVED'").run(b.input,nowIso(),cl[1]); db.prepare('UPDATE searches SET raw_input=?,input_type=?,show_previously_seen=?,status=?,started_at=NULL,completed_at=NULL WHERE id=?').run(b.input,inputType,b.showPreviouslySeen?1:0,'QUEUED',cl[1]); const newJob=id('job'); db.prepare("UPDATE jobs SET status='CANCELLED',completed_at=? WHERE search_id=? AND status IN ('PENDING','RUNNING','WAITING')").run(nowIso(),cl[1]); db.prepare("INSERT INTO jobs(id,search_id,job_type,status,priority,attempts,created_at) VALUES(?,?,?,?,?,?,?)").run(newJob,cl[1],'SEARCH_PIPELINE','PENDING',50,0,nowIso()); emitSearchEvent(cl[1],'search.clarification_submitted',{inputType,searchId:cl[1],jobId:newJob},newJob); send(res,202,{searchId:cl[1],status:'QUEUED',jobId:newJob}); return; }
    const sm=path.match(/^\/api\/search\/([^/]+)$/); if(sm&&method==='GET'){ const a=requireAuth(req,res); if(!a)return; const data=serializeSearch(sm[1]); if(!data||data.search.user_id!==a.user_id){send(res,404,{error:'NOT_FOUND'});return;} send(res,200,data); return; }
    const se=path.match(/^\/api\/search\/([^/]+)\/events$/); if(se&&method==='GET'){ const a=requireAuth(req,res); if(!a)return; const data=serializeSearch(se[1]); if(!data||data.search.user_id!==a.user_id){send(res,404,{error:'NOT_FOUND'});return;} sse(res,se[1]); return; }
    if(path==='/api/history'&&method==='GET'){ const a=requireAuth(req,res); if(!a)return; const rows=db.prepare(`SELECT id,input_type,raw_input,status,created_at,completed_at FROM searches WHERE user_id=? ORDER BY created_at DESC LIMIT 50`).all(a.user_id); send(res,200,{items:rows}); return; }
    if(path==='/api/admin/config'&&method==='GET'){ const a=requireAuth(req,res); if(!a||a.role!=='ADMIN'){if(a)send(res,403,{error:'FORBIDDEN'});return;} const rows=db.prepare('SELECT * FROM config_versions ORDER BY version DESC LIMIT 10').all(); send(res,200,{items:rows.map(r=>({...r,config:safeJson(r.config_json,{})}))}); return; }
    if(path==='/api/admin/config'&&method==='PUT'){ const a=requireAuth(req,res); if(!a||a.role!=='ADMIN'){if(a)send(res,403,{error:'FORBIDDEN'});return;} const rl=rateLimit(`admin:${a.user_id}`,20,60_000); if(!rl.ok){send(res,429,{error:'RATE_LIMITED'});return;} const b=await body(req); let next; try { next=validateConfigUpdate(b.config); } catch(e){send(res,400,{error:'INVALID_CONFIG',message:e.message});return;} const current=getActiveConfig(); const merged={...current,...next,matching:{...current.matching,...(next.matching||{})},retrieval:{...current.retrieval,...(next.retrieval||{})},ai:{...current.ai,...(next.ai||{})},runtime:{...current.runtime,...(next.runtime||{})}}; const ver=(db.prepare('SELECT COALESCE(MAX(version),0) v FROM config_versions').get().v)+1; db.prepare('UPDATE config_versions SET is_active=0 WHERE is_active=1').run(); db.prepare(`INSERT INTO config_versions(id,version,config_json,created_by,reason,is_active,created_at) VALUES(?,?,?,?,?,?,?)`).run(id('cfg'),ver,JSON.stringify(merged),a.user_id,b.reason||'Admin update',1,nowIso()); send(res,200,{ok:true,version:ver}); return; }

    send(res,404,{error:'NOT_FOUND'});
  } catch(e){ send(res,500,{error:'INTERNAL_ERROR',message:CONFIG.nodeEnv==='development'?e.message:'Unexpected error'}); }
});

startJobWorker();
server.listen(CONFIG.port,CONFIG.host,()=>console.log(`Product Video Discovery backend listening on http://${CONFIG.host}:${CONFIG.port}`));
process.on('SIGINT',()=>server.close(()=>process.exit(0)));
