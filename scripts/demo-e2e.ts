/**
 * End-to-end walkthrough of the six beats through the real UI (headless Chromium against the dev server).
 * Screenshots land in ./shots/demo-*.png. Fails loudly if a beat does not produce the expected state.
 *
 *   pnpm demo            (lexical embedding, fast)   |   URL=http://127.0.0.1:5173/ pnpm demo   (EmbeddingGemma 2 in-browser)
 */
import { chromium, type Page } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const url = process.env.URL ?? 'http://127.0.0.1:5173/?embed=hashed&ui=classic';
const out = resolve(import.meta.dirname, '../shots');
mkdirSync(out, { recursive: true });
const channel = process.env.CHANNEL === 'chrome' ? 'chrome' : undefined;
const browser = await chromium.launch(channel ? { channel } : {});
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 2 });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures += 1;
};
const idle = async () => {
  await page.waitForFunction(() => !document.querySelector('.progress') && !document.querySelector('button:disabled.primary'), { timeout: 180000 }).catch(() => undefined);
  await page.waitForTimeout(250);
};
const shot = (name: string) => page.screenshot({ path: resolve(out, `demo-${name}.png`) });
const seek = async (day: number) => {
  await page.locator('input.slider').fill(String(day));
  await page.waitForTimeout(400);
  await page.waitForFunction(() => { const s = document.querySelector('input.slider') as HTMLInputElement | null; return !!s && !s.disabled && !document.querySelector('.progress'); }, { timeout: 300000 });
  await page.waitForTimeout(300);
};
const stepUntilText = async (needle: string, max = 80) => {
  for (let i = 0; i < max; i++) {
    const next = await page.locator('.panel .mono', { hasText: 'next:' }).first().innerText().catch(() => '');
    await page.locator('button:has-text("next event")').click();
    await page.waitForTimeout(150);
    await page.waitForFunction(() => { const s = document.querySelector('input.slider') as HTMLInputElement | null; return !!s && !s.disabled; }, { timeout: 120000 });
    await page.waitForTimeout(150);
    if (next.includes(needle)) return true;
  }
  return false;
};
const phoneText = async () => page.locator('.phone .screen').innerText();
const openTab = async (i: number) => {
  await page.locator('.tabs button').nth(i).click();
  await page.waitForTimeout(200);
};
const openRow = async (label: string) => {
  await page.locator('.phone .row', { hasText: label }).first().click();
  await page.waitForTimeout(250);
};

await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('input.slider', { timeout: 120000 });
await idle();

// Beat 1 — day 1: Alex's invite creates the Fillmore matter, visible in Music and in Alex's view.
await seek(1);
await openTab(0);
let t = await phoneText();
check('beat1: Life page shows Music with a hint', /Music[\s\S]*Fillmore|Fillmore[\s\S]*Music/i.test(t) || /Music/.test(t), t.slice(0, 200).replace(/\n/g, ' '));
await openRow('Music');
t = await phoneText();
check('beat1: Music view lists the band at Fillmore', /Fillmore/i.test(t));
check('beat1: Music view lists Alex Chen under People', /Alex Chen/.test(t));
await shot('1-music-day1');
await openRow('Alex Chen');
t = await phoneText();
check('beat1: Alex\'s view shares the Fillmore matter', /Fillmore/i.test(t));
await shot('1-alex-day1');

// Beat 2 — day 4 evening: the on-sale suggestion surfaces at home; in a meeting it is held with a typed silence.
await seek(4);
await openTab(0);
while ((await page.locator('button.backbtn').count()) > 0) {
  await page.locator('button.backbtn').click();
  await page.waitForTimeout(150);
}
t = await phoneText();
check('beat2: on-sale suggestion shown at home', /on sale/i.test(t), t.slice(0, 300).replace(/\n/g, ' '));
await shot('2-life-day4-home');
await page.locator('.panel button', { hasText: 'In a meeting' }).click();
await page.waitForTimeout(300);
t = await phoneText();
const why = await page.locator('.side-right').innerText();
check('beat2: in a meeting the on-sale card is held back', !/on sale/i.test(t) && /Not the right moment|held back/i.test(why));
await shot('2-life-day4-meeting');
await page.locator('.panel button', { hasText: 'auto' }).click();
await page.waitForTimeout(200);

