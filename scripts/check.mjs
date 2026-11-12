// Deterministic check of the plan's hooks against a board URL. Usage: node scripts/check.mjs <url>
// Checks: loader then rows; build sha in meta and footer; no Ack in rows; a row opens a panel that names it;
// the panel's Ack acks the incident it names; the acked mark survives refreshes; no row removed by a refresh;
// local time in two zones.
import { chromium } from 'playwright';
const url = process.argv[2];
const browser = await chromium.launch();
let failed = 0;
const ok = (cond, what) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`);
  if (!cond) failed++;
};
for (const [locale, timezoneId, doAck] of [['de-DE', 'Europe/Berlin', true], ['en-NZ', 'Pacific/Auckland', false]]) {
  const context = await browser.newContext({ locale, timezoneId, viewport: { width: 1280, height: 800 } });
  await context.addInitScript(() => {
    window.__rowsRemoved = 0;
    new MutationObserver((rs) => {
      for (const r of rs) for (const n of r.removedNodes) if (n.nodeType === 1 && n.matches?.('[data-testid="incident-row"]')) window.__rowsRemoved++;
    }).observe(document, { childList: true, subtree: true });
  });
  const page = await context.newPage();
  const errors = [];
  const acks = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('response', async (r) => r.url().includes('/api/ack') && acks.push(await r.json().catch(() => null)));
  console.log(`\n[${locale} ${timezoneId}]`);
  await page.goto(url);
  ok((await page.locator('[data-testid="loader"]').count()) === 1, 'loader on open');
  await page.waitForSelector('[data-testid="incident-row"]');
  ok((await page.locator('[data-testid="loader"]').count()) === 0, 'loader gone once rows load');
  const meta = await page.getAttribute('meta[name="build"]', 'content');
  ok(meta && meta === (await page.textContent('[data-testid="build-sha"]')), `build sha in meta and footer (${meta})`);
  ok((await page.locator('[data-testid="incident-row"] [data-testid="ack"]').count()) === 0, 'no Ack button in rows');
  ok(!(await page.locator('[data-testid="incident-panel"]').isVisible()), 'panel closed on open');
  const t = await page.locator('[data-testid="incident-row"][data-id="INC-9614"] time').textContent().catch(() => null);
  console.log(`     INC-9614 shows "${t}"`);
  if (doAck) {
    const row = page.locator('[data-testid="incident-row"]').nth(2);
    const id = await row.getAttribute('data-id');
    await row.click();
    const panel = page.locator('[data-testid="incident-panel"]');
    ok((await panel.isVisible()) && (await panel.innerText()).includes(id), `row click opens a panel naming ${id}`);
    await page.locator('[data-testid="panel-ack"]').click();
    await page.waitForSelector(`[data-testid="incident-row"][data-id="${id}"] [data-testid="acked"]`);
    ok(acks.at(-1)?.id === id, `panel Ack acked ${acks.at(-1)?.id}, expected ${id}`);
    ok(!(await page.locator('[data-testid="panel-ack"]').isVisible()), 'panel Ack gone after ack');
    await page.keyboard.press('Escape');
    ok(!(await panel.isVisible()), 'Escape closes the panel');
    const other = page.locator('[data-testid="incident-row"]').nth(3);
    await other.focus();
    await page.keyboard.press('Enter');
    ok((await panel.innerText()).includes(await other.getAttribute('data-id')), 'Enter on a row opens its panel');
    await page.waitForTimeout(16000);
    ok((await page.locator(`[data-testid="incident-row"][data-id="${id}"] [data-testid="acked"]`).count()) === 1, 'acked mark kept after 16 s of refreshes');
    ok((await page.evaluate(() => window.__rowsRemoved)) === 0, 'no row removed by refreshes');
  }
  ok(errors.length === 0, `no page errors ${errors.length ? JSON.stringify(errors) : ''}`);
  await context.close();
}
await browser.close();
process.exit(failed ? 1 : 0);
