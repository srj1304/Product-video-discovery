import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

function run(cmd, args, input = null) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args);
    const out = [];
    let err = '';
    p.stdout.on('data', (d) => out.push(Buffer.from(d)));
    p.stderr.on('data', (d) => { err += d.toString(); });
    if (input) p.stdin.end(input); else p.stdin.end();
    p.on('close', (code) => code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(err || `exit ${code}`)));
    p.on('error', reject);
  });
}

function dct2d(values, n = 32) {
  const out = new Float64Array(n * n);
  const pi = Math.PI;
  const scale = Math.sqrt(2 / n);
  for (let u = 0; u < n; u += 1) {
    const au = u === 0 ? Math.sqrt(1 / n) : scale;
    for (let v = 0; v < n; v += 1) {
      const av = v === 0 ? Math.sqrt(1 / n) : scale;
      let sum = 0;
      for (let x = 0; x < n; x += 1) {
        const cx = Math.cos(((2 * x + 1) * u * pi) / (2 * n));
        for (let y = 0; y < n; y += 1) {
          sum += values[x * n + y] * cx * Math.cos(((2 * y + 1) * v * pi) / (2 * n));
        }
      }
      out[u * n + v] = au * av * sum;
    }
  }
  return out;
}

async function decodeGray32(buffer) {
  const candidates = ['/opt/imagemagick/bin/magick', '/usr/bin/magick', '/usr/bin/convert'];
  let last;
  for (const cmd of candidates) {
    try { return await run(cmd, ['-', '-resize', '32x32!', '-colorspace', 'Gray', '-depth', '8', 'gray:-'], buffer); } catch (e) { last = e; }
  }
  throw last || new Error('ImageMagick not available');
}

export async function perceptualHash(buffer) {
  if (!buffer?.length) return null;
  const gray = await decodeGray32(buffer);
  if (gray.length < 32 * 32) return null;
  const values = Float64Array.from(gray.subarray(0, 1024), (v) => Number(v));
  const coeff = dct2d(values, 32);
  const low = [];
  for (let u = 0; u < 8; u += 1) for (let v = 0; v < 8; v += 1) if (u !== 0 || v !== 0) low.push(coeff[u * 32 + v]);
  const sorted = [...low].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  let bits = '';
  for (const v of low) bits += v >= median ? '1' : '0';
  return BigInt(`0b${bits}`).toString(16).padStart(16, '0');
}

export function phashDistance(a, b) {
  if (!a || !b || a.length !== b.length) return 64;
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let count = 0;
  while (x) { count += Number(x & 1n); x >>= 1n; }
  return count;
}

export async function downloadBinary(url, { maxBytes = 8_000_000, timeoutMs = 15_000 } = {}) {
  const value = String(url || '');
  if (value.startsWith('data:')) {
    const m = value.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
    if (!m) throw new Error('Invalid data URI');
    const buf = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]));
    if (buf.length > maxBytes) throw new Error('Binary exceeds size limit');
    return { buffer: buf, contentType: m[1] || 'application/octet-stream' };
  }
  const r = await fetch(value, { headers: { 'User-Agent': 'ProductVideoDiscovery/0.1' }, signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(`Download ${r.status}`);
  const type = (r.headers.get('content-type') || '').split(';')[0].toLowerCase();
  if (!type.startsWith('image/')) throw new Error(`Expected image, got ${type || 'unknown'}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > maxBytes) throw new Error('Image exceeds size limit');
  return { buffer: buf, contentType: type };
}

export async function safePerceptualHash(url) {
  try {
    const { buffer } = await downloadBinary(url);
    return await perceptualHash(buffer);
  } catch {
    // Keep exact duplicate filtering functional on minimal Windows installs
    // where ImageMagick is unavailable. Real pHash remains the preferred path.
    try {
      const { buffer } = await downloadBinary(url);
      return createHash('sha256').update(buffer).digest('hex').slice(0, 16);
    } catch {
      return null;
    }
  }
}

export function imageKey(url) {
  return createHash('sha256').update(String(url || '')).digest('hex');
}
