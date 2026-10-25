/** Small, dependency-free helpers shared by core, synth and adapters. No DOM. */
import type { ISODate } from '@/contract/types';

/** Deterministic PRNG (mulberry32). Synth output must be reproducible from a seed. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(r: () => number, arr: readonly T[]): T {
  const v = arr[Math.floor(r() * arr.length)];
  if (v === undefined) throw new Error('pick from empty array');
  return v;
}

let counter = 0;
/** Ids are readable: prefix + monotonic counter + short random tail. */
export function newId(prefix: string, r?: () => number): string {
  counter += 1;
  const tail = Math.floor((r ? r() : Math.random()) * 46656).toString(36).padStart(3, '0');
  return `${prefix}_${counter.toString(36)}${tail}`;
}
export function resetIds(): void {
  counter = 0;
}

// ---------------------------------------------------------------------------
// Dates. All timestamps are ISO strings with an explicit offset for the persona's timezone.
// ---------------------------------------------------------------------------

function tzOffsetMinutes(instant: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  const asUTC = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUTC - instant.getTime()) / 60000);
}

function pad(n: number, w = 2): string {
  return n.toString().padStart(w, '0');
}

/** Build an ISO string for a wall-clock time in `tz`. Handles DST by two-pass offset resolution. */
export function localISO(tz: string, y: number, m: number, d: number, hh = 0, mm = 0): ISODate {
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm));
  let off = tzOffsetMinutes(guess, tz);
  let instant = new Date(guess.getTime() - off * 60000);
  const off2 = tzOffsetMinutes(instant, tz);
  if (off2 !== off) {
    off = off2;
    instant = new Date(guess.getTime() - off * 60000);
  }
  const sign = off >= 0 ? '+' : '-';
  const a = Math.abs(off);
  return `${y}-${pad(m)}-${pad(d)}T${pad(hh)}:${pad(mm)}:00${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

export function addDays(iso: ISODate, days: number): ISODate {
  const d = new Date(iso);
  const off = iso.slice(-6);
  const local = new Date(d.getTime() + offsetToMs(off) + days * 86400000);
  return `${local.toISOString().slice(0, 19)}${off}`;
}

function offsetToMs(off: string): number {
  const sign = off.startsWith('-') ? -1 : 1;
  const [h, m] = off.slice(1).split(':').map(Number);
  return sign * ((h ?? 0) * 60 + (m ?? 0)) * 60000;
}

/** YYYY-MM-DD in the string's own offset. */
export function dayOf(iso: ISODate): string {
  return iso.slice(0, 10);
}

export function hourOf(iso: ISODate): number {
  return Number(iso.slice(11, 13));
}

export function weekdayOf(iso: ISODate): number {
  // 0 = Sunday, computed in the string's own offset
  const d = new Date(iso.slice(0, 19) + 'Z');
  return d.getUTCDay();
}

export function compareISO(a: ISODate, b: ISODate): number {
  return new Date(a).getTime() - new Date(b).getTime();
}

export function daysBetween(a: ISODate, b: ISODate): number {
  return Math.round((new Date(dayOf(b) + 'T00:00:00Z').getTime() - new Date(dayOf(a) + 'T00:00:00Z').getTime()) / 86400000);
}

export function fmtDate(iso: ISODate, _lang: 'en' = 'en'): string {
  const d = new Date(iso.slice(0, 19) + 'Z');
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return `${names[d.getUTCDay()]} ${m}/${day}`;
}

export function fmtTime(iso: ISODate): string {
  return iso.slice(11, 16);
}

// ---------------------------------------------------------------------------
// Vectors
// ---------------------------------------------------------------------------

export function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / Math.sqrt(na * nb);
}

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^\p{L}\p{N}\s'@/-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokens(text: string): string[] {
  return normalize(text)
    .split(' ')
    .filter((w) => w.length > 1);
}

export function clamp(x: number, lo = 0, hi = 1): number {
  return Math.max(lo, Math.min(hi, x));
}