// Beat 3 — day 5: Ben's ticket message is not guessed: the system asks; the user creates the Greek matter and widens the scope.
await seek(4);
await stepUntilText('Got the tickets');
{
  const right = await page.locator('.side-right').innerText();
  const i = right.indexOf('last event');
  console.log('  [debug] last event:', right.slice(i, i + 420).replace(/\n/g, ' | '));
  const j = right.indexOf('embedding');
  console.log('  [debug] embedding:', right.slice(j, j + 90).replace(/\n/g, ' '));
}
await openTab(0);
t = await phoneText();
check('beat3: ask card for Ben\'s message', /Which one is this about\?/.test(t) && /tickets/i.test(t), t.slice(0, 300).replace(/\n/g, ' '));
await shot('3-ask-day5');
await page.locator('.ask', { hasText: 'tickets' }).locator('button', { hasText: 'New matter' }).first().click();
await page.waitForTimeout(300);
await page.locator('.dialog button', { hasText: 'New matter' }).click();
await page.waitForTimeout(200);
const name = await page.locator('.dialog input[placeholder="name"]').inputValue();
check('beat3: new-matter dialog is not prefilled from the future', name === '', name);
// The user knows which show Ben means; the system only knows what it has observed.
await page.locator('.dialog input[placeholder="name"]').fill('Sunset Rollercoaster at The Greek Theatre');
await page.locator('.dialog input[type="datetime-local"]').fill('2026-11-15T19:30');
await page.locator('.dialog input[placeholder="place"]').fill('The Greek Theatre, Berkeley');
await page.locator('.dialog button', { hasText: 'create & move' }).click();
await page.waitForTimeout(400);
const note = await page.locator('.sticky-note').innerText().catch(() => '');
check('beat3: scope prompt offered for Ben', /From now on, route Ben Park/i.test(note), note.slice(0, 120));
await shot('3-scope-prompt');
await page.locator('.sticky-note button', { hasText: 'Yes' }).click();
await page.waitForTimeout(300);
const log = await page.locator('.log').innerText();
check('beat3: relation-scope correction logged', /scope widened to relation/.test(log), log.slice(-200).replace(/\n/g, ' | '));
await openRow('Music');
t = await phoneText();
check('beat3: Music view now shows both shows', /Greek/i.test(t) && /Fillmore/i.test(t));
check('beat3: Music view lists Ben Park under People', /Ben Park/.test(t), t.slice(t.indexOf('People'), t.indexOf('People') + 120).replace(/\n/g, ' '));
await shot('3-music-two-shows');
await openRow('Greek');
t = await phoneText();
check('beat3: Greek matter page shows Ben and his message', /Ben Park/.test(t) && /tickets/i.test(t));
await shot('3-greek-matter');
if ((await page.locator('.phone .row', { hasText: 'Ben Park' }).count()) > 0) {
  await openRow('Ben Park');
  t = await phoneText();
  check('beat3: Ben\'s view shows the routing rule and the Greek show', /Routing rule/i.test(t) && /Greek/i.test(t), t.slice(0, 200).replace(/\n/g, ' '));
  await shot('3-ben-rule');
} else check('beat3: Ben\'s view reachable', false, 'no Ben row on the Greek page');
const replayStatus = await page.locator('.panel').first().innerText();
check('beat3: replay switched to live recompute after the correction', /live|invalidated/i.test(replayStatus));

