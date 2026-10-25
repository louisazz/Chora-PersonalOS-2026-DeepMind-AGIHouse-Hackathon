/**
 * Smoke-test the OS home screen (src/os) against a running server, in a real Chrome.
 * URL=http://127.0.0.1:4173/?embed=hashed pnpm tsx scripts/os-smoke.ts
 * Checks: home renders from the live snapshot, the next show is on it, the Music page lists shows,
 */
import { chromium } from 'playwright';

const url = process.env.URL ?? 'http://127.0.0.1:4173/?embed=hashed';
const shots = process.env.SHOTS ?? '/tmp/os-smoke';
const browser = await chromium.launch({ channel: process.env.CHANNEL ?? 'chrome', headless: process.env.HEADED ? false : true });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('CONSOLE', m.text());
});
let failed = 0;
const check = (name: string, ok: boolean, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) failed += 1;
};
const osText = () => page.evaluate("document.querySelector('.os-host')?.shadowRoot?.textContent || ''") as Promise<string>;
const idle = () => page.waitForFunction("(() => { const s = document.querySelector('input.slider'); return !!s && !s.disabled; })()", null, { timeout: 180_000 });

await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction("(document.querySelector('.os-host')?.shadowRoot?.textContent||'').includes('My life')", null, { timeout: 60_000 });
check('home renders inside the shadow root', true);
await idle();
await page.locator('input.slider').focus();
await page.keyboard.press('End');
await page.waitForTimeout(300);
await idle();
let t = await osText();
check('next show is on the home screen', /Sunset Rollercoaster, nearby|show moved to|show is cancelled/.test(t), t.match(/Sunset Rollercoaster[^·]{0,40}/)?.[0]);
check('status bar shows replay time, not the static clock', !/17:41/.test(t.slice(0, 200)));
await page.screenshot({ path: `${shots}-home.png` });

await page.locator('.os-host button.life-row[data-id="music"]').click();
await page.waitForTimeout(200);
t = await osText();
check('music page lists live shows', /Shows/.test(t) && /Fillmore/.test(t), t.match(/Shows.{0,120}/)?.[0]);
await page.screenshot({ path: `${shots}-music.png` });
const show = page.locator('.os-host button.live-show').first();
if (await show.count()) {
  await show.click();
  await page.waitForTimeout(200);
  t = await osText();
  check('show sheet opens with details', /Messages filed here|What Chora knows/.test(t));
  await page.screenshot({ path: `${shots}-show.png` });
  await page.locator('.os-host button.close-button').click();
}
await page.locator('.os-host button.back-button[data-action="home"]').click();
await page.waitForTimeout(200);

await page.locator('.os-host [data-action="settings"]').first().click();
await page.waitForTimeout(200);
await page.locator('.os-host [data-action="memory"]').click();
await page.waitForTimeout(200);
t = await osText();
check('memory sheet lists what Chora knows', /What Chora knows about you/.test(t) && /Listens to|Sunset Rollercoaster/.test(t));
await page.screenshot({ path: `${shots}-memory.png` });
await page.locator('.os-host button.close-button').click();

await page.locator('.os-host [data-action="assistant"]').click();
await page.waitForTimeout(200);
await page.locator('.os-host #assistant-input').fill('Ben Park: what time should we meet in Berkeley on the 15th?');
await page.keyboard.press('Enter');
await page.waitForFunction("/Filed under|Needs your call|Kept aside|New:|Nothing worth/.test(document.querySelector('.os-host')?.shadowRoot?.textContent||'')", null, { timeout: 60_000 }).catch(() => {});
t = await osText();
check('typed message goes through the core', /Filed under|Needs your call|Kept aside|New:|Nothing worth/.test(t), t.match(/(Filed under|Needs your call|Kept aside|New:|Nothing worth)[^<]{0,60}/)?.[0]);
await page.screenshot({ path: `${shots}-fed.png` });

const asks = await page.locator('.os-host [data-action="live-ask"]').count();
console.log(`ask cards on home: ${asks}`);
if (asks) {
  await page.locator('.os-host [data-action="live-ask"]').first().click();
  await page.waitForTimeout(200);
  t = await osText();
  check('ask sheet offers candidates and "something else"', /Which is this about\?/.test(t) && /Something else/.test(t));
  await page.screenshot({ path: `${shots}-ask.png` });
  await page.locator('.os-host [data-action="live-correct"]').click();
  await page.waitForTimeout(300);
  const dialog = await page.locator('.dialog').count();
  check('"something else" opens the correction dialog', dialog > 0);
  await page.screenshot({ path: `${shots}-correct.png` });
}

console.log(failed ? `${failed} CHECK(S) FAILED` : 'OS SMOKE PASSED');
await browser.close();
process.exit(failed ? 1 : 0);
