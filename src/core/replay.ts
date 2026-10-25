/**
 * Replay engine: drives the fixture event stream through the attributor with day snapshots.
 * Snapshots are only valid up to the first user correction or manual feed; everything after that is
 * recomputed live from the new state (the only way to show that a correction learned a *scope*).
 */
import type { Fixture, ISODate, ObservedEvent, Proposition } from '@/contract/types';
import type { Attributor, ProcessOutcome } from './attribution';
import type { Graph, GraphSnapshot } from './graph';
import { addDays, compareISO, dayOf, daysBetween, localISO } from './util';

export interface ReplayStatus {
  cursor: number;
  total: number;
  now: ISODate;
  day: number;
  totalDays: number;
  precomputedUntilDay: number;
  live: boolean;
  invalidatedAt?: ISODate;
}

export interface ReplayState {
  cursor: number;
  now: ISODate;
  invalidatedAt?: ISODate;
  fed?: ObservedEvent[];
  snapshot: GraphSnapshot;
}

export class ReplayEngine {
  private snapshots = new Map<number, GraphSnapshot>();
  private seedSnapshot?: GraphSnapshot;
  cursor = 0;
  now: ISODate;
  invalidatedAt?: ISODate;
  /** Unrehearsed events fed live (they are not in the fixture). */
  fed: ObservedEvent[] = [];
  readonly totalDays: number;
  listeners = new Set<() => void>();
  busy = false;

  constructor(
    readonly fixture: Fixture,
    readonly graph: Graph,
    readonly attributor: Attributor,
  ) {
    this.now = fixture.from;
    this.totalDays = daysBetween(fixture.from, fixture.to) + 1;
  }

