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

// ack-incident, the way a person does it: look at a row, move the mouse onto its Ack, and click on that
// spot. The page keeps refreshing while the hand moves. The click goes to the screen position, not to a
// row the script looks up again, so it shows what on-call gets when a new incident lands mid-click.
await step("ack-incident: aim at row 1");
const aimed = page.locator("[data-testid=\"incident-row\"]").first();
const meant = await aimed.getAttribute("data-id");
const box = await aimed.locator("[data-testid=\"ack\"]").boundingBox();
const x = box.x + box.width / 2, y = box.y + box.height / 2;
await page.mouse.move(x, y, { steps: 15 });
mark("ack-incident", `pointer on the Ack of ${meant}, the row I mean`, { meant });
// A person reads the row before clicking; meanwhile the board refreshes. Wait on screen, then click
// when the list moves: the click was already on its way.
await page.waitForFunction((id) => document.querySelector("[data-testid=\"incident-row\"]")?.dataset.id !== id, meant, { timeout: 90_000, polling: 50 });
const landed = await page.getAttribute("[data-testid=\"incident-row\"]:first-child", "data-id");
mark("ack-incident", `new incident ${landed} lands at the top; rows move down`, { landed });
await page.waitForTimeout(120); // reaction time: the hand does not stop
const underPointer = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest("[data-testid=\"incident-row\"]")?.dataset.id, [x, y]);
const clickAt = mark("ack-incident", `click lands on the Ack of ${underPointer}`, { meant, underPointer });
await page.mouse.down(); await page.mouse.up();
await page.waitForSelector(`[data-testid="incident-row"][data-id="${underPointer}"] [data-testid="acked"]`);
const reply = acks.at(-1);
mark("ack-incident", `${reply?.id} marked acked; I meant ${meant}`, { meant, acked: reply?.id, receipt: reply?.receipt, ackedAt: reply?.ackedAt, clickAt: clickAt.at });
await step(`acked ${reply?.id}, meant ${meant}`);
await page.waitForTimeout(5000);
mark("ack-incident", "end");

await context.close();
const video = await page.video().path();
timeline.video = video;
timeline.sha = sha;
timeline.acks = acks.map(({ seenAt, ...a }) => ({ ...a, at: mmss(seenAt) }));
writeFileSync(join(outDir, 'timeline.json'), JSON.stringify(timeline, null, 2));
await browser.close();
console.log('video', video);
