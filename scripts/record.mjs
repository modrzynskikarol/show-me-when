// Records the plan's flows on a board URL with a real browser and writes a timeline of what happened.
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

// ack-incident: ack the second row (a real choice, not the top row that new incidents push down)
await step('ack-incident');
const target = page.locator('[data-testid="incident-row"]').nth(1);
const targetId = await target.getAttribute('data-id');
await target.locator('[data-testid="ack"]').hover();
await page.waitForTimeout(1200);
const clickAt = mark('ack-incident', `click Ack on ${targetId}`);
await target.locator('[data-testid="ack"]').click();
await page.waitForSelector(`[data-testid="incident-row"][data-id="${targetId}"] [data-testid="acked"]`);
const ackReply = acks.find((a) => a.id === targetId);
mark('ack-incident', `${targetId} marked acked`, { id: targetId, receipt: ackReply?.receipt, ackedAt: ackReply?.ackedAt, clickAt: clickAt.at });
await page.waitForTimeout(2500);

// watch-board: keep it open, no reload, until a new incident lands at the top
await step('watch-board (no reload)');
mark('watch-board', 'watching, no reload', { top: firstIds[0] });
const deadline = Date.now() + 90_000;
let newTop = null;
while (Date.now() < deadline) {
  const top = await page.getAttribute('[data-testid="incident-row"]:first-child', 'data-id');
  if (top !== firstIds[0] && !firstIds.includes(top)) {
    newTop = top;
    break;
  }
  await page.waitForTimeout(250);
}
const stillAcked = await page.locator(`[data-testid="incident-row"][data-id="${targetId}"] [data-testid="acked"]`).count();
mark('watch-board', newTop ? `new incident ${newTop} at the top, no reload` : 'no new incident within 90 s', {
  newTop,
  ackedStillMarked: stillAcked === 1,
});
await page.waitForTimeout(4000);
mark('watch-board', 'end');

await context.close();
const video = await page.video().path();
timeline.video = video;
timeline.sha = sha;
timeline.acks = acks.map(({ seenAt, ...a }) => ({ ...a, at: mmss(seenAt) }));
writeFileSync(join(outDir, 'timeline.json'), JSON.stringify(timeline, null, 2));
await browser.close();
console.log('video', video);
