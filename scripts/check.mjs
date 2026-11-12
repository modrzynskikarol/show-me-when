// Deterministic check of the plan's hooks against a board URL. Usage: node check.mjs <url> [--ack]
import { chromium } from 'playwright';
const url = process.argv[2];
const doAck = process.argv.includes('--ack');
const browser = await chromium.launch();
for (const [locale, timezoneId] of [['de-DE', 'Europe/Berlin'], ['en-NZ', 'Pacific/Auckland']]) {
  const page = await (await browser.newContext({ locale, timezoneId })).newPage();
  const logs = [];
  page.on('console', (m) => logs.push(m.text()));
  page.on('pageerror', (e) => logs.push('PAGEERROR ' + e.message));
  await page.goto(url);
  const loaderAtOpen = await page.locator('[data-testid="loader"]').count();
  await page.waitForSelector('[data-testid="incident-row"]');
  const loaderAfter = await page.locator('[data-testid="loader"]').count();
  const meta = await page.getAttribute('meta[name="build"]', 'content');
  const footer = await page.textContent('[data-testid="build-sha"]');
  const rows = await page.$$eval('[data-testid="incident-row"]', (rs) =>
    rs.map((r) => ({ id: r.dataset.id, t: r.querySelector('time').textContent, dt: r.querySelector('time').getAttribute('datetime') })));
  console.log(`\n[${locale} ${timezoneId}] loader open=${loaderAtOpen} after=${loaderAfter} meta=${meta} footer=${footer} rows=${rows.length}`);
  console.log(rows.slice(0, 2), rows.at(-1));
  if (doAck && locale === 'de-DE') {
    const row = page.locator('[data-testid="incident-row"]').nth(1);
    const id = await row.getAttribute('data-id');
    // hold a reference to the node before refreshes
    const handle = await row.elementHandle();
    await row.locator('[data-testid="ack"]').click();
    await page.waitForSelector(`[data-testid="incident-row"][data-id="${id}"] [data-testid="acked"]`);
    await page.waitForTimeout(5000); // two+ refreshes
    const stillAcked = await page.locator(`[data-testid="incident-row"][data-id="${id}"] [data-testid="acked"]`).count();
    const sameNode = await handle.evaluate((n) => n.isConnected);
    const acks = logs.filter((l) => l.startsWith('ack'));
    console.log(`acked ${id}: mark after 5 s=${stillAcked}, same node=${sameNode}, ack logs=${acks.length}`);
  }
  console.log('errors:', logs.filter((l) => /error|PAGEERROR/i.test(l)));
}
await browser.close();
