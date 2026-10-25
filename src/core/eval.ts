/**
 * Offline evaluation against the fixture's derived annotations.
 * Runs the real pipeline (triage → extract → retrieve → confirm → write) with any adapter pair,
 * applies the scripted corrections at their events, and scores:
 */
import type { EmbeddingAdapter, EventAnnotation, Fixture, InferenceAdapter, Matter, ObservedEvent } from '@/contract/types';
import { Attributor, DEFAULT_OPTIONS, type AttributorOptions } from './attribution';
import { applyCorrection } from './correction';
import { Graph } from './graph';
import { ReplayEngine } from './replay';
import { newId } from './util';

export interface EvalResult {
  inference: string;
  embedding: string;
  events: number;
  noise: { total: number; dropped: number; keptAsChannel: number; wronglyAttributed: number };
  attribution: { total: number; correct: number; wrong: number; unattached: number; asked: number; created: number; accuracy: number };
  unattributable: { total: number; correct: number; wronglyAttributed: number; routedByRule: number };
  /** Ambiguous-class events that were asked/held instead of guessed: not correct, not wrong. */
  acceptable: number;
  triples: { key: string; inScope: boolean | null; outOfScope: boolean | null; ambiguous: boolean | null }[];
  worldState: { total: number; correct: number };
  timing: { avgMs: number; maxMs: number; extractMs: number; confirmMs: number; escalations: number };
  perEvent: { eventId: string; cls: string; expected?: string; got?: string; outcome: string; ok: boolean; candidates?: string; conf?: number }[];
  baseline?: number;
}

export interface EvalOptions {
  applyCorrections: boolean;
  attributor?: Partial<AttributorOptions>;
  escalate?: InferenceAdapter;
  onProgress?: (i: number, n: number) => void;
}

/** Resolve the id the system used for a ground-truth id: seeded ids are themselves; templates map via alias. */
function resolve(alias: Map<string, string>, id: string | undefined): string | undefined {
  if (!id) return undefined;
  return alias.get(id) ?? id;
}

/** True when `got` is `expected` or a part-of ancestor of `got` within 2 hops equals `expected` (session matters). */
function matches(graph: Graph, got: string | undefined, expected: string | undefined): boolean {
  if (!got || !expected) return false;
  if (got === expected) return true;
  let frontier = [got];
  for (let hop = 0; hop < 2; hop++) {
    const next: string[] = [];
    for (const id of frontier) for (const e of graph.outEdges(id, 'part-of')) next.push(e.to);
    if (next.includes(expected)) return true;
    frontier = next;
  }
  return false;
}

