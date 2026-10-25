/**
 * Expand a persona skeleton into a Fixture: seed graph, ~150 heterogeneous events, derived annotations,
 * daily expectations and correction scripts. Deterministic for a given seed.
 */
import type {
  DailyExpectation,
  Proposition,
  MatterTemplate,
  Edge,
  EventAnnotation,
  Fixture,
  GraphObject,
  Matter,
  ObservedEvent,
  CorrectionScript,
  ISODate,
} from '@/contract/types';
import { addDays, localISO, rng, pick, weekdayOf } from '@/core/util';
import type { PersonaSkeleton, ScriptedEvent } from './persona';

export interface SynthStats {
  total: number;
  byCls: Record<string, number>;
  bySource: Record<string, number>;
}

export function generateFixture(p: PersonaSkeleton): { fixture: Fixture; stats: SynthStats } {
  const r = rng(p.seed);
  const [y0, m0, d0] = p.start;
  const day0 = localISO(p.timezone, y0, m0, d0, 0, 0);
  const at = (day: number, hh: number, mm: number): ISODate => {
    const base = addDays(day0, day);
    const y = Number(base.slice(0, 4));
    const m = Number(base.slice(5, 7));
    const d = Number(base.slice(8, 10));
    return localISO(p.timezone, y, m, d, hh, mm);
  };
  const t0 = day0;

  const seedObjects: GraphObject[] = [];
  const seedEdges: Edge[] = [];
  let edgeN = 0;
  const edge = (from: string, to: string, type: Edge['type'], extra: Partial<Edge> = {}): void => {
    edgeN += 1;
    seedEdges.push({ id: `e_seed_${edgeN}`, from, to, type, t: t0, conf: 1, ...extra });
  };

  // Domains are activity nodes.
  for (const dom of p.domains) {
    seedObjects.push({ id: `act_${dom}`, type: 'activity', displayName: dom, createdAt: t0, domain: dom });
  }
  // Commute is a work-domain activity derived from the commute parameters.
  seedObjects.push({
    id: 'a_commute',
    type: 'activity',
    displayName: 'Commute',
    createdAt: t0,
    aliases: [p.commute.line, p.commute.station, 'BART'],
    attrs: { line: p.commute.line, station: p.commute.station, departure: p.commute.departure, leaveBy: p.commute.leaveBy },
  });
  edge('a_commute', 'act_work', 'part-of');

  for (const person of p.people) {
    seedObjects.push({ id: person.id, type: 'person', displayName: person.name, createdAt: t0, attrs: { role: person.role } });
  }
  for (const pref of p.preferences) {
    seedObjects.push({ id: pref.id, type: 'preference', displayName: pref.name, createdAt: t0, aliases: pref.aliases });
    edge(pref.id, `act_${pref.domain}`, 'part-of');
  }
  for (const g of p.goals) {
    seedObjects.push({ id: g.id, type: 'goal', displayName: g.title, createdAt: t0 });
    edge(g.id, `act_${g.domain}`, 'part-of');
  }
  for (const a of p.activities) {
    seedObjects.push({ id: a.id, type: 'activity', displayName: a.title, createdAt: t0, attrs: { cadence: a.cadence ?? null } });
    edge(a.id, `act_${a.domain}`, 'part-of');
  }
  for (const c of p.commitments) {
    seedObjects.push({ id: c.id, type: 'commitment', displayName: c.title, createdAt: t0, attrs: { status: c.status } });
    edge(c.id, `act_${c.domain}`, 'part-of');
  }
  for (const m of p.matters) {
    if (!m.seeded) continue;
    const when = m.when ? localISO(p.timezone, ...m.when) : undefined;
    const matter: Matter = {
      id: m.id,
      type: 'matter',
      displayName: m.title,
      createdAt: t0,
      shape: m.shape,
      typicality: m.typicality ?? 0.9,
      worldState: 'scheduled',
      worldLog: [{ state: 'scheduled', t: t0, evidence: 'seeded' }],
      systemLog: [],
      userStance: 'preparing',
      when,
      place: m.place,
      aliases: m.entities,
      attrs: m.attrs,
    };
    seedObjects.push(matter);
    edge(m.id, `act_${m.domain}`, 'part-of');
    for (const ref of m.refersTo ?? []) edge(m.id, ref, 'refers-to');
    for (const part of m.participants ?? []) edge(part.personId, m.id, 'plays-role', { role: part.role });
  }

  // Habit propositions: attributed to the object whose name/alias matches one of the habit's entities.
  const seedPropositions: Proposition[] = [];
  let hn = 0;
  for (const h of p.habits) {
    const target = seedObjects.find((o) => h.entities.some((e) => o.displayName.toLowerCase() === e.toLowerCase() || (o.aliases ?? []).some((a) => a.toLowerCase() === e.toLowerCase())));
    if (!target) continue;
    hn += 1;
    const id = `p_seed_${hn}`;
    seedPropositions.push({ id, text: h.text, conf: 0.8, kind: 'habit', source: { eventId: 'seed', source: 'manual' }, t: t0, entities: h.entities, attributedTo: target.id, relation: 'evidence-for', attributionConf: 1, status: 'attributed' });
    edge(id, target.id, 'evidence-for', { evidence: id });
  }
  const matterTemplates: MatterTemplate[] = p.matters
    .filter((m) => !m.seeded)
    .map((m) => ({ id: m.id, title: m.title, shape: m.shape, when: m.when ? localISO(p.timezone, ...m.when) : undefined, place: m.place, domain: m.domain, entities: m.entities }));

  // Events
  const events: ObservedEvent[] = [];
  const annotations: EventAnnotation[] = [];
  const byKey = new Map<string, string>();
  const personName = (id?: string) => p.people.find((x) => x.id === id)?.name;

  const pushScripted = (s: ScriptedEvent) => {
    const id = `ev_d${s.day.toString().padStart(2, '0')}_${s.key}`;
    byKey.set(s.key, id);
    const ev: ObservedEvent = { id, t: at(s.day, s.time[0], s.time[1]), source: s.source, text: s.text };
    if (s.senderId) ev.sender = personName(s.senderId);
    if (s.app) ev.app = s.app;
    if (s.meta) ev.meta = s.meta;
    events.push(ev);
    const ann: EventAnnotation = { eventId: id, cls: s.cls, propositions: s.propositions };
    if (s.about) ann.objectId = s.about;
    if (s.acceptable) ann.acceptable = s.acceptable;
    if (s.dateRef) ann.dateRef = localISO(p.timezone, ...s.dateRef);
    if (s.worldState) ann.worldState = s.worldState;
    if (s.triple) ann.triple = s.triple;
    annotations.push(ann);
  };
  for (const s of p.script) pushScripted(s);

  // Noise, generated per day from vocab. Family messages and calendar noise are "unattributed but not worthless".
  let n = 0;
  const pushNoise = (day: number, hh: number, mm: number, ev: Omit<ObservedEvent, 'id' | 't'>, ann: Omit<EventAnnotation, 'eventId'>) => {
    n += 1;
    const id = `ev_d${day.toString().padStart(2, '0')}_n${n.toString().padStart(3, '0')}`;
    events.push({ id, t: at(day, hh, mm), ...ev });
    annotations.push({ eventId: id, ...ann });
  };
  for (let day = 0; day < p.days; day++) {
    const dow = weekdayOf(at(day, 12, 0));
    const weekday = dow >= 1 && dow <= 5;
    // media: 1–2 other artists
    const plays = 1 + Math.floor(r() * 3);
    for (let i = 0; i < plays; i++) {
      const track = pick(r, p.noise.otherArtists);
      const artist = track.split(/\s[—–-]\s/)[0]!.trim();
      const pref = p.preferences.find((x) => x.name.toLowerCase() === artist.toLowerCase());
      pushNoise(
        day,
        7 + Math.floor(r() * 15),
        Math.floor(r() * 60),
        { source: 'media', app: 'Spotify', text: track },
        pref
          ? { cls: 'signal', objectId: pref.id, propositions: [{ text: `Listens to ${artist}`, conf: 0.7, entities: [artist], kind: 'habit' }] }
          : { cls: 'noise', acceptableNamed: [artist], propositions: [{ text: `Listens to ${artist}`, conf: 0.7, entities: [artist], kind: 'habit' }] },
      );
    }
    // marketing 1–2
    const promos = 1 + Math.floor(r() * 3);
    for (let i = 0; i < promos; i++) {
      const app = pick(r, p.noise.marketingApps);
      const text = pick(r, [`${app}: 20% off your next order today only`, `${app}: your receipt is ready`, `${app}: new deals near you`, `${app}: free delivery this weekend`]);
      pushNoise(day, 8 + Math.floor(r() * 13), Math.floor(r() * 60), { source: 'notification', app, text }, { cls: 'noise', propositions: [] });
    }
    // system 0–1
    if (r() < 0.6) pushNoise(day, 6 + Math.floor(r() * 16), Math.floor(r() * 60), { source: 'notification', app: 'System', text: pick(r, p.noise.systemNotifs) }, { cls: 'noise', propositions: [] });
    // calendar noise on weekdays (unattributed, not worthless)
    if (weekday && r() < 0.8) {
      const title = pick(r, p.noise.calendarNoise);
      const hh = 9 + Math.floor(r() * 8);
      pushNoise(
        day,
        7,
        0,
        { source: 'calendar', app: 'Calendar', text: title, meta: { start: `${at(day, hh, 0).slice(0, 16)}`, end: `${at(day, hh + 1, 0).slice(0, 16)}` } },
        { cls: 'noise', acceptableNamed: [title], propositions: [{ text: `Calendar: ${title}`, conf: 0.8, entities: [title], kind: 'fact' }] },
      );
    }
    // photo 0–1
    if (r() < 0.4) pushNoise(day, 11 + Math.floor(r() * 9), Math.floor(r() * 60), { source: 'photo', app: 'Photos', text: pick(r, p.noise.photoCaptions), meta: { geo: 'San Francisco' } }, { cls: 'noise', propositions: [] });
    // family message every ~3 days
    if (r() < 0.35) {
      const text = pick(r, p.noise.familyMessages);
      pushNoise(day, 9 + Math.floor(r() * 11), Math.floor(r() * 60), { source: 'message', sender: personName('p_mom'), app: 'Messages', text }, { cls: 'noise', propositions: [{ text: `Mom: ${text}`, conf: 0.7, entities: ['Mom'], kind: 'request' }] });
    }
    // work noise on weekdays 1–2
    if (weekday) {
      const k = 1 + Math.floor(r() * 2);
      for (let i = 0; i < k; i++) pushNoise(day, 9 + Math.floor(r() * 9), Math.floor(r() * 60), { source: 'notification', app: pick(r, ['Slack', 'GitHub', 'Workday', 'Docs']), text: pick(r, p.noise.workNoise) }, { cls: 'noise', propositions: [] });
    }
  }

  events.sort((a, b) => new Date(a.t).getTime() - new Date(b.t).getTime());
  const annById = new Map(annotations.map((a) => [a.eventId, a]));
  const orderedAnnotations = events.map((e) => annById.get(e.id)!);

  const expectations: DailyExpectation[] = p.dailyPlan.flatMap((dp) => {
    const date = at(dp.day, 12, 0).slice(0, 10);
    const ctxAt = (h: number) => dp.contexts.find((c) => h >= c.from && h < c.to)?.ctx ?? 'home';
    const hours = new Set<number>([...dp.shouldSurface.map((s) => s.hour), ...dp.shouldStaySilent.map((s) => s.hour)]);
    return [...hours].map((h) => ({
      date: `${date}T${h.toString().padStart(2, '0')}:00`,
      context: ctxAt(h),
      shouldSurface: dp.shouldSurface.filter((s) => s.hour === h).map(({ objectId, why }) => ({ objectId, why })),
      shouldStaySilent: dp.shouldStaySilent.filter((s) => s.hour === h).map(({ objectId, reason }) => ({ objectId, reason })),
    }));
  });

  const corrections: CorrectionScript[] = p.corrections.map((c) => ({
    key: c.key,
    eventId: byKey.get(c.eventKey) ?? c.eventKey,
    fromObjectId: c.fromMatterId,
    toObjectId: c.toMatterId,
    scope: c.scope,
    predicate: c.predicate,
    evidence: c.evidence,
  }));

  const fixture: Fixture = {
    version: 1,
    generatedAt: new Date().toISOString(),
    persona: { name: p.name, city: p.city, timezone: p.timezone, seed: p.seed },
    from: day0,
    to: at(p.days - 1, 23, 59),
    seedObjects,
    seedEdges,
    seedPropositions,
    matterTemplates,
    events,
    annotations: orderedAnnotations,
    expectations,
    corrections,
  };

  const stats: SynthStats = { total: events.length, byCls: {}, bySource: {} };
  for (const a of orderedAnnotations) stats.byCls[a.cls] = (stats.byCls[a.cls] ?? 0) + 1;
  for (const e of events) stats.bySource[e.source] = (stats.bySource[e.source] ?? 0) + 1;
  return { fixture, stats };
}

/** The skeleton matters that are not seeded, so the UI can offer "new matter" templates and eval can score creation. */
export function unseededMatters(p: PersonaSkeleton) {
  return p.matters.filter((m) => !m.seeded);
}
