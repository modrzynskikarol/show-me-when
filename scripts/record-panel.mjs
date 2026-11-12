// Step 2: records the panel flow (D1). Records the plan's flows on a board URL with a real browser and writes a timeline of what happened.
// Usage: node scripts/record.mjs <url> <outDir> [--locale pl-PL --tz Europe/Warsaw]
// Output: <outDir>/raw/*.webm (Playwright video) and <outDir>/timeline.json (mm:ss of each moment, ack receipts).
// A small recorder bar (bottom right, not part of the board) shows UTC time and the current step.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [url, outDir] = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const locale = arg('--locale', 'pl-PL');
const timezoneId = arg('--tz', 'Europe/Warsaw');
mkdirSync(join(outDir, 'raw'), { recursive: true });

const size = { width: 1280, height: 720 };
const browser = await chromium.launch();
const context = await browser.newContext({
  locale,
  timezoneId,
  viewport: size,
  recordVideo: { dir: join(outDir, 'raw'), size },
});
await context.addInitScript(() => {
  window.__step = 'start';
  const mount = () => {
    const bar = document.createElement('div');
    bar.id = '__recorder';
    bar.style.cssText =
      'position:fixed;right:8px;bottom:8px;z-index:99999;pointer-events:none;font:12px ui-monospace,monospace;' +
      'background:rgba(0,0,0,.75);color:#fff;padding:4px 8px;border-radius:4px';
    document.documentElement.append(bar);
    const tick = () => {
      bar.textContent = `recorder · ${new Date().toISOString().slice(11, 19)} UTC · ${window.__step}`;
      requestAnimationFrame(tick);
    };
    tick();
  };
  if (document.documentElement) mount();
  else document.addEventListener('DOMContentLoaded', mount);
});

const page = await context.newPage();
const t0 = Date.now(); // the video starts with the page
const mmss = (ms) => {
  const s = Math.max(0, Math.floor((ms - t0) / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};
const timeline = { url, locale, timezoneId, startedAt: new Date(t0).toISOString(), events: [] };
const mark = (flow, what, extra = {}) => {
  const now = Date.now();
  const e = { at: mmss(now), atMs: now - t0, utc: new Date(now).toISOString(), flow, what, ...extra };
  timeline.events.push(e);
  console.log(e.at, flow, what, extra.receipt ? '(receipt)' : '');
  return e;
};
const step = (s) => page.evaluate((s) => (window.__step = s), s).catch(() => {});

const acks = [];
page.on('console', (m) => {
  const t = m.text();
  if (t.startsWith('ack ')) {
    const [, id, ackedAt, receipt] = t.split(' ');
    acks.push({ id, ackedAt, receipt, seenAt: Date.now() });
  }
});

// open-board
await page.waitForTimeout(800);
await page.goto(url);
await step('open-board');
mark('open-board', 'page opened', { loaderVisible: await page.locator('[data-testid="loader"]').isVisible() });
await page.waitForSelector('[data-testid="incident-row"]');
const sha = await page.getAttribute('meta[name="build"]', 'content');
const firstIds = await page.$$eval('[data-testid="incident-row"]', (rs) => rs.map((r) => r.dataset.id));
mark('open-board', 'incidents on screen, loader gone', {
  rows: firstIds.length,
  top: firstIds[0],
  loaderCount: await page.locator('[data-testid="loader"]').count(),
  sha,
});
await page.locator('[data-testid="build-sha"]').hover();
await page.waitForTimeout(2500);

// ack-incident on the panel build (D1), the way a person does it: look at a row, move onto it, click on that
// spot while the board keeps refreshing. If a new incident lands mid-click, the click opens the row now under
// the pointer; the panel names that incident, so the person sees it is not the one meant, picks the meant row
// again, reads the panel, and acks from the panel.
await step("ack-incident: aim at row 1");
const aimed = page.locator('[data-testid="incident-row"]').first();
const meant = await aimed.getAttribute('data-id');
const box = await aimed.locator('.what').boundingBox();
const x = box.x + 40, y = box.y + box.height / 2;
await page.mouse.move(x, y, { steps: 15 });
mark('ack-incident', `pointer on row ${meant}, the row I mean`, { meant });
await page.waitForFunction((id) => document.querySelector('[data-testid="incident-row"]')?.dataset.id !== id, meant, { timeout: 90_000, polling: 50 });
const landed = await page.getAttribute('[data-testid="incident-row"]:first-child', 'data-id');
mark('ack-incident', `new incident ${landed} lands at the top; rows move down`, { landed });
await page.waitForTimeout(120); // reaction time: the hand does not stop
await page.mouse.down(); await page.mouse.up();
const panel = page.locator('[data-testid="incident-panel"]');
await panel.waitFor({ state: 'visible' });
const firstPanel = await panel.getAttribute('data-id');
mark('ack-incident', `click opens the panel of ${firstPanel}; nothing acked`, { meant, panel: firstPanel, acks: acks.length });
await step(`panel names ${firstPanel}, not ${meant}: pick again`);
await page.waitForTimeout(2200); // a person reads the panel
const again = page.locator(`[data-testid="incident-row"][data-id="${meant}"]`);
const box2 = await again.locator('.what').boundingBox();
await page.mouse.move(box2.x + 40, box2.y + box2.height / 2, { steps: 12 });
await page.mouse.down(); await page.mouse.up();
await page.waitForFunction((id) => document.querySelector('[data-testid="incident-panel"]')?.dataset.id === id, meant);
mark('ack-incident', `panel names ${meant}`, { panel: meant });
await step(`panel names ${meant}: ack it`);
await page.waitForTimeout(1500);
const pa = await page.locator('[data-testid="panel-ack"]').boundingBox();
await page.mouse.move(pa.x + pa.width / 2, pa.y + pa.height / 2, { steps: 12 });
await page.waitForTimeout(400);
const clickAt = mark('ack-incident', `click "Ack ${meant}" in the panel`);
await page.mouse.down(); await page.mouse.up();
await page.waitForSelector(`[data-testid="incident-row"][data-id="${meant}"] [data-testid="acked"]`);
const reply = acks.at(-1);
mark('ack-incident', `${reply?.id} marked acked; I meant ${meant}`, { expected: meant, got: reply?.id, receipt: reply?.receipt, ackedAt: reply?.ackedAt, clickAt: clickAt.at, ackCount: acks.length });
await step(`acked ${reply?.id}, meant ${meant}`);
await page.waitForTimeout(4000);
mark('ack-incident', 'end');

await context.close();
const video = await page.video().path();
timeline.video = video;
timeline.sha = sha;
timeline.acks = acks.map(({ seenAt, ...a }) => ({ ...a, at: mmss(seenAt) }));
writeFileSync(join(outDir, 'timeline.json'), JSON.stringify(timeline, null, 2));
await browser.close();
console.log('video', video);