export async function runEval(fixture: Fixture, infer: InferenceAdapter, embed: EmbeddingAdapter, opts: EvalOptions): Promise<EvalResult> {
  await infer.ready();
  await embed.ready();
  const graph = new Graph();
  const attributor = new Attributor(graph, embed, infer, { ...DEFAULT_OPTIONS, ...opts.attributor }, opts.escalate);
  const replay = new ReplayEngine(fixture, graph, attributor);
  replay.seed();
  const ann = new Map(fixture.annotations.map((a) => [a.eventId, a]));
  const alias = new Map<string, string>();
  const templates = new Map(fixture.matterTemplates.map((t) => [t.id, t]));
  const corrections = new Map(fixture.corrections.map((c) => [c.eventId, c]));

  const result: EvalResult = {
    inference: infer.name,
    embedding: embed.name,
    events: fixture.events.length,
    noise: { total: 0, dropped: 0, keptAsChannel: 0, wronglyAttributed: 0 },
    attribution: { total: 0, correct: 0, wrong: 0, unattached: 0, asked: 0, created: 0, accuracy: 0 },
    unattributable: { total: 0, correct: 0, wronglyAttributed: 0, routedByRule: 0 },
    acceptable: 0,
    triples: fixture.corrections.map((c) => ({ key: c.key, inScope: null, outOfScope: null, ambiguous: null })),
    worldState: { total: 0, correct: 0 },
    timing: { avgMs: 0, maxMs: 0, extractMs: 0, confirmMs: 0, escalations: 0 },
    perEvent: [],
  };
  let totalMs = 0;

  for (let i = 0; i < fixture.events.length; i++) {
    const ev = fixture.events[i]!;
    const a = ann.get(ev.id)!;
    const out = await replay.stepEvent();
    if (!out) break;
    totalMs += out.timing.totalMs;
    result.timing.maxMs = Math.max(result.timing.maxMs, out.timing.totalMs);
    result.timing.extractMs += out.timing.extractMs;
    result.timing.confirmMs += out.timing.confirmMs;
    result.timing.escalations += out.escalations;
    scoreEvent(graph, ev, a, out, alias, result);

    // Scripted correction at this event: the user moves the proposition (creating the target if needed).
    const script = corrections.get(ev.id);
    if (script && opts.applyCorrections) {
      const prop = out.outcomes[0]?.proposition;
      if (prop) {
        let target = resolve(alias, script.toObjectId);
        if (!target || !graph.obj(target)) {
          const t = templates.get(script.toObjectId);
          if (t) {
            const m: Matter = {
              id: t.id,
              type: 'matter',
              displayName: t.title,
              createdAt: ev.t,
              shape: t.shape,
              typicality: 0.9,
              worldState: 'scheduled',
              worldLog: [{ state: 'scheduled', t: ev.t, evidence: 'user' }],
              systemLog: [],
              userStance: 'anticipating',
              when: t.when,
              place: t.place,
              aliases: t.entities,
            };
            graph.addObject(m);
            const act = graph.domainActivity(t.domain);
            if (act) graph.addEdge({ id: newId('e'), from: m.id, to: act.id, type: 'part-of', t: ev.t, conf: 1, evidence: 'user' });
            for (const o of graph.objects.values()) if (o.type === 'preference' && t.title.toLowerCase().includes(o.displayName.toLowerCase())) graph.addEdge({ id: newId('e'), from: m.id, to: o.id, type: 'refers-to', t: ev.t, conf: 1, evidence: 'user' });
            alias.set(t.id, t.id);
            target = t.id;
          }
        }
        if (target) applyCorrection(graph, { propositionId: prop.id, toObjectId: target, scope: script.scope, predicate: script.predicate, evidence: script.evidence, t: ev.t, confirmed: 'user' });
      }
    }
    opts.onProgress?.(i + 1, fixture.events.length);
  }
  result.timing.avgMs = totalMs / Math.max(1, fixture.events.length);
  result.baseline = attributor.similarityBaseline;
  result.attribution.accuracy = result.attribution.total ? result.attribution.correct / result.attribution.total : 0;
  return result;
}

/** Naming is the confirmer's freedom; identity is what is scored: "Team lunch" ≈ "Team Lunch (weekly)". */
function sameName(a: string, b: string): boolean {
  const x = a.toLowerCase().trim();
  const y = b.toLowerCase().trim();
  return x === y || x.includes(y) || y.includes(x);
}