  subscribe(l: () => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  private emit(): void {
    for (const l of this.listeners) l();
  }

  status(): ReplayStatus {
    const day = this.dayIndexOf(this.now);
    const precomputedUntilDay = Math.max(-1, ...this.snapshots.keys());
    return { cursor: this.cursor, total: this.fixture.events.length, now: this.now, day, totalDays: this.totalDays, precomputedUntilDay, live: day > precomputedUntilDay, invalidatedAt: this.invalidatedAt };
  }

  dayIndexOf(t: ISODate): number {
    return daysBetween(this.fixture.from, t);
  }
  dayStart(day: number): ISODate {
    const d = addDays(this.fixture.from, day);
    return localISO(this.fixture.persona.timezone, Number(d.slice(0, 4)), Number(d.slice(5, 7)), Number(d.slice(8, 10)), 0, 0);
  }

  /** Load the seed graph (objects, edges, habit propositions). */
  seed(): void {
    const g = this.graph;
    g.batch(() => {
      g.clear();
      for (const o of this.fixture.seedObjects) g.addObject(structuredClone(o));
      for (const p of this.fixture.seedPropositions) g.upsertProposition(structuredClone(p) as Proposition);
      for (const e of this.fixture.seedEdges) g.addEdge(structuredClone(e));
    });
    this.seedSnapshot = g.snapshot();
    this.cursor = 0;
    this.now = this.fixture.from;
    this.invalidatedAt = undefined;
    this.emit();
  }

  /** Process events through `untilDay` inclusive, snapshotting at each day boundary, then return to the seed. */
  async precompute(untilDay: number, onProgress?: (day: number) => void): Promise<void> {
    this.seed();
    this.busy = true;
    try {
      for (let d = 0; d <= untilDay; d++) {
        await this.processDay(d);
        this.snapshots.set(d, this.graph.snapshot());
        onProgress?.(d);
      }
    } finally {
      this.busy = false;
    }
    this.restoreSeed();
  }

  private restoreSeed(): void {
    if (this.seedSnapshot) this.graph.restore(this.seedSnapshot);
    this.cursor = 0;
    this.now = this.fixture.from;
    this.emit();
  }

  /** Process all events of day `d` (cursor must be at the first event of that day or earlier). */
  private async processDay(d: number): Promise<ProcessOutcome[]> {
    const end = this.dayStart(d + 1);
    return this.stepToTime(end, true);
  }

  /** Advance to time `t`, processing every event at or before it. */
  async stepToTime(t: ISODate, quiet = false): Promise<ProcessOutcome[]> {
    const out: ProcessOutcome[] = [];
    const events = this.fixture.events;
    this.busy = true;
    try {
      while (this.cursor < events.length && compareISO(events[this.cursor]!.t, t) <= 0) {
        const ev = events[this.cursor]!;
        this.cursor += 1;
        this.now = ev.t;
        out.push(await this.attributor.process(ev));
        if (!quiet) this.emit();
      }
    } finally {
      this.busy = false;
    }
    if (compareISO(t, this.now) > 0) this.now = t;
    if (!quiet) this.emit();
    return out;
  }

  /** Process exactly one event. */
  async stepEvent(): Promise<ProcessOutcome | undefined> {
    const ev = this.fixture.events[this.cursor];
    if (!ev) return undefined;
    this.cursor += 1;
    this.now = ev.t;
    this.busy = true;
    try {
      const o = await this.attributor.process(ev);
      this.emit();
      return o;
    } finally {
      this.busy = false;
    }
  }

  /** Jump to the end of day `day`: restore a snapshot when one is valid, otherwise recompute live. */
  async seekDay(day: number, onProgress?: (day: number) => void): Promise<void> {
    day = Math.max(-1, Math.min(day, this.totalDays - 1));
    const target = day < 0 ? this.fixture.from : this.dayStart(day + 1);
    const snap = this.snapshots.get(day);
    if (day < 0) {
      this.restoreSeed();
      return;
    }
    if (snap) {
      this.graph.restore(snap);
      this.cursor = this.fixture.events.findIndex((e) => compareISO(e.t, target) > 0);
      if (this.cursor < 0) this.cursor = this.fixture.events.length;
      this.now = this.eveningOf(day);
      this.emit();
      return;
    }
    // Live: start from the nearest earlier snapshot (or seed) and recompute.
    const earlier = [...this.snapshots.keys()].filter((k) => k < day).sort((a, b) => b - a)[0];
    const curDay = this.dayIndexOf(this.now);
    const canContinue = curDay <= day && this.cursor > 0 && (earlier === undefined || curDay >= earlier);
    if (!canContinue) {
      if (earlier !== undefined) {
        this.graph.restore(this.snapshots.get(earlier)!);
        const t = this.dayStart(earlier + 1);
        this.cursor = this.fixture.events.findIndex((e) => compareISO(e.t, t) > 0);
        if (this.cursor < 0) this.cursor = this.fixture.events.length;
        this.now = t;
      } else {
        this.restoreSeed();
      }
    }
    for (let d = this.dayIndexOf(this.now); d <= day; d++) {
      await this.processDay(d);
      onProgress?.(d);
    }
    this.now = this.eveningOf(day);
    this.emit();
  }

  /** 21:30 local on day `day`: every event of the day has been processed, and the context is "home". */
  eveningOf(day: number): ISODate {
    const d = this.dayStart(day);
    return localISO(this.fixture.persona.timezone, Number(d.slice(0, 4)), Number(d.slice(5, 7)), Number(d.slice(8, 10)), 21, 30);
  }

  /** After a correction or manual feed, nothing after `now` may be served from snapshots. */
  invalidateAfter(t: ISODate = this.now): void {
    const d = this.dayIndexOf(t);
    for (const k of [...this.snapshots.keys()]) if (k >= d) this.snapshots.delete(k);
    this.invalidatedAt = t;
    this.emit();
  }

  /** Feed an unrehearsed event right now. */
  async feed(ev: Omit<ObservedEvent, 'id' | 't'> & { t?: ISODate }): Promise<ProcessOutcome> {
    const full: ObservedEvent = { id: `ev_manual_${Date.now().toString(36)}`, t: ev.t ?? this.now, ...ev };
    this.fed.push(full);
    if (compareISO(full.t, this.now) > 0) this.now = full.t;
    this.busy = true;
    try {
      const o = await this.attributor.process(full);
      this.invalidateAfter(full.t);
      this.emit();
      return o;
    } finally {
      this.busy = false;
    }
  }

  reset(): void {
    this.fed = [];
    this.restoreSeed();
  }

  /** Serializable live state: where the replay stands and the graph as the user has shaped it. */
  exportState(): ReplayState {
    return { cursor: this.cursor, now: this.now, invalidatedAt: this.invalidatedAt, fed: this.fed, snapshot: this.graph.snapshot() };
  }
  /** Resume from a saved state: snapshots for later days are dropped, they would predate what the user taught. */
  restoreState(s: ReplayState): void {
    this.cursor = s.cursor;
    this.now = s.now;
    this.invalidatedAt = s.invalidatedAt;
    this.fed = s.fed ?? [];
    const d = this.dayIndexOf(this.now);
    for (const k of [...this.snapshots.keys()]) if (k >= d) this.snapshots.delete(k);
    this.graph.restore(s.snapshot);
    this.emit();
  }

  /** Events of a given day, for the timeline UI. */
  eventsOfDay(day: number): ObservedEvent[] {
    const d = dayOf(this.dayStart(day));
    return this.fixture.events.filter((e) => dayOf(e.t) === d);
  }
}
