import { CONFIG } from '../config.mjs';
import { withRetry } from '../utils/retry.mjs';
import { assertSchema } from '../utils/schema.mjs';
import { nowIso } from '../utils/time.mjs';
import { db } from '../db/database.mjs';
import { id } from '../utils/id.mjs';

function extractOutput(data) {
  return data?.output_text || data?.output?.text || data?.output?.[0]?.text || data?.output?.find?.((x) => x?.text)?.text || null;
}

export async function callGeminiStructured({ system, prompt, schema, images = [], searchId = null, agentName = 'unknown', operation = 'structured' }) {
  if (!CONFIG.geminiKey) throw new Error('GEMINI_API_KEY is not configured');
  const started = Date.now();
  const input = [{ type: 'text', text: `SYSTEM ROLE:\n${system}\n\nDATA/TASK:\n${prompt}` }];
  for (const image of images.slice(0, 5)) {
    if (image.data) input.push({ type: 'image', data: image.data, mime_type: image.mimeType || 'image/jpeg' });
    else if (image.uri) input.push({ type: 'image', uri: image.uri, mime_type: image.mimeType || 'image/jpeg' });
  }
  const body = {
    model: CONFIG.geminiModel,
    input,
    response_format: { type: 'text', mime_type: 'application/json', schema },
    generation_config: { thinking_level: 'low' },
  };
  try {
    const data = await withRetry(async () => {
      const r = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': CONFIG.geminiKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
      if (!r.ok) {
        const text = (await r.text()).slice(0, 800);
        const error = new Error(`Gemini ${r.status}: ${text}`);
        error.status = r.status;
        throw error;
      }
      return r.json();
    }, {
      retries: 2,
      baseDelayMs: 600,
      maxDelayMs: 4000,
      shouldRetry: (error) => [408, 429, 500, 502, 503, 504].includes(Number(error.status)),
    });
    const text = extractOutput(data);
    if (!text) throw new Error('Gemini response did not contain output text');
    let parsed;
    try { parsed = JSON.parse(text); } catch { throw new Error('Gemini returned non-JSON output'); }
    assertSchema(parsed, schema);
    try {
      db.prepare(`INSERT INTO ai_runs(id,search_id,agent_name,provider,model,operation,input_tokens,output_tokens,latency_ms,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
        .run(id('airun'), searchId, agentName, 'gemini', CONFIG.geminiModel, operation, data?.usage?.input_tokens || null, data?.usage?.output_tokens || null, Date.now() - started, 'SUCCESS', nowIso());
    } catch {}
    return parsed;
  } catch (error) {
    try {
      db.prepare(`INSERT INTO ai_runs(id,search_id,agent_name,provider,model,operation,latency_ms,status,error_code,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`)
        .run(id('airun'), searchId, agentName, 'gemini', CONFIG.geminiModel, operation, Date.now() - started, 'FAILED', error.status ? `HTTP_${error.status}` : 'AI_ERROR', nowIso());
    } catch {}
    throw error;
  }
}
