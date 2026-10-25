/**
 * Deterministic, persona-independent helpers used before/around the model:
 * - triage: drop obviously worthless events (marketing, system noise) without a model call
 * - world-state change detection from natural language
 */
import type { ExtractResponse, ISODate, ObservedEvent, WorldState } from '@/contract/types';
import { addDays, weekdayOf } from './util';

const PROMO = /(\d+\s?% off|deal(s)?\b|promo|free delivery|your receipt|order (is|has been)|coupon|flash sale|today only|limited time)/i;
const SYSTEM = /(battery at|system update|update available|low storage|screen time|wi-?fi connected|bluetooth:|connected$|timesheet|build #\d+|reacted .* to your|pto request|password will expire)/i;
// An app saying that something happened inside it, without the content: nothing to attribute, nothing to remember.
const APP_CHATTER = /\b(new comment on|commented on your|\d+ unread|unread messages|new follower|liked your|mentioned you in|is typing)\b/i;

/** First gate: 'drop' means obviously worthless. Everything else goes to extraction. */
export function triage(ev: ObservedEvent): 'drop' | 'keep' {
  const text = ev.text ?? '';
  if (ev.source === 'notification') {
    if (PROMO.test(text) || SYSTEM.test(text) || APP_CHATTER.test(text)) return 'drop';
    if (ev.app && /^(system)$/i.test(ev.app)) return 'drop';
  }
  if (ev.source === 'photo' && (!text || /^IMG\b/i.test(text))) return 'drop';
  return 'keep';
}

const RESCHEDULE = /\b(moved to|rescheduled|postponed|pushed to|now departs|now every|is \d{1,2}(?::\d{2})? not \d{1,2}|got moved|changed to|\(moved\)|code has changed|new access code)\b/i;
const CANCEL = /\b(cancel+ed|no class|is closed|called off|not happening)\b/i;

export function detectWorldState(text: string): WorldState | undefined {
  if (CANCEL.test(text)) return 'cancelled';
  if (RESCHEDULE.test(text)) return 'rescheduled';
  return undefined;
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
const WEEKDAYS: Record<string, number> = {
  sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6,
};

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

/** Rebuild an ISO string on the same offset as `base` with a new local date/time. */
function withLocal(base: ISODate, y: number, m: number, d: number, hh: number, mm: number): ISODate {
  return `${y}-${pad(m)}-${pad(d)}T${pad(hh)}:${pad(mm)}:00${base.slice(-6)}`;
}

export type ClockPreference = 'am' | 'pm';

function parseClock(text: string, prefer?: ClockPreference): { hh: number; mm: number } | undefined {
  // 10:00 AM · 7:30 pm · 6:30am · 19:00 · "at 6" · "7 pm"
  const m1 = text.match(/\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/i);
  if (m1) {
    let hh = Number(m1[1]);
    const mm = Number(m1[2]);
    const ap = m1[3]?.toLowerCase();
    if (ap === 'pm' && hh < 12) hh += 12;
    if (ap === 'am' && hh === 12) hh = 0;
    // No marker: the 12-hour reading is ambiguous; the caller may know which half of the day the thing lives in.
    if (!ap && prefer === 'pm' && hh >= 1 && hh <= 11) hh += 12;
    if (hh <= 23 && mm <= 59) return { hh, mm };
  }
  const m2 = text.match(/\b(\d{1,2})\s*(am|pm)\b/i);
  if (m2) {
    let hh = Number(m2[1]);
    const ap = m2[2]?.toLowerCase();
    if (ap === 'pm' && hh < 12) hh += 12;
    if (ap === 'am' && hh === 12) hh = 0;
    return { hh, mm: 0 };
  }
  const m3 = text.match(/\b(?:at|around|thinking)\s+(\d{1,2})\b(?!\s*(?:km|k|th|st|nd|rd|%))/i);
  if (m3) {
    const h = Number(m3[1]);
    // bare "at 6" in a social message means evening unless the caller knows better
    return { hh: prefer !== 'am' && h <= 11 && h >= 1 ? h + 12 : h, mm: 0 };
  }
  return undefined;
}

/** True when the text's clock has no am/pm marker and reads 1–11 ("7:30", "at 6"): the graph may settle which half of the day. */
export function clockIsAmbiguous(text: string): boolean {
  const m1 = text.match(/\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/i);
  if (m1) return !m1[3] && Number(m1[1]) >= 1 && Number(m1[1]) <= 11;
  if (/\b(\d{1,2})\s*(am|pm)\b/i.test(text)) return false;
  const m3 = text.match(/\b(?:at|around|thinking)\s+(\d{1,2})\b(?!\s*(?:km|k|th|st|nd|rd|%))/i);
  return !!m3 && Number(m3[1]) >= 1 && Number(m3[1]) <= 11;
}

const CADENCE_DAY = /\b(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:[a-z]*day)?s?\b/gi;

/** Weekdays named by a recurrence string ("Tue/Thu 19:00", "weekdays 08:30", "every Saturday"); undefined when it names none. */
export function cadenceWeekdays(cadence: string): Set<number> | undefined {
  const lower = cadence.toLowerCase();
  const days = new Set<number>();
  if (/\bweekdays?\b/.test(lower)) for (const d of [1, 2, 3, 4, 5]) days.add(d);
  if (/\bweekends?\b/.test(lower)) for (const d of [0, 6]) days.add(d);
  if (/\b(daily|every day)\b/.test(lower)) for (const d of [0, 1, 2, 3, 4, 5, 6]) days.add(d);
  for (const m of lower.matchAll(CADENCE_DAY)) {
    const d = WEEKDAYS[m[1]!];
    if (d !== undefined) days.add(d);
  }
  return days.size ? days : undefined;
}

/** The clock a recurrence string names, if any ("19:00", "7 pm"). */
export function cadenceClock(cadence: string): { hh: number; mm: number } | undefined {
  return parseClock(cadence);
}

/**
 * Does a date fall on the recurrence? The weekday must match; with `requireClock` the hour must also be within one
 * hour of the recurrence's own clock (a calendar entry at 19:00 on a Tuesday for a "Tue/Thu 19:00" class).
 */
export function cadenceMatches(cadence: string, iso: ISODate, requireClock = false): boolean {
  const days = cadenceWeekdays(cadence);
  if (!days || !days.has(weekdayOf(iso))) return false;
  if (!requireClock) return true;
  const clock = parseClock(cadence);
  if (!clock) return false;
  const hh = Number(iso.slice(11, 13)) + Number(iso.slice(14, 16)) / 60;
  return Math.abs(hh - (clock.hh + clock.mm / 60)) <= 1;
}

/**
 * Observations that arrive as structured records carry their proposition in their fields: a media play, a workout
 * summary, a calendar entry. Mapping them is not inference, so no model is asked whether they are "noise" (a small
 * model reads "Now playing" as a system notice and drops it). Free text — messages, notices, announcements — returns
 * undefined here and goes to the extractor.
 */
export function structuredExtract(ev: ObservedEvent, known: string[]): ExtractResponse | undefined {
  const text = (ev.text ?? '').trim();
  if (ev.source === 'media') {
    if (!text) return { propositions: [], verdict: 'drop' };
    const artist = text.split(/\s[—–-]\s/)[0]?.trim() || text;
    return { propositions: [{ text: `Listens to ${artist}`, conf: 0.7, entities: [artist], kind: 'habit' }], verdict: 'keep' };
  }
  if (ev.source === 'workout') {
    if (!text) return { propositions: [], verdict: 'drop' };
    const km = text.match(/(\d+(?:\.\d+)?)\s*km/i)?.[1];
    return { propositions: [{ text: `Workout: ${text}`, conf: 0.9, entities: [km ? 'run' : 'workout'], kind: 'fact' }], verdict: 'keep' };
  }
  if (ev.source === 'calendar') {
    if (!text) return { propositions: [], verdict: 'drop' };
    const start = ev.meta?.start;
    const dateRef = typeof start === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(start) ? `${start.slice(0, 16)}:00${ev.t.slice(-6)}` : resolveDateRef(text, ev.t);
    const entities = extractEntities(text, known);
    if (entities.length === 0) entities.push(text.slice(0, 60)); // the title names the thing
    const body = text.length > 180 ? text.slice(0, 177) + '…' : text;
    const res: ExtractResponse = { propositions: [{ text: `Calendar: ${body}`, conf: 0.9, entities, kind: 'fact' }], verdict: 'keep' };
    if (dateRef) res.dateRef = dateRef;
    const ws = detectWorldState(text);
    if (ws) res.worldState = ws;
    return res;
  }
  return undefined;
}

/**
 * Resolve the date a text talks about, relative to when it was observed.
 * Returns undefined when nothing date-like is present. Never throws.
 */
export function resolveDateRef(text: string, observedAt: ISODate, opts?: { prefer?: ClockPreference }): ISODate | undefined {
  const lower = text.toLowerCase();
  const y = Number(observedAt.slice(0, 4));
  const mo = Number(observedAt.slice(5, 7));
  const d = Number(observedAt.slice(8, 10));
  const clock = parseClock(text, opts?.prefer);
  const hh = clock?.hh ?? 0;
  const mm = clock?.mm ?? 0;

  // 1. Explicit "Nov 8" / "November 8" / "Oct 30"
  const mAbs = lower.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/);
  if (mAbs) {
    const month = MONTHS[mAbs[1]!]!;
    const day = Number(mAbs[2]);
    let year = y;
    if (month < mo - 6) year += 1;
    return withLocal(observedAt, year, month, day, hh, mm);
  }
  // 1b. ISO-like "2026-11-08T20:00"
  const mIso = text.match(/\b(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?\b/);
  if (mIso) {
    return withLocal(observedAt, Number(mIso[1]), Number(mIso[2]), Number(mIso[3]), Number(mIso[4] ?? hh), Number(mIso[5] ?? mm));
  }
  // 2. "the 12th" / "Sunday the 9th"
  const mOrd = lower.match(/\bthe\s+(\d{1,2})(?:st|nd|rd|th)\b/);
  if (mOrd) {
    const day = Number(mOrd[1]);
    let month = mo;
    let year = y;
    if (day < d) {
      month += 1;
      if (month > 12) {
        month = 1;
        year += 1;
      }
    }
    return withLocal(observedAt, year, month, day, hh, mm);
  }
  // 3. tonight / today / tomorrow
  if (/\btonight\b/.test(lower)) return withLocal(observedAt, y, mo, d, clock?.hh ?? 19, mm);
  if (/\btoday\b/.test(lower)) return withLocal(observedAt, y, mo, d, hh, mm);
  if (/\btomorrow\b/.test(lower)) {
    const nx = addDays(observedAt, 1);
    return withLocal(observedAt, Number(nx.slice(0, 4)), Number(nx.slice(5, 7)), Number(nx.slice(8, 10)), hh, mm);
  }
  // 4. weekday name → next occurrence (today counts if later in the day)
  const mWd = lower.match(/\b(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:[a-z]*day)?\b/);
  if (mWd) {
    const target = WEEKDAYS[mWd[1]!] ?? WEEKDAYS[mWd[0]!];
    if (target !== undefined) {
      const cur = weekdayOf(observedAt);
      let delta = (target - cur + 7) % 7;
      if (delta === 0 && clock && clock.hh < Number(observedAt.slice(11, 13))) delta = 7;
      const nx = addDays(observedAt, delta);
      return withLocal(observedAt, Number(nx.slice(0, 4)), Number(nx.slice(5, 7)), Number(nx.slice(8, 10)), hh, mm);
    }
  }
  return undefined;
}

/** Does the text name a day (a date, "the 12th", today/tonight/tomorrow, a weekday), as opposed to only a clock time? */
export function namesADay(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b/.test(lower) ||
    /\b\d{4}-\d{2}-\d{2}\b/.test(text) ||
    /\bthe\s+\d{1,2}(st|nd|rd|th)\b/.test(lower) ||
    /\b(tonight|today|tomorrow)\b/.test(lower) ||
    /\b(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:[a-z]*day)?\b/.test(lower)
  );
}

/** Request vs fact vs habit — surface-level, language-general cues. */
export function classifyKind(text: string, source: ObservedEvent['source']): 'fact' | 'habit' | 'request' {
  if (source === 'media') return 'habit';
  if (/\?|\b(can you|could you|want to|wanna|send me|let me know|you in|bring|remember to|don't forget|please)\b/i.test(text)) return 'request';
  return 'fact';
}

/** Capitalized spans and known-entity hits. Known entities come from the graph, not from the persona. */
export function extractEntities(text: string, known: string[]): string[] {
  const found = new Set<string>();
  const lower = text.toLowerCase();
  for (const k of known) {
    const kl = k.toLowerCase();
    if (kl.length >= 3 && lower.includes(kl)) found.add(k);
  }
  // Capitalized spans not at sentence start are likely proper nouns ("The Fillmore", "Downtown Berkeley BART").
  const spans = text.match(/(?:(?<![.!?]\s)(?<!^)\b[A-Z][\w'’]+(?:\s+(?:of|the|de)?\s*[A-Z][\w'’]+)*)/g) ?? [];
  for (const s of spans) {
    if (s.length >= 3 && !/^(I|I'm|I’m|You|We|They|He|She|It|The|A|An|Hey|Heads|Got|Send|Did|Are|Can|Any|Not|Here|Updated|Great|Tonight|Tuesday|Thursday|Monday|Friday|Saturday|Sunday|Wednesday)$/.test(s)) found.add(s);
  }
  return [...found];
}
