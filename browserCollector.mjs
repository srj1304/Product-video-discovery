import { CONFIG } from '../config.mjs';
import { withRetry } from '../utils/retry.mjs';

async function launch() {
  try { return await import('playwright'); } catch { throw new Error('Playwright is not installed. Install it for live browser-source mode.'); }
}

function extractInstagramUrls(text) {
  const set = new Set();
  for (const m of String(text).matchAll(/https?:\/\/(?:www\.)?instagram\.com\/reel\/[^\s"&<>]+/gi)) set.add(m[0].split('?')[0].replace(/\\u0026/g, '&'));
  return [...set];
}

async function openPage(browser, url) {
  const page = await browser.newPage({ locale: process.env.BROWSER_LOCALE || 'en-US' });
  await withRetry(() => page.goto(url, { waitUntil: 'domcontentloaded', timeout: 35_000 }), {
    retries: 2,
    baseDelayMs: 700,
    maxDelayMs: 5000,
    shouldRetry: (e) => /timeout|net::|ERR_/i.test(String(e?.message || '')),
  });
  return page;
}

async function extractPageMetadata(page) {
  return page.evaluate(() => {
    const meta = (name) => document.querySelector(`meta[property="${name}"],meta[name="${name}"]`)?.content || null;
    const video = document.querySelector('video');
    const title = meta('og:title') || document.title || null;
    const description = meta('og:description') || meta('description') || null;
    const image = meta('og:image') || null;
    const mediaUrl = video?.currentSrc || video?.src || null;
    return { title, description, image, mediaUrl };
  });
}

async function candidateFromPublicPage(browser, url, platform, query, position) {
  const page = await openPage(browser, url);
  try {
    const meta = await extractPageMetadata(page);
    let thumbnailUrl = meta.image;
    let thumbnailData = null;
    let mediaUrl = /^https?:/i.test(meta.mediaUrl || '') ? meta.mediaUrl : null;
    if (!thumbnailUrl) {
      const video = page.locator('video').first();
      if (await video.count()) {
        try { thumbnailData = `data:image/jpeg;base64,${(await video.screenshot({ type: 'jpeg', quality: 72 })).toString('base64')}`; } catch {}
      }
    }
    if (!thumbnailUrl && !thumbnailData) {
      try { thumbnailData = `data:image/jpeg;base64,${(await page.screenshot({ type: 'jpeg', quality: 68 })).toString('base64')}`; } catch {}
    }
    return {
      platform,
      externalVideoId: platform === 'INSTAGRAM' ? (url.split('/reel/')[1] || url) : (url.split('/').filter(Boolean).pop() || url),
      canonicalUrl: url,
      normalizedUrl: url,
      thumbnailUrl: thumbnailUrl || thumbnailData,
      mediaUrl,
      caption: meta.description,
      adCopy: platform === 'META' ? meta.description : null,
      publisherName: meta.title,
      publishedAt: null,
      metadata: { browser: true, discoveredQuery: query },
      queryUsed: query,
      rawPosition: position,
    };
  } finally {
    await page.close();
  }
}

export async function collectInstagram(query, target = 40) {
  const { chromium } = await launch();
  const browser = await chromium.launch({ headless: CONFIG.nodeEnv !== 'test' });
  try {
    const search = await openPage(browser, `https://www.google.com/search?q=${encodeURIComponent(`site:instagram.com/reel ${query}`)}`);
    const urls = extractInstagramUrls(await search.content()).slice(0, target);
    await search.close();
    const out = [];
    for (let i = 0; i < urls.length && out.length < target; i += 1) {
      try { out.push(await candidateFromPublicPage(browser, urls[i], 'INSTAGRAM', query, i)); } catch (error) {
        // A single blocked/bad public page should not fail the whole source.
      }
    }
    return out;
  } finally { await browser.close(); }
}

export async function collectMeta(query, target = 40) {
  const { chromium } = await launch();
  const browser = await chromium.launch({ headless: CONFIG.nodeEnv !== 'test' });
  try {
    const url = `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=ALL&q=${encodeURIComponent(query)}&media_type=video`;
    const page = await openPage(browser, url);
    const links = await page.$$eval('a', (els) => els.map((a) => ({ href: a.href, text: (a.innerText || a.textContent || '').trim() }))
      .filter((x) => x.href.includes('/ads/library/')));
    await page.close();
    const unique = []; const seen = new Set();
    for (const x of links) { if (seen.has(x.href)) continue; seen.add(x.href); unique.push(x.href); if (unique.length >= target) break; }
    const out = [];
    for (let i = 0; i < unique.length && out.length < target; i += 1) {
      try { out.push(await candidateFromPublicPage(browser, unique[i], 'META', query, i)); } catch {}
    }
    return out;
  } finally { await browser.close(); }
}

export async function findReferenceImage(query) {
  const { chromium } = await launch();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await openPage(browser, `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(query)}`);
    const urls = await page.$$eval('img', (els) => els.map((img) => img.src).filter((x) => /^https?:/i.test(x) && !/gstatic|googleusercontent/i.test(x)));
    await page.close();
    return urls[0] || null;
  } finally { await browser.close(); }
}