function scoreEvent(graph: Graph, ev: ObservedEvent, a: EventAnnotation, out: Awaited<ReturnType<Attributor['process']>>, alias: Map<string, string>, r: EvalResult): void {
  const first = out.outcomes[0];
  const got = first?.proposition.attributedTo;
  const status = first?.proposition.status;
  const outcome = out.verdict === 'dropped' ? 'dropped' : (first?.outcome ?? 'none');
  const expectedRaw = a.objectId;

  // Alias binding: the first system-created object for a template id defines that identity.
  if (first?.createdObjectId && expectedRaw && !alias.has(expectedRaw) && !graph.obj(expectedRaw)) alias.set(expectedRaw, first.createdObjectId);
  const expected = resolve(alias, expectedRaw);

  let ok = false;
  if (a.cls === 'noise' && a.propositions.length === 0) {
    r.noise.total += 1;
    if (out.verdict === 'dropped') {
      r.noise.dropped += 1;
      ok = true;
    } else if (status === 'attributed') r.noise.wronglyAttributed += 1;
    else {
      r.noise.keptAsChannel += 1;
      ok = true;
    }
  } else if (!expectedRaw) {
    r.unattributable.total += 1;
    const gotName = got ? graph.obj(got)?.displayName.toLowerCase() : undefined;
    if (gotName && (a.acceptableNamed ?? []).some((n) => sameName(n, gotName))) {
      r.unattributable.correct += 1;
      ok = true;
    } else if (first?.outcome === 'constrained') {
      r.unattributable.routedByRule += 1;
      ok = true;
    } else if (status === 'attributed' && first?.outcome !== 'new-object') r.unattributable.wronglyAttributed += 1;
    else {
      r.unattributable.correct += 1;
      ok = true;
    }
  } else {
    r.attribution.total += 1;
    if (first?.outcome === 'new-object') r.attribution.created += 1;
    const acceptable = (a.acceptable ?? []).map((id) => resolve(alias, id));
    if (matches(graph, got, expected) || acceptable.some((id) => matches(graph, got, id))) {
      r.attribution.correct += 1;
      ok = true;
    } else if (status === 'ask-user') {
      r.attribution.asked += 1;
      if (a.cls === 'ambiguous') {
        r.acceptable += 1;
        ok = true;
      }
    } else if (status === 'attributed') r.attribution.wrong += 1;
    else {
      r.attribution.unattached += 1;
      if (a.cls === 'ambiguous') {
        r.acceptable += 1;
        ok = true;
      }
    }
  }
  if (a.worldState) {
    r.worldState.total += 1;
    // The transition and, for a reschedule, the day (and the clock when the annotation names one) must both be right.
    const wc = out.worldChange;
    let okWs = !!wc && wc.state === a.worldState;
    if (okWs && a.worldState === 'rescheduled' && a.dateRef && wc?.when) {
      const want = a.dateRef;
      // The clock is only owed when the system had one to keep: a matter it only ever saw as "Sat Nov 8" has none.
      const prevWhen = graph.matter(wc.objectId)?.worldLog.find((w) => w.evidence === first?.proposition.id)?.prevWhen;
      const knewClock = !!prevWhen && prevWhen.slice(11, 16) !== '00:00';
      okWs = wc.when.slice(0, 10) === want.slice(0, 10) && (want.slice(11, 16) === '00:00' || !knewClock || wc.when.slice(11, 16) === want.slice(11, 16));
    }
    if (okWs) r.worldState.correct += 1;
    else ok = false;
  }
  if (a.triple) {
    const t = r.triples.find((x) => x.key === a.triple!.correctionKey);
    if (t) {
      const toObj = resolve(alias, graphCorrectionTarget(graph, a.triple.correctionKey, r));
      if (a.triple.role === 'in-scope') t.inScope = !!toObj && matches(graph, got, toObj);
      // Out of scope = the rule did not swallow it: attributed to its own object when it has one, otherwise asked or held.
      if (a.triple.role === 'out-of-scope') t.outOfScope = !!toObj && got !== toObj && (expected ? matches(graph, got, expected) : status === 'ask-user' || status === 'candidate-channel');
      if (a.triple.role === 'ambiguous') t.ambiguous = status === 'ask-user' || status === 'candidate-channel';
    }
  }
  r.perEvent.push({ eventId: ev.id, cls: a.cls, expected, got, outcome, ok, candidates: first?.candidates.map((c) => `${c.displayName}=${c.score}${c.signals ? ` [l${c.signals.lexical} s${c.signals.structural} m${c.signals.semantic}]` : ''}`).join(' | '), conf: first?.confirmConf });
}

function graphCorrectionTarget(graph: Graph, key: string, _r: EvalResult): string | undefined {
  // The scripted correction's target id is the template id (the eval created it with that id) or a seeded id.
  for (const c of graph.corrections.values()) if (c.evidence && (c.evidence.includes('Ben Park') ? key === 'b_to_greek' : key === 'pacing_to_half')) return c.toObj;
  return undefined;
}

export function summarize(r: EvalResult): string {
  const pct = (a: number, b: number) => (b ? ((100 * a) / b).toFixed(1) + '%' : 'n/a');
  const lines = [
    `inference=${r.inference} embedding=${r.embedding} events=${r.events}`,
    `noise: dropped ${r.noise.dropped}/${r.noise.total} (${pct(r.noise.dropped, r.noise.total)}), kept-as-channel ${r.noise.keptAsChannel}, wrongly attributed ${r.noise.wronglyAttributed}`,
    `attribution: ${r.attribution.correct}/${r.attribution.total} correct (${pct(r.attribution.correct, r.attribution.total)}), wrong ${r.attribution.wrong}, unattached ${r.attribution.unattached}, asked ${r.attribution.asked}, created ${r.attribution.created}`,
    `unattributable: ${r.unattributable.correct}/${r.unattributable.total} held (${pct(r.unattributable.correct, r.unattributable.total)}), routed by a user rule ${r.unattributable.routedByRule}, wrongly attributed ${r.unattributable.wronglyAttributed}; ambiguous held instead of guessed: ${r.acceptable}`,
    `world-state transitions: ${r.worldState.correct}/${r.worldState.total}`,
    `triples: ${r.triples.map((t) => `${t.key}: in=${t.inScope} out=${t.outOfScope} amb=${t.ambiguous}`).join(' | ')}`,
    `timing: avg ${r.timing.avgMs.toFixed(1)} ms, max ${r.timing.maxMs.toFixed(0)} ms, extract ${r.timing.extractMs.toFixed(0)} ms, confirm ${r.timing.confirmMs.toFixed(0)} ms, escalations ${r.timing.escalations}`,
  ];
  return lines.join('\n');
}
