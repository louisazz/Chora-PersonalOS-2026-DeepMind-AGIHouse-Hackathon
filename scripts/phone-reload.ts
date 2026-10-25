/**
 * Reload the page in the attached Pixel's Chrome over CDP and screenshot it.
 *   adb forward tcp:9222 localabstract:chrome_devtools_remote && pnpm exec tsx scripts/phone-reload.ts
 * Env: PHONE_URL (default http://localhost:4173/?mode=phone), SHOT (png path).
 */
import { chromium } from 'playwright';

const target = process.env.PHONE_URL ?? 'http://localhost:4173/?mode=phone';
const shot = process.env.SHOT ?? '/tmp/phone.png';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const ctx = browser.contexts()[0]!;
let page = ctx.pages().find((p) => p.url().includes('localhost:4173') || p.url().includes('localhost:5173'));
if (!page) page = await ctx.newPage();
console.log('was on', page.url());
const cdp = await ctx.newCDPSession(page);
await cdp.send('Network.clearBrowserCache');
await page.goto(target, { waitUntil: 'domcontentloaded' });
await page.waitForLoadState('domcontentloaded');
console.log('scripts', (await page.evaluate('[...document.scripts].map(s=>s.src.split("/").pop()).join(" ")')) as string);
await page.waitForFunction("(document.querySelector('.os-host')?.shadowRoot?.textContent||'').includes('My life')", null, { timeout: 120_000 });
console.log('OS home rendered on the phone');
const t0 = Date.now();
await page.waitForFunction("(() => { const s = document.querySelector('input.slider'); return !!s && !s.disabled; })()", null, { timeout: 600_000 });
console.log(`precompute done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
const logs = (await page.evaluate("document.body.innerText")) as string;
const m = logs.match(/fixture loaded[^\n]*|precomputed[^\n]*|restored[^\n]*/g);
console.log((m ?? []).join(' | '));
await page.screenshot({ path: shot });
console.log('screenshot', shot);
await browser.close();
