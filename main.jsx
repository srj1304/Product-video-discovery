import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const API = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8787';
async function api(path, options = {}) {
  const r = await fetch(API + path, { credentials: 'include', headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || data.message || `HTTP ${r.status}`);
  return data;
}

function App() {
  const [me, setMe] = useState(null); const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [loginErr, setLoginErr] = useState('');
  const [input, setInput] = useState('Nike Air Max 270 Black'); const [inputType, setInputType] = useState('TEXT'); const [searchId, setSearchId] = useState(null); const [data, setData] = useState(null); const [events, setEvents] = useState([]); const [busy, setBusy] = useState(false); const [history, setHistory] = useState([]); const [tab, setTab] = useState('INSTAGRAM'); const [showPreviouslySeen, setShowPreviouslySeen] = useState(false); const [resultSort, setResultSort] = useState('score'); const [minimumScore, setMinimumScore] = useState(0);
  const [config, setConfig] = useState(null); const [configText, setConfigText] = useState(''); const [configMsg, setConfigMsg] = useState('');
  const check = async () => { try { const m = await api('/api/auth/me'); setMe(m.user); if (m.user) loadHistory(); } catch {} };
  useEffect(() => { check(); }, []);
  const loadHistory = async () => { try { const h = await api('/api/history'); setHistory(h.items || []); } catch {} };
  const subscribe = (idValue) => {
    const es = new EventSource(`${API}/api/search/${idValue}/events`, { withCredentials: true });
    const push = (type, event) => { try { setEvents((x) => [...x, { type, ...(JSON.parse(event.data || '{}')) }]); } catch {} };
    ['product.resolved','product.conflict_detected','source.candidates.found','source.collection.completed','source.shortfall','thumbnail.verification.started','frame.verification.completed','dedup.completed','search.retry_scheduled'].forEach((type) => es.addEventListener(type, (e) => push(type, e)));
    es.addEventListener('search.completed', async (e) => { push('search.completed', e); es.close(); setData(await api(`/api/search/${idValue}`)); setBusy(false); loadHistory(); });
    es.addEventListener('search.failed', (e) => { push('search.failed', e); es.close(); setBusy(false); });
    es.onerror = () => { /* browser may retry SSE automatically; final state is persisted in GET /search */ };
    return es;
  };
  const startSearch = async () => {
    setBusy(true); setData(null); setEvents([]);
    try { const r = await api('/api/search', { method: 'POST', body: JSON.stringify({ inputType, input, showPreviouslySeen }) }); setSearchId(r.searchId); subscribe(r.searchId); }
    catch (e) { alert(e.message); setBusy(false); }
  };
  const clarify = async () => { const answer = window.prompt('Update the product description or URL to resolve the conflict.'); if (!answer) return; setBusy(true); setEvents([]); try { await api(`/api/search/${searchId}/clarify`, { method: 'POST', body: JSON.stringify({ input: answer, inputType: /^https?:\/\//i.test(answer) ? 'URL' : 'TEXT', showPreviouslySeen }) }); subscribe(searchId); } catch (e) { alert(e.message); setBusy(false); } };
  const openHistory = async (idValue) => { const d = await api(`/api/search/${idValue}`); setSearchId(idValue); setData(d); setEvents(d.events || []); };
  const login = async (e) => { e.preventDefault(); setLoginErr(''); try { const m = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }); setMe(m.user); loadHistory(); } catch (e2) { setLoginErr(e2.message); } };
  const loadConfig = async () => { const c = await api('/api/admin/config'); const x = c.items?.[0]; setConfig(x); setConfigText(JSON.stringify(x?.config || {}, null, 2)); };
  useEffect(() => { if (me?.role === 'ADMIN') loadConfig(); }, [me]);
  const saveConfig = async () => { try { const c = JSON.parse(configText); const r = await api('/api/admin/config', { method: 'PUT', body: JSON.stringify({ config: c, reason: 'MVP tuning' }) }); setConfigMsg(`Saved config v${r.version}`); loadConfig(); } catch (e) { setConfigMsg(e.message); } };

  if (!me) return <div className="auth-wrap"><form className="auth-card" onSubmit={login}><div className="eyebrow">AI AUTOMATION · MVP</div><h1>Find the product.<br /><span>Not just the category.</span></h1><p className="muted">Product Video Discovery Dashboard</p><input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" autoComplete="username" /><input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="Password" autoComplete="current-password" /><button>Sign in</button>{loginErr && <div className="error">{loginErr}</div>}<small>Use the ADMIN_EMAIL / ADMIN_PASSWORD from your .env</small></form></div>;

  const results = (data?.results || [])
    .filter((x) => x.platform === tab && Number(x.final_score || 0) >= minimumScore)
    .sort((a, b) => resultSort === 'newest'
      ? (new Date(b.published_at || 0).getTime() - new Date(a.published_at || 0).getTime()) || (b.final_score - a.final_score)
      : resultSort === 'score_asc' ? (a.final_score - b.final_score) : (b.final_score - a.final_score));
  const intentImage = data?.intent?.inferred_evidence?.reference_image_url;
  const conflict = data?.search?.status === 'WAITING_FOR_CLARIFICATION' || (data?.conflicts || []).some((x) => x.status === 'UNRESOLVED');
  return <div className="app">
    <header><div><div className="eyebrow">PRODUCT VIDEO DISCOVERY</div><h1>Find content that actually features <span>your product.</span></h1></div><div className="head-actions"><span className="user-pill">{me.email}</span><button className="ghost" onClick={async () => { await api('/api/auth/logout', { method: 'POST' }); location.reload(); }}>Sign out</button></div></header>
    <main>
      <section className="hero-card"><div className="search-mode"><button className={inputType === 'TEXT' ? 'selected' : ''} onClick={() => setInputType('TEXT')}>Description</button><button className={inputType === 'URL' ? 'selected' : ''} onClick={() => setInputType('URL')}>Product URL</button></div><div className="search-row"><input value={input} onChange={(e) => setInput(e.target.value)} placeholder={inputType === 'URL' ? 'Paste product URL' : 'Describe the product, e.g. Nike Air Max 270 Black'} /><button onClick={startSearch} disabled={busy}>{busy ? 'Discovering…' : 'Discover videos'}</button></div><div className="hint-row"><div className="hint">Explicit attributes become hard constraints. Unspecified attributes stay unknown.</div><label className="toggle"><input type="checkbox" checked={showPreviouslySeen} onChange={(e) => setShowPreviouslySeen(e.target.checked)} /> Show previously seen</label></div></section>
      {conflict && <section className="conflict-card"><div><div className="eyebrow">CLARIFICATION REQUIRED</div><h2>We found conflicting product information.</h2><p className="muted">The user-provided request and the resolved listing disagree on a product attribute. The search is paused rather than silently choosing one.</p>{(data?.conflicts || []).filter((x) => x.status === 'UNRESOLVED').map((c) => <div className="conflict-row" key={c.id}><b>{c.attribute_key}</b><span>{c.source_a}: {c.value_a}</span><span>vs</span><span>{c.source_b}: {c.value_b}</span></div>)}</div><button onClick={clarify}>Clarify & restart search</button></section>}
      {(busy || events.length > 0) && <section className="progress-card"><div className="progress-top"><strong>{busy ? 'Pipeline running' : 'Pipeline complete'}</strong><span>{searchId || ''}</span></div><div className="steps">{['Product resolved','Instagram collected','Meta collected','Thumbnail verified','Dedup + ranking'].map((s, i) => <div className="step" key={s}><div className="dot">{i < Math.min(5, events.length) ? '✓' : '•'}</div>{s}</div>)}</div>{events.slice(-8).map((e, i) => <div className="event" key={`${e.type}-${i}`}><span>{e.type}</span><span>{JSON.stringify(e).slice(0, 220)}</span></div>)}</section>}
      {data?.intent && <section className="intent-card"><div className="intent-image">{intentImage ? <img src={intentImage} alt="Resolved product reference" /> : <div className="fake-product">{data.intent.brand || 'Product'}<br />{data.intent.model || data.intent.product_family || ''}</div>}</div><div><div className="eyebrow">PRODUCT INTENT · {data.intent.target_granularity}</div><h2>{[data.intent.brand, data.intent.product_family, data.intent.model, data.intent.variant].filter(Boolean).join(' ') || data.search.raw_input}</h2><div className="chips">{Object.entries(data.intent.explicit_constraints || {}).map(([k, v]) => <span className="chip" key={k}>{k}: {v}</span>)}</div><p className="muted">Ambiguity: {data.intent.ambiguity_level} · Identity confidence: {Math.round((data.intent.identity_confidence || 0) * 100)}%</p></div></section>}
      <section className="result-section"><div className="tabs"><button className={tab === 'INSTAGRAM' ? 'active' : ''} onClick={() => setTab('INSTAGRAM')}>Instagram <b>{data?.counts?.INSTAGRAM || 0}/20</b></button><button className={tab === 'META' ? 'active' : ''} onClick={() => setTab('META')}>Meta Ad Library <b>{data?.counts?.META || 0}/20</b></button><div className="result-controls"><label>Sort <select value={resultSort} onChange={(e) => setResultSort(e.target.value)}><option value="score">Match score</option><option value="newest">Newest first</option><option value="score_asc">Lowest score</option></select></label><label>Min score <select value={minimumScore} onChange={(e) => setMinimumScore(Number(e.target.value))}><option value="0">Any</option><option value="60">60+</option><option value="75">75+</option><option value="90">90+</option></select></label></div></div><div className="grid">{results.map((r) => { const evidence = r.matched_evidence_json ? JSON.parse(r.matched_evidence_json) : []; return <article className="video-card" key={r.id}><div className="thumb"><img src={r.thumbnail_url || ''} alt="" /><div className="score">{Math.round(r.final_score)}<small>/100</small></div></div><div className="card-body"><div className="meta"><span>{r.platform}</span><span>#{r.rank}</span></div><h3>{r.caption || r.ad_copy || 'Product video'}</h3><p>{evidence.slice(0, 2).join(' · ') || 'Visual and metadata evidence support the requested product.'}</p><small className="verify">{r.verification_stage === 'FRAME' ? `Verified using ${r.frames_checked} frame${r.frames_checked === 1 ? '' : 's'}` : 'Verified from thumbnail'} · {Math.round((r.confidence || 0) * 100)}% confidence</small><a href={r.canonical_url} target="_blank" rel="noreferrer">Open source ↗</a></div></article>; })}</div>{data?.search?.status === 'COMPLETED_WITH_SHORTFALL' && <div className="shortfall">The system could not find enough high-confidence unseen matches without lowering the configured threshold. No filler results were fabricated.</div>}{data && results.length === 0 && <div className="empty">No accepted results for this source yet. The system reports a shortfall rather than manufacturing matches.</div>}</section>
      <section className="history-card"><div className="section-head"><h2>Search history</h2><span>{history.length} saved searches</span></div>{history.map((h) => <button className="history-row" key={h.id} onClick={() => openHistory(h.id)}><span>{h.raw_input}</span><span>{h.input_type} · {h.status}</span></button>)}</section>
      {me.role === 'ADMIN' && <section className="admin-card"><div className="section-head"><h2>Runtime configuration</h2><span>Admin only · {config ? `v${config.version}` : ''}</span></div><textarea value={configText} onChange={(e) => setConfigText(e.target.value)} rows="16" /><div className="admin-actions"><button onClick={saveConfig}>Save new config version</button><span>{configMsg}</span></div></section>}
    </main><footer><span>Zero-budget MVP · SQLite · Event-driven Node.js backend</span><span>Source mode: {config?.config?.runtime?.source_mode || 'fixture'}</span></footer>
  </div>;
}
createRoot(document.getElementById('root')).render(<App />);
