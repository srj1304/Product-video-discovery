import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args);
    let stdout = ''; let stderr = '';
    p.stdout.on('data', d => { stdout += d.toString(); });
    p.stderr.on('data', d => { stderr += d.toString(); });
    p.on('error', reject);
    p.on('close', c => c ? reject(new Error(stderr || `exit ${c}`)) : resolve(stdout));
  });
}

async function probeDuration(videoUrl) {
  const out = await run('ffprobe', ['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1', videoUrl]);
  const value = Number.parseFloat(String(out).trim());
  if (!Number.isFinite(value) || value <= 0) throw new Error('Unable to determine video duration');
  return value;
}

export async function sampleVideoFrames(videoUrl, count = 3) {
  if (!videoUrl || !/^https?:/i.test(videoUrl)) return [];
  const duration = await probeDuration(videoUrl);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pvd-'));
  const out = [];
  try {
    for (let i = 0; i < count; i += 1) {
      const file = path.join(dir, `${i}.jpg`);
      const seek = Math.max(0.05, Math.min(duration - 0.05, duration * ((i + 1) / (count + 1))));
      await run('ffmpeg', ['-hide_banner','-loglevel','error','-ss',String(seek),'-i',videoUrl,'-frames:v','1','-q:v','4','-y',file]);
      const buf = await fs.readFile(file);
      out.push({ data: buf, mimeType: 'image/jpeg' });
    }
    return out;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