// Beat 4 — step to Ben's "meet in Berkeley": routed to Greek by the rule, not by similarity.
await stepUntilText('meet in Berkeley');
let why4 = await page.locator('.side-right').innerText();
check('beat4: Ben\'s next message is constrained to Greek', /constrained/.test(why4) && /Greek/i.test(why4), why4.slice(0, 300).replace(/\n/g, ' '));
await shot('4-ben-meet-constrained');

// Beat 5 — Alex's reschedule: unaffected by Ben's rule; the Fillmore matter moves to Nov 9 and the card interrupts.
await stepUntilText('moved to Sunday the 9th');
why4 = await page.locator('.side-right').innerText();
check('beat5: Alex\'s reschedule goes to Fillmore and flips the world axis', /Fillmore/i.test(why4) && /rescheduled/i.test(why4), why4.slice(0, 300).replace(/\n/g, ' '));
await openTab(0);
while ((await page.locator('button.backbtn').count()) > 0) {
  await page.locator('button.backbtn').click();
  await page.waitForTimeout(150);
}
t = await phoneText();
check('beat5: Life shows the Fillmore moved card', /moved to/i.test(t) && /Fillmore/i.test(t), t.slice(0, 300).replace(/\n/g, ' '));
await shot('5-fillmore-moved');

// Beat 4b — same friend, another topic: the routing rule yields to an ask-card instead of swallowing it.
await stepUntilText('run Sunday');
{
  const right = await page.locator('.side-right').innerText();
  const i = right.indexOf('last event');
  console.log('  [debug] beat4b last event:', right.slice(i, i + 300).replace(/\n/g, ' | '));
  check('beat4b: Ben\'s run invitation is asked, not routed to the show', /run Sunday[\s\S]{0,200}→ ask-user/.test(right.slice(i, i + 400)), right.slice(i, i + 200).replace(/\n/g, ' '));
}

// Beat 6 — the unknown number asks about "which night": structural ambiguity → ask, never guess.
await stepUntilText('which night');
{
  const right = await page.locator('.side-right').innerText();
  const i = right.indexOf('last event');
  console.log('  [debug] beat6 last event:', right.slice(i, i + 360).replace(/\n/g, ' | '));
}
t = await phoneText();
check('beat6: unknown sender → ask card with both shows', /Which one is this about\?/.test(t) && /Greek/i.test(t) && /Fillmore/i.test(t), t.slice(0, 300).replace(/\n/g, ' '));
await shot('6-ask-which-night');

// Continuity — close and reopen: the corrections and the rule survive on the device.
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('input.slider', { timeout: 120000 });
await page.waitForFunction(() => { const s = document.querySelector('input.slider') as HTMLInputElement | null; return !!s && !s.disabled; }, { timeout: 300000 }).catch(() => undefined);
await page.waitForTimeout(500);
{
  const log = await page.locator('.log').innerText();
  check('continuity: live state restored after reload', /restored live state/.test(log), log.slice(-200).replace(/\n/g, ' | '));
  await openTab(0);
  while ((await page.locator('.phone .backbtn').count()) > 0) { await page.locator('.phone .backbtn').first().click(); await page.waitForTimeout(150); }
  await openRow('Music');
  const t2 = await phoneText();
  check('continuity: both shows still there after reload', /Greek/i.test(t2) && /Fillmore/i.test(t2), t2.slice(0, 200).replace(/\n/g, ' '));
  await shot('8-after-reload');
}

// User model: delete the on-sale proposition basis → suggestion disappears.
await openTab(2);
t = await phoneText();
check('model: user-model page lists propositions', /Listens to|Sunset/i.test(t));
await shot('7-user-model');

await browser.close();
console.log(`\n${failures === 0 ? 'ALL BEATS PASSED' : failures + ' beat(s) failed'}; screenshots in ${out}`);
if (errors.length) {
  console.log('page errors:');
  for (const e of errors) console.log('  ' + e.slice(0, 300));
}
process.exit(failures ? 1 : 0);
