/**
 * Attribution pipeline:
 * event → triage (rules) → extract (adapter) → retrieve candidates (embedding + entity overlap, ≤3)
 * → applicable corrections (graph query over applies-to edges)
 */
import type {
  ApplicableConstraint,
  CandidateObject,
  EmbeddingAdapter,
  ExtractedProposition,
  GraphObject,
  ISODate,
  InferenceAdapter,
  Matter,
  ObservedEvent,
  Proposition,
  RelationType,
  WorldState,
} from '@/contract/types';
import type { Graph } from './graph';
import { applicableConstraints, ensureRole } from './correction';
import { cadenceClock, cadenceMatches, clockIsAmbiguous, detectWorldState, namesADay, resolveDateRef, structuredExtract, triage } from './triage';
import { clamp, cosine, daysBetween, fmtDate, newId, tokens } from './util';

const STOP_TOKENS = new Set(['with', 'from', 'this', 'that', 'your', 'about', 'have', 'will', 'been', 'into', 'over', 'then', 'than', 'they', 'them', 'what', 'when', 'where', 'which', 'there', 'here', 'just', 'some', 'more', 'team', 'meeting']);

export interface AttributorOptions {
  candidateThreshold: number;
  maxCandidates: number;
  lowConf: number;
  ambiguityGap: number;
}

export const DEFAULT_OPTIONS: AttributorOptions = { candidateThreshold: 0.28, maxCandidates: 3, lowConf: 0.45, ambiguityGap: 0.07 };

export type PropositionOutcomeKind = 'attributed' | 'new-object' | 'candidate-channel' | 'ask-user' | 'constrained' | 'conflict';

export interface PropositionOutcome {
  proposition: Proposition;
  outcome: PropositionOutcomeKind;
  candidates: CandidateObject[];
  constraints: ApplicableConstraint[];
  createdObjectId?: string;
  escalated?: boolean;
  confirmConf?: number;
}

export interface ProcessOutcome {
  eventId: string;
  t: ISODate;
  verdict: 'dropped' | 'processed';
  outcomes: PropositionOutcome[];
  worldChange?: { objectId: string; state: WorldState; when?: ISODate };
  timing: { triageMs: number; extractMs: number; retrieveMs: number; confirmMs: number; totalMs: number };
  escalations: number;
  /** Structured records are mapped in core; only language reaches the inference adapter. */
  extractor?: 'structured' | 'adapter';
  /** Which adapters produced this outcome (provenance for the panel and for snapshots). */
  inference?: string;
  embedding?: string;
}

interface DocCache {
  summary: string;
  vec: Float32Array;
}

/** Generic, persona-free sentences used to measure an embedding's baseline similarity between unrelated texts. */
const CALIBRATION_TEXTS = [
  'The meeting moved to noon.',
  'Battery is at twenty percent.',
  'A new album came out on Friday.',
  'Remember to buy milk and eggs.',
  'The train is delayed by ten minutes.',
  'Dinner at seven with the neighbours.',
  'Your package has been delivered.',
  'Long run on Saturday morning.',
  'The dentist appointment is next Tuesday.',
  'Tickets go on sale tomorrow at ten.',
  'Can you review the document today?',
  'The weather will be foggy this afternoon.',
];

export class Attributor {
  private cache = new Map<string, DocCache>();
  /** Mean and spread of cosine between unrelated sentences for the current embedding; similarity is rescaled in sigmas above the mean. */
  private baseline?: number;
  private spread = 0.05;
  readonly log: ProcessOutcome[] = [];
  constructor(
    readonly graph: Graph,
    private embed: EmbeddingAdapter,
    private infer: InferenceAdapter,
    private opts: AttributorOptions = DEFAULT_OPTIONS,
    private escalate?: InferenceAdapter,
  ) {}

  setInference(a: InferenceAdapter): void {
    this.infer = a;
  }
  setEmbedding(a: EmbeddingAdapter): void {
    this.embed = a;
    this.cache.clear();
    this.baseline = undefined;
  }
  /** Called when the embedding adapter throws at runtime and the lexical fallback takes over. */
  onEmbeddingFallback?: (error: string) => void;
  private async embedSafe(texts: string[], mode: 'query' | 'document'): Promise<Float32Array[]> {
    try {
      return await this.embed.embed(texts, mode);
    } catch (e) {
      if (this.embed.name !== 'hashed-lexical') {
        const { HashedEmbedding } = await import('@/adapters/embedding/hashed');
        this.onEmbeddingFallback?.(String(e).slice(0, 200));
        this.setEmbedding(new HashedEmbedding());
        return this.embed.embed(texts, mode);
      }
      throw e;
    }
  }

  /** Each embedding has its own floor (shared prefixes inflate cosine); measure it once and rescale. */
  async calibrate(): Promise<number> {
    if (this.baseline !== undefined) return this.baseline;
    const vecs = await this.embedSafe(CALIBRATION_TEXTS, 'document');
    let sum = 0;
    let n = 0;
    for (let i = 0; i < vecs.length; i++)
      for (let j = i + 1; j < vecs.length; j++) {
        sum += cosine(vecs[i]!, vecs[j]!);
        n += 1;
      }
    const mean = n ? sum / n : 0;
    let varSum = 0;
    for (let i = 0; i < vecs.length; i++) for (let j = i + 1; j < vecs.length; j++) varSum += (cosine(vecs[i]!, vecs[j]!) - mean) ** 2;
    this.spread = Math.max(0.03, n ? Math.sqrt(varSum / n) : 0.05);
    this.baseline = clamp(mean, 0, 0.95);
    return this.baseline;
  }
  get similaritySpread(): number {
    return this.spread;
  }
  get similarityBaseline(): number | undefined {
    return this.baseline;
  }
  setEscalation(a?: InferenceAdapter): void {
    this.escalate = a;
  }
  get adapters(): { infer: InferenceAdapter; embed: EmbeddingAdapter; escalate?: InferenceAdapter } {
    return { infer: this.infer, embed: this.embed, escalate: this.escalate };
  }

  /** Names and aliases of everything on the graph: the extractor's known-entity list. */
  knownEntities(): string[] {
    const s = new Set<string>();
    for (const o of this.graph.objects.values()) {
      if (o.type === 'activity' && o.domain) continue; // generic domain names are not entities
      s.add(o.displayName);
      for (const a of o.aliases ?? []) s.add(a);
      if ((o as Matter).place) s.add((o as Matter).place!);
    }
    return [...s];
  }

  // -------------------------------------------------------------------------
  // retrieval
  // -------------------------------------------------------------------------
  private candidatePool(): (GraphObject | Matter)[] {
    const pool: (GraphObject | Matter)[] = [];
    for (const o of this.graph.objects.values()) {
      if (o.type === 'person') continue;
      if (o.type === 'activity' && o.domain) continue; // domains are views, not attribution targets
      pool.push(o);
    }
    return pool;
  }

  /** Entity vocabulary of an object: name, aliases, place, people, entities of attached propositions. */
  private objectEntities(o: GraphObject | Matter): string[] {
    const s = new Set<string>();
    s.add(o.displayName);
    for (const a of o.aliases ?? []) s.add(a);
    if ((o as Matter).place) s.add((o as Matter).place!);
    for (const { person } of this.graph.peopleOf(o.id)) s.add(person.displayName);
    for (const p of this.graph.activePropositionsOf(o.id)) for (const e of p.entities) s.add(e);
    return [...s];
  }

  private summaryOf(o: GraphObject | Matter): string {
    const parts: string[] = [o.displayName, o.type];
    if (o.aliases?.length) parts.push(o.aliases.join(', '));
    const m = o as Matter;
    if (m.place) parts.push(m.place);
    if (m.when) parts.push(fmtDate(m.when));
    const people = this.graph.peopleOf(o.id).map((x) => x.person.displayName);
    if (people.length) parts.push(people.join(', '));
    const props = this.graph.activePropositionsOf(o.id).slice(-6).map((p) => p.text);
    parts.push(...props);
    return parts.join('. ');
  }

  private async docVector(o: GraphObject | Matter): Promise<Float32Array> {
    const summary = this.summaryOf(o);
    const hit = this.cache.get(o.id);
    if (hit && hit.summary === summary) return hit.vec;
    const [vec] = await this.embedSafe([summary], 'document');
    this.cache.set(o.id, { summary, vec: vec! });
    return vec!;
  }

  async retrieve(prop: { text: string; entities: string[]; sender?: string; dateRef?: ISODate; source: ObservedEvent['source']; t?: ISODate }): Promise<CandidateObject[]> {
    const pool = this.candidatePool();
    if (pool.length === 0) return [];
    await this.calibrate();
    // The sender's name is structure (a role), not content: embedding it would make every message from one person
    // look like that person's earlier messages, whatever they are about.
    const [q] = await this.embedSafe([stripSender(prop.text, prop.sender)], 'query');
    const sender = prop.sender ? this.graph.personByName(prop.sender) : undefined;
    const roleTargets = new Set(sender ? this.graph.outEdges(sender.id, 'plays-role').map((e) => e.to) : []);
    // Distinctive evidence: a word grounds a candidate only if few objects carry it in their evidence (document
    // frequency over the pool), so boilerplate shared by many propositions ("calendar", "person") never looks like a match.
    const evidenceSets = new Map<string, Set<string>>();
    const df = new Map<string, number>();
    for (const o of pool) {
      const set = new Set(this.graph.activePropositionsOf(o.id).flatMap((x) => tokens(x.text)).filter((w) => w.length >= 6 && !STOP_TOKENS.has(w)));
      evidenceSets.set(o.id, set);
      for (const w of set) df.set(w, (df.get(w) ?? 0) + 1);
    }
    const maxDf = Math.max(2, Math.floor(pool.length * 0.15));
    // Query-adaptive normalization: how many sigmas a document sits above this query's mean over the whole pool.
    // Makes scores comparable across embeddings and text registers; saturates at 3σ.
    const raws = new Map<string, number>();
    for (const o of pool) raws.set(o.id, cosine(q!, await this.docVector(o)));
    const vals = [...raws.values()];
    const mean = vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length);
    const std = Math.max(0.02, Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, vals.length)));
    const scored: CandidateObject[] = [];
    for (const o of pool) {
      const raw = raws.get(o.id)!;
      const cos = pool.length >= 4 ? clamp((raw - mean) / (3 * std)) : clamp((raw - this.baseline!) / (3 * this.spread));
      const vocab = this.objectEntities(o).map((x) => x.toLowerCase());
      const peopleNames = new Set(this.graph.peopleOf(o.id).map((x) => x.person.displayName.toLowerCase()));
      let hits = 0;
      for (const e of prop.entities) {
        const el = e.toLowerCase();
        if (el === (prop.sender ?? '').toLowerCase()) continue;
        const exact = el === o.displayName.toLowerCase() || (o.aliases ?? []).some((a) => a.toLowerCase() === el);
        const whole = exact || vocab.some((v) => v === el || (el.length >= 4 && v.includes(el)) || (v.length >= 4 && el.includes(v)));
        if (whole) {
          // A person's name is weaker evidence than a thing or place: people are shared across matters.
          // An exact hit on the object's own name is the strongest lexical evidence there is.
          const isPerson = peopleNames.has(el) || [...peopleNames].some((n) => n.includes(el) || el.includes(n));
          hits += isPerson ? 0.5 : exact ? 2 : 1;
        } else if (tokens(el).some((w) => w.length >= 4 && !STOP_TOKENS.has(w) && vocab.some((v) => tokens(v).includes(w)))) hits += 0.5;
      }
      const ents = prop.entities.filter((e) => e.toLowerCase() !== (prop.sender ?? '').toLowerCase());
      const overlap = ents.length ? clamp(hits / ents.length) : 0;
      // Name-identified objects (preferences) require an entity hit: "Listens to X" is never evidence for Y.
      if (o.type === 'preference' && overlap === 0) continue;
      let hitsNonPerson = 0;
      const vocabTokens = new Set(vocab.flatMap((v) => tokens(v)).filter((w) => w.length >= 4 && !STOP_TOKENS.has(w)));
      for (const e of ents) {
        const el = e.toLowerCase();
        const isPerson = peopleNames.has(el) || [...peopleNames].some((n) => n.includes(el) || el.includes(n));
        if (isPerson) continue;
        const whole = vocab.some((v) => v === el || (el.length >= 4 && v.includes(el)) || (v.length >= 4 && el.includes(v)));
        // Token-level match: "locker 21" ↔ "Pick up package from office locker". Content words only.
        const partial = !whole && tokens(el).some((w) => w.length >= 4 && !STOP_TOKENS.has(w) && vocabTokens.has(w));
        if (whole) hitsNonPerson += 1;
        else if (partial) hitsNonPerson += 0.5;
      }
      // Lexical evidence can also come from the object's own name: content words of the name present in the text
      // ("package", "locker" for "Pick up package from office locker"). Names are short, so this is precise.
      const nameTokens = [...new Set([o.displayName, ...(o.aliases ?? [])].flatMap((x) => tokens(x)).filter((w) => w.length >= 4 && !STOP_TOKENS.has(w)))];
      const textTokens = new Set(tokens(prop.text));
      const nameMatches = nameTokens.filter((w) => textTokens.has(w));
      // One short common word ("bring") is not evidence; two name words, or one long specific word, is.
      const nameHit = nameMatches.length >= 2 || nameMatches.some((w) => w.length >= 6);
      // A qualifying hit on the object's own name is at least half-strength evidence, however long the name is
      // ("marathon" for "Finish the November half marathon").
      const nameOverlap = nameHit && nameTokens.length ? Math.max(0.5, nameMatches.length / nameTokens.length) : 0;
      // Grounding in the object's own evidence: distinctive words shared with its attached propositions
      // ("tickets" in Ben's message ↔ "Tickets on sale" already attached to the Fillmore show).
      const evidenceTokens = evidenceSets.get(o.id) ?? new Set<string>();
      const senderTokens = tokens(prop.sender ?? '');
      const sharedEvidence = [...textTokens].filter((w) => w.length >= 6 && !STOP_TOKENS.has(w) && evidenceTokens.has(w) && (df.get(w) ?? 0) <= maxDf && !senderTokens.includes(w));
      const evidenceOverlap = sharedEvidence.length >= 2 ? 0.5 : sharedEvidence.length === 1 ? 0.3 : 0;
      const lexical = Math.max(ents.length ? clamp(hitsNonPerson / ents.length) : 0, nameOverlap, evidenceOverlap);
      let structural = 0;
      let facets = 0; // independent structural signals: role, domain, time, modality
      let score = 0.55 * clamp(cos) + 0.45 * Math.max(overlap, nameOverlap * 0.8, evidenceOverlap * 0.6);
      if (sender) {
        // A role held in an activity covers its sessions: the coach of the class is the coach of every Tuesday.
        const viaActivity = (o as Matter).type === 'matter' && this.graph.outEdges(o.id, 'part-of').some((e) => roleTargets.has(e.to) && this.graph.obj(e.to)?.type === 'activity');
        if (roleTargets.has(o.id) || viaActivity) {
          score += 0.15;
          structural += 0.15;
          facets += 1;
        } else {
          // People cluster by domain: a sender who plays a role in this object's domain is a weak prior.
          const dom = this.graph.domainOf(o.id);
          if (dom && [...roleTargets].some((id) => this.graph.domainOf(id) === dom)) {
            score += 0.08;
            structural += 0.08;
            facets += 1;
          }
        }
      }
      // A recurring activity has a clock of its own: a dated proposition on one of its days is time evidence, as a
      // matter's date is. A calendar entry must also match the hour — its own start says nothing about other things that day.
      if (prop.dateRef && o.type === 'activity' && typeof o.attrs?.cadence === 'string' && cadenceMatches(o.attrs.cadence, prop.dateRef, prop.source === 'calendar')) {
        score += 0.2;
        structural += 0.2;
        facets += 1;
      }
      // Source modality implies a domain: listening → music, workouts → fitness.
      const odom = this.graph.domainOf(o.id);
      if (prop.source === 'workout' && odom === 'fitness' && (o.type === 'goal' || o.type === 'activity')) {
        score += 0.2;
        structural += 0.2;
        facets += 1;
      }
      const m = o as Matter;
      // Time proximity is evidence when the text *refers* to a time (messages, notices); a calendar entry's own
      // start time says nothing about other things that day.
      if (prop.dateRef && m.type === 'matter' && m.when && prop.source !== 'calendar') {
        const dd = Math.abs(daysBetween(prop.dateRef, m.when));
        if (dd <= 1) {
          score += 0.2;
          structural += 0.2;
          facets += 1;
        } else if (dd <= 3) {
          score += 0.05;
          structural += 0.05;
          facets += 1;
        } else if (dd > 7) score -= 0.1;
      }
      if (prop.source === 'media' && o.type === 'preference') {
        score += 0.1;
        structural += 0.1;
        facets += 1;
      }
      // Messages talk about events, tasks and people; tastes are evidenced by behaviour, not by chat.
      if (prop.source === 'message' && o.type === 'preference') score -= 0.3;
      if (m.type === 'matter' && (m.worldState === 'past' || m.worldState === 'cancelled')) score -= 0.15;
      // A dated matter more than a day in the past is effectively over, whatever its recorded state.
      if (m.type === 'matter' && m.when && daysBetween(m.when, prop.t ?? m.when) > 1) score -= 0.15;
      scored.push({ objectId: o.id, type: o.type, displayName: o.displayName, summary: this.summaryOf(o).slice(0, 240), score: Number(score.toFixed(3)), when: m.type === 'matter' ? m.when : undefined, signals: { lexical: Number(lexical.toFixed(2)), structural: Number(structural.toFixed(2)), semantic: Number(clamp(cos).toFixed(2)), facets } });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.filter((c) => c.score >= this.opts.candidateThreshold).slice(0, this.opts.maxCandidates);
  }

  // -------------------------------------------------------------------------
  // processing
  // -------------------------------------------------------------------------
  async process(ev: ObservedEvent): Promise<ProcessOutcome> {
    const t0 = performance.now();
    const outcome: ProcessOutcome = {
      eventId: ev.id,
      t: ev.t,
      verdict: 'processed',
      outcomes: [],
      timing: { triageMs: 0, extractMs: 0, retrieveMs: 0, confirmMs: 0, totalMs: 0 },
      escalations: 0,
      inference: this.infer.name,
      embedding: this.embed.name,
    };
    if (triage(ev) === 'drop') {
      outcome.verdict = 'dropped';
      outcome.timing.triageMs = performance.now() - t0;
      outcome.timing.totalMs = outcome.timing.triageMs;
      this.push(outcome);
      return outcome;
    }
    outcome.timing.triageMs = performance.now() - t0;

    const t1 = performance.now();
    // Structured records (media, workout, calendar) map to propositions deterministically; only language goes to the model.
    const known = this.knownEntities();
    const structured = structuredExtract(ev, known);
    outcome.extractor = structured ? 'structured' : 'adapter';
    const ex = structured ?? (await this.infer.extract({ event: ev, knownEntities: known, today: ev.t }));
    outcome.timing.extractMs = performance.now() - t1;
    if (ex.verdict === 'drop' || ex.propositions.length === 0) {
      outcome.verdict = 'dropped';
      outcome.timing.totalMs = performance.now() - t0;
      this.push(outcome);
      return outcome;
    }
    const dateRef = ex.dateRef ?? (ev.text ? resolveDateRef(ev.text, ev.t) : undefined) ?? metaStart(ev);
    const worldState = ex.worldState ?? (ev.text ? detectWorldState(ev.text) : undefined);

    for (const xp of ex.propositions) {
      const prop: Proposition = {
        id: newId('p'),
        text: xp.text,
        conf: clamp(xp.conf),
        kind: xp.kind,
        source: { eventId: ev.id, source: ev.source, sender: ev.sender, app: ev.app },
        t: ev.t,
        entities: xp.entities,
        dateRef,
        status: 'pending',
      };
      const r = await this.attribute(prop, xp, outcome, ev.text ?? '');
      outcome.outcomes.push(r);
      // attribute() may have re-read an ambiguous clock against the graph: use the proposition's final date.
      const when = r.proposition.dateRef ?? dateRef;
      if (worldState && r.proposition.attributedTo) {
        let targetId = r.proposition.attributedTo;
        const tgt = this.graph.obj(targetId);
        if (tgt?.type === 'activity' && when) {
          const day = when.slice(0, 10);
          const session = this.graph.inEdges(tgt.id, 'part-of').map((e) => this.graph.matter(e.from)).find((m) => m?.when && m.when.slice(0, 10) === day);
          if (session) targetId = session.id;
        }
        const change = this.applyWorldState(targetId, worldState, prop, when);
        if (change) outcome.worldChange = change;
      }
    }
    this.promoteCandidates(ev.t);
    outcome.timing.totalMs = performance.now() - t0;
    this.push(outcome);
    return outcome;
  }

  private push(o: ProcessOutcome): void {
    this.log.push(o);
    if (this.log.length > 500) this.log.shift();
  }

  private async attribute(prop: Proposition, xp: ExtractedProposition, outcome: ProcessOutcome, sourceText = ''): Promise<PropositionOutcome> {
    const g = this.graph;
    const tr = performance.now();
    let candidates = await this.retrieve({ text: prop.text, entities: prop.entities, sender: prop.source.sender, dateRef: prop.dateRef, source: prop.source.source, t: prop.t });
    // A clock with no am/pm ("7:30") is read on the 12-hour face of the thing it is about: when a candidate's own
    // schedule (a class at 19:00, a show at 20:00) sits on the other half of the day, re-resolve and retrieve again.
    if (prop.dateRef && prop.source.source !== 'calendar' && clockIsAmbiguous(sourceText || prop.text)) {
      const hour = Number(prop.dateRef.slice(11, 13));
      const other = (hour + 12) % 24;
      const flip = candidates.some((c) => {
        const h = this.scheduledHour(c.objectId);
        return h !== undefined && Math.abs(h - hour) > 1 && Math.abs(h - other) <= 1;
      });
      if (flip) {
        const re = resolveDateRef(sourceText || prop.text, prop.t, { prefer: hour < 12 ? 'pm' : 'am' });
        if (re && re !== prop.dateRef) {
          prop.dateRef = re;
          candidates = await this.retrieve({ text: prop.text, entities: prop.entities, sender: prop.source.sender, dateRef: prop.dateRef, source: prop.source.source, t: prop.t });
        }
      }
    }
    const lookup = applicableConstraints(g, { sender: prop.source.sender, source: prop.source.source, entities: prop.entities, t: prop.t, text: prop.text });
    outcome.timing.retrieveMs += performance.now() - tr;
    prop.candidates = candidates.map((c) => ({ objectId: c.objectId, score: c.score }));

    // Conflicting constraints: never guess.
    if (lookup.conflict) {
      g.upsertProposition({ ...prop, status: 'ask-user' });
      return { proposition: g.propositions.get(prop.id)!, outcome: 'conflict', candidates, constraints: lookup.constraints };
    }
    // Hard constraint (relation / rule scope) bypasses similarity competition — but a routing rule names a person,
    // not a topic. It yields when the message's own content points elsewhere: words that clearly hit another object,
    // or a named day that is not the target's day. Then the rule's target is offered on an ask-card, not imposed.
    const hard = lookup.constraints.find((c) => c.scope !== 'instance');
    const hardTarget = hard ? g.obj(hard.toObj) : undefined;
    if (hard && hardTarget) {
      const targetLex = candidates.find((c) => c.objectId === hard.toObj)?.signals?.lexical ?? 0;
      const elsewhere = candidates.find((c) => c.objectId !== hard.toObj && (c.signals?.lexical ?? 0) >= 0.5 && (c.signals?.lexical ?? 0) > targetLex + 0.2);
      const targetWhen = (hardTarget as Matter).type === 'matter' ? (hardTarget as Matter).when : undefined;
      const otherDay = hard.scope === 'relation' && !!prop.dateRef && !!targetWhen && namesADay(sourceText || prop.text) && Math.abs(daysBetween(prop.dateRef, targetWhen)) > 1;
      if (!elsewhere && !otherDay) {
        const relation: RelationType = prop.source.source === 'message' ? 'refers-to' : 'evidence-for';
        this.attach(prop, hard.toObj, relation, 0.95, hard.correctionId);
        return { proposition: g.propositions.get(prop.id)!, outcome: 'constrained', candidates, constraints: lookup.constraints };
      }
      if (!candidates.some((c) => c.objectId === hard.toObj)) {
        candidates = [{ objectId: hard.toObj, type: hardTarget.type, displayName: hardTarget.displayName, summary: '', score: 0.5, when: targetWhen, signals: { lexical: 0, structural: 0.5, semantic: 0, facets: 1 } }, ...candidates];
        prop.candidates = candidates.map((c) => ({ objectId: c.objectId, score: c.score }));
      }
      g.upsertProposition({ ...prop, status: 'ask-user' });
      return { proposition: g.propositions.get(prop.id)!, outcome: 'ask-user', candidates, constraints: lookup.constraints };
    }

    const tc = performance.now();
    const req = {
      proposition: { ...xp, t: prop.t, sender: prop.source.sender, source: prop.source.source },
      candidates,
      constraints: lookup.constraints,
      today: prop.t,
    };
    let res = await this.infer.confirm(req);
    let escalated = false;
    if (res.conf < this.opts.lowConf && this.escalate) {
      try {
        const up = await this.escalate.confirm(req);
        if (up.conf > res.conf) res = up;
        escalated = true;
        outcome.escalations += 1;
      } catch {
        /* escalation failed: fall through to asking the user */
      }
    }
    outcome.timing.confirmMs += performance.now() - tc;
    // An unknown sender (no person on the graph, or one we only know as a number) carries no context: ask more readily.
    const senderObj = prop.source.sender ? g.personByName(prop.source.sender) : undefined;
    const unknownSender = !!prop.source.sender && (!senderObj || senderObj.attrs?.role === 'unknown');
    // Evidence ceiling, enforced for every confirmer: how far the retrieval evidence lets a pick go, whatever the
    // confirmer's own confidence says. Below "attach" the confidence is capped under the threshold: ask or hold.
    const picked = res.objectId !== 'new' && res.objectId !== 'none' ? candidates.find((c) => c.objectId === res.objectId) : undefined;
    if (picked?.signals && evidenceLevel(prop.source.source, unknownSender, picked.signals) !== 'attach' && res.conf >= this.opts.lowConf) {
      res = { ...res, conf: Number((this.opts.lowConf - 0.01).toFixed(2)) };
    }

    let relation: RelationType = res.relation ?? (prop.source.source === 'message' ? 'refers-to' : 'evidence-for');
    // Ontology, enforced in code for every confirmer: a message/announcement/calendar item about a specific future
    // date is a matter. If the confirmer attached it to a name-identified object (a preference, an activity) and no
    // candidate matter sits on that date, the right answer is a new matter that refers to that object.
    if (prop.dateRef && (prop.source.source === 'message' || prop.source.source === 'world' || prop.source.source === 'calendar') && prop.dateRef.slice(0, 10) > prop.t.slice(0, 10)) {
      const chosen = res.objectId !== 'new' && res.objectId !== 'none' ? g.obj(res.objectId) : undefined;
      const sameDate = candidates.find((c) => c.type === 'matter' && c.when && Math.abs(new Date(c.when).getTime() - new Date(prop.dateRef!).getTime()) < 36 * 3600 * 1000);
      const ents = prop.entities.filter((e) => e.toLowerCase() !== (prop.source.sender ?? '').toLowerCase());
      const place = ents.find((e) => /\b(theatre|theater|gym|park|hall|arena|center|centre|club|stadium|fillmore|warfield|chapel|independent)\b/i.test(e));
      if (chosen && chosen.type === 'preference' && !sameDate && place) {
        res = { objectId: 'new', relation: 'refers-to', conf: Math.max(res.conf, 0.65), newObject: { type: 'matter', displayName: `${chosen.displayName} at ${place}`, shape: 'approaching-event', when: prop.dateRef, place } };
        relation = 'refers-to';
      }
    }
    const top = candidates[0];
    const second = candidates[1];
    const gap = unknownSender ? this.opts.ambiguityGap * 3 : this.opts.ambiguityGap;
    const ambiguous = !!top && !!second && top.score - second.score < gap;
    // Structural ambiguity: two sibling matters (same referent, e.g. two shows of one band) with identical lexical and
    // structural evidence can only be told apart by the embedding's taste → never guess, ask — whatever the confirmer says.
    let structuralAmbiguity = false;
    if (top && second && top.type === 'matter' && second.type === 'matter' && !prop.dateRef) {
      const refA = new Set(g.outEdges(top.objectId, 'refers-to').map((e) => e.to));
      const shared = refA.size > 0 && g.outEdges(second.objectId, 'refers-to').some((e) => refA.has(e.to));
      const sameEvidence = !!top.signals && !!second.signals && top.signals.lexical === second.signals.lexical && top.signals.structural === second.signals.structural;
      structuralAmbiguity = shared && sameEvidence;
    }
    if (structuralAmbiguity && res.objectId !== 'new') {
      g.upsertProposition({ ...prop, status: 'ask-user' });
      return { proposition: g.propositions.get(prop.id)!, outcome: 'ask-user', candidates, constraints: lookup.constraints, escalated, confirmConf: res.conf };
    }

    // One date + one name = one matter. A confirmer that answers "new" while a candidate matter already sits on that
    // date and shares its name or entities is describing the candidate, not a new thing.
    if (res.objectId === 'new' && res.newObject) {
      const when = res.newObject.when ?? prop.dateRef;
      const twin = when ? candidates.find((c) => c.type === 'matter' && c.when && Math.abs(new Date(c.when).getTime() - new Date(when).getTime()) < 36 * 3600 * 1000 && (c.signals?.lexical ?? 0) >= 0.5) : undefined;
      if (twin) res = { objectId: twin.objectId, relation, conf: res.conf };
    }
    if (res.objectId === 'new' && res.newObject) {
      const created = this.createObject(res.newObject, prop, candidates);
      this.attach(prop, created.id, relation, res.conf);
      return { proposition: g.propositions.get(prop.id)!, outcome: 'new-object', candidates, constraints: lookup.constraints, createdObjectId: created.id, escalated, confirmConf: res.conf };
    }
    if (res.objectId !== 'none' && g.obj(res.objectId)) {
      if (res.conf < this.opts.lowConf && ambiguous) {
        g.upsertProposition({ ...prop, status: 'ask-user' });
        return { proposition: g.propositions.get(prop.id)!, outcome: 'ask-user', candidates, constraints: lookup.constraints, escalated, confirmConf: res.conf };
      }
      if (res.conf < this.opts.lowConf) {
        // A plausible home exists but the evidence is thin: never guess, ask (the card names the candidate).
        // Asking costs the user's attention, so it takes evidence too (see evidenceLevel): sender identity alone is not
        // a question worth asking, the item waits in the channel. Calendar entries are the user's own structured data:
        // a question about them is only worth asking on a name match.
        const topLevel = top?.signals ? evidenceLevel(prop.source.source, unknownSender, top.signals) : 'hold';
        const askable = !!top && top.score >= 0.3 && prop.source.source !== 'media' && topLevel !== 'hold' && (prop.source.source !== 'calendar' || (top.signals?.lexical ?? 0) >= 0.5);
        g.upsertProposition({ ...prop, status: askable ? 'ask-user' : 'candidate-channel' });
        return { proposition: g.propositions.get(prop.id)!, outcome: askable ? 'ask-user' : 'candidate-channel', candidates, constraints: lookup.constraints, escalated, confirmConf: res.conf };
      }
      this.attach(prop, res.objectId, relation, res.conf);
      return { proposition: g.propositions.get(prop.id)!, outcome: 'attributed', candidates, constraints: lookup.constraints, escalated, confirmConf: res.conf };
    }
    // none
    if (ambiguous) {
      g.upsertProposition({ ...prop, status: 'ask-user' });
      return { proposition: g.propositions.get(prop.id)!, outcome: 'ask-user', candidates, constraints: lookup.constraints, escalated, confirmConf: res.conf };
    }
    g.upsertProposition({ ...prop, status: 'candidate-channel' });
    return { proposition: g.propositions.get(prop.id)!, outcome: 'candidate-channel', candidates, constraints: lookup.constraints, escalated, confirmConf: res.conf };
  }

  /** The hour of day an object lives at: a recurring activity's clock, or a dated matter's time. */
  private scheduledHour(objectId: string): number | undefined {
    const o = this.graph.obj(objectId);
    if (!o) return undefined;
    if (o.type === 'activity' && typeof o.attrs?.cadence === 'string') return cadenceClock(o.attrs.cadence)?.hh;
    const m = o as Matter;
    if (m.type === 'matter' && m.when && m.when.slice(11, 16) !== '00:00') return Number(m.when.slice(11, 13));
    return undefined;
  }

  /** Write the attribution: edge, status, sender role. */
  attach(prop: Proposition, objectId: string, relation: RelationType, conf: number, constrainedBy?: string): void {
    const g = this.graph;
    let target = g.obj(objectId)!;
    // A dated proposition that landed on a sibling session (same activity, other day) belongs to the session of its own day.
    const tm = target as Matter;
    if (tm.type === 'matter' && tm.when && prop.dateRef && tm.when.slice(0, 10) !== prop.dateRef.slice(0, 10)) {
      const parent = g.outEdges(tm.id, 'part-of').map((e) => g.obj(e.to)).find((o) => o?.type === 'activity' && !o.domain);
      if (parent) {
        const sibling = g.inEdges(parent.id, 'part-of').map((e) => g.matter(e.from)).find((m) => m?.when && m.when.slice(0, 10) === prop.dateRef!.slice(0, 10));
        if (sibling) {
          target = sibling;
          objectId = sibling.id;
        }
      }
    }
    g.batch(() => {
      g.addEdge({ id: newId('e'), from: prop.id, to: objectId, type: relation, t: prop.t, conf, evidence: prop.id });
      g.upsertProposition({ ...prop, attributedTo: objectId, relation, attributionConf: conf, status: 'attributed', constrainedBy });
      if (prop.source.sender && target.type !== 'preference') {
        const person = g.personByName(prop.source.sender) ?? this.createPerson(prop.source.sender, prop.t);
        // A role is held in the activity, not in one of its sessions: the coach of the class, not of one Tuesday.
        const parentActivity = target.type === 'matter' ? g.outEdges(target.id, 'part-of').map((e) => g.obj(e.to)).find((o) => o?.type === 'activity' && !o.domain) : undefined;
        ensureRole(g, person.id, parentActivity?.id ?? objectId, 'participant', prop.t, prop.id);
      }
      // A dated item (calendar entry, or a message naming a time) attributed to a recurring activity becomes a session matter under it.
      if (target.type === 'activity' && prop.dateRef && (prop.source.source === 'calendar' || prop.dateRef.slice(11, 16) !== '00:00')) this.ensureSession(target, prop);
    });
  }

  private createPerson(name: string, t: ISODate): GraphObject {
    const o: GraphObject = { id: newId('person'), type: 'person', displayName: name, createdAt: t, attrs: { role: 'unknown' } };
    this.graph.addObject(o);
    return o;
  }

  /** Session matter for a dated instance of an activity (Boxing on Tue 19:00). Idempotent per (activity, day). */
  private ensureSession(activity: GraphObject, prop: Proposition): Matter {
    const g = this.graph;
    const day = prop.dateRef!.slice(0, 10);
    for (const e of g.inEdges(activity.id, 'part-of')) {
      const m = g.matter(e.from);
      if (m && m.when && m.when.slice(0, 10) === day) return m;
    }
    const m: Matter = {
      id: newId('m'),
      type: 'matter',
      displayName: `${activity.displayName} · ${fmtDate(prop.dateRef!)}`,
      createdAt: prop.t,
      shape: 'approaching-event',
      typicality: 0.8,
      worldState: 'scheduled',
      worldLog: [{ state: 'scheduled', t: prop.t, evidence: prop.id }],
      systemLog: [],
      userStance: 'preparing',
      when: prop.dateRef,
      place: typeof prop.entities.find((x) => /gym|theatre|theater|park|hall|arena|center|centre|club/i.test(x)) === 'string' ? prop.entities.find((x) => /gym|theatre|theater|park|hall|arena|center|centre|club/i.test(x)) : undefined,
      aliases: [activity.displayName],
    };
    g.addObject(m);
    g.addEdge({ id: newId('e'), from: m.id, to: activity.id, type: 'part-of', t: prop.t, conf: 0.9, evidence: prop.id });
    g.addEdge({ id: newId('e'), from: prop.id, to: m.id, type: 'evidence-for', t: prop.t, conf: 0.9, evidence: prop.id });
    return m;
  }

  /** Create an object the confirmer asked for; link it into the graph by typed edges inferred from candidates. */
  createObject(spec: NonNullable<Awaited<ReturnType<InferenceAdapter['confirm']>>['newObject']>, prop: Proposition, candidates: CandidateObject[]): GraphObject | Matter {
    const g = this.graph;
    let created: GraphObject | Matter;
    if (spec.type === 'matter') {
      created = {
        id: newId('m'),
        type: 'matter',
        displayName: spec.displayName,
        createdAt: prop.t,
        shape: spec.shape ?? 'approaching-event',
        typicality: spec.when ? 0.85 : 0.5,
        worldState: 'scheduled',
        worldLog: [{ state: 'scheduled', t: prop.t, evidence: prop.id }],
        systemLog: [],
        userStance: 'anticipating',
        when: spec.when ?? prop.dateRef,
        place: spec.place,
      } as Matter;
    } else {
      created = { id: newId(spec.type), type: spec.type, displayName: spec.displayName, createdAt: prop.t };
    }
    g.batch(() => {
      g.addObject(created);
      // refers-to any preference/goal whose name appears in the proposition or title (entity linking, general).
      const text = `${prop.text} ${spec.displayName}`.toLowerCase();
      let domainFound = false;
      for (const o of g.objects.values()) {
        if (o.type !== 'preference' && o.type !== 'goal' && o.type !== 'activity') continue;
        if (o.type === 'activity' && o.domain) continue;
        const names = [o.displayName, ...(o.aliases ?? [])].map((x) => x.toLowerCase());
        if (names.some((n) => n.length >= 3 && text.includes(n))) {
          g.addEdge({ id: newId('e'), from: created.id, to: o.id, type: o.type === 'activity' ? 'part-of' : 'refers-to', t: prop.t, conf: 0.8, evidence: prop.id });
          const dom = g.domainOf(o.id);
          if (dom && !domainFound) {
            const act = g.domainActivity(dom);
            if (act) {
              g.addEdge({ id: newId('e'), from: created.id, to: act.id, type: 'part-of', t: prop.t, conf: 0.8, evidence: prop.id });
              domainFound = true;
            }
          }
        }
      }
      if (!domainFound) {
        // Fall back to the top candidate's domain, then to the source's natural domain.
        const dom = candidates[0] ? g.domainOf(candidates[0].objectId) : undefined;
        const act = dom ? g.domainActivity(dom) : prop.source.source === 'media' ? g.domainActivity('music') : prop.source.source === 'workout' ? g.domainActivity('fitness') : undefined;
        if (act) g.addEdge({ id: newId('e'), from: created.id, to: act.id, type: 'part-of', t: prop.t, conf: 0.6, evidence: prop.id });
      }
    });
    return created;
  }

  private applyWorldState(objectId: string, state: WorldState, prop: Proposition, when?: ISODate): { objectId: string; state: WorldState; when?: ISODate } | undefined {
    const g = this.graph;
    const m = g.matter(objectId);
    if (!m) return undefined;
    // "Moved to Sunday, same time": a new date with no clock keeps the matter's own clock; midnight is never invented.
    let effective = when;
    if (state === 'rescheduled' && when && m.when && when.slice(11, 16) === '00:00' && m.when.slice(11, 16) !== '00:00') effective = `${when.slice(0, 10)}T${m.when.slice(11, 19)}${when.slice(19)}`;
    const patch: Partial<Matter> = {
      worldState: state,
      worldLog: [...m.worldLog, { state, t: prop.t, evidence: prop.id, when: state === 'rescheduled' ? effective : undefined, prevWhen: state === 'rescheduled' ? m.when : undefined, prevState: m.worldState }],
    };
    if (state === 'rescheduled' && effective) patch.when = effective;
    g.updateObject(m.id, patch);
    g.addEdge({ id: newId('e'), from: m.id, to: m.id, type: 'in-state', t: prop.t, conf: prop.conf, state, evidence: prop.id });
    return { objectId: m.id, state, when: state === 'rescheduled' ? effective : undefined };
  }

  /**
   * Candidate channel as a pressure valve: when ≥2 unattached propositions share an entity (not a person name)
   * and at least one carries a date, a new matter is forming → promote.
   */
  promoteCandidates(now: ISODate): string[] {
    const g = this.graph;
    const channel = [...g.propositions.values()].filter((p) => p.status === 'candidate-channel');
    const byEntity = new Map<string, Proposition[]>();
    const people = g.objectsOfType('person').map((p) => p.displayName.toLowerCase());
    // A person's name in any form it appears ("Jess" for "Jess (PM)") never names a matter.
    const isPersonName = (k: string) => !!g.personByName(k) || people.some((n) => n === k || n.startsWith(`${k} `) || n.startsWith(`${k}(`) || n.endsWith(` ${k}`));
    for (const p of channel) {
      for (const e of p.entities) {
        const k = e.toLowerCase();
        if (k.length < 4 || isPersonName(k)) continue;
        if (!byEntity.has(k)) byEntity.set(k, []);
        byEntity.get(k)!.push(p);
      }
    }
    const created: string[] = [];
    for (const [entity, props] of byEntity) {
      const uniq = [...new Map(props.map((p) => [p.id, p])).values()];
      if (uniq.length < 2) continue;
      // Repeated listening to the same artist: a preference forms (a standing collection identified by name, no endpoint).
      const plays = uniq.filter((p) => p.source.source === 'media' && p.kind === 'habit');
      if (plays.length >= 3 && plays.length === uniq.length) {
        const title = uniq[0]!.entities.find((e) => e.toLowerCase() === entity) ?? entity;
        const pref = this.createObject({ type: 'preference', displayName: title }, plays[0]!, []);
        for (const p of uniq) this.attach(p, pref.id, 'evidence-for', 0.7);
        created.push(pref.id);
        continue;
      }
      const dated = uniq.find((p) => p.dateRef);
      if (!dated) continue;
      const title = entity.replace(/\b\w/g, (c) => c.toUpperCase());
      const m = this.createObject({ type: 'matter', displayName: title, when: dated.dateRef, shape: 'approaching-event' }, dated, []);
      for (const p of uniq) this.attach(p, m.id, p.source.source === 'message' ? 'refers-to' : 'evidence-for', 0.6);
      (m as Matter).typicality = 0.6;
      g.updateObject(m.id, { typicality: 0.6, createdAt: now });
      created.push(m.id);
    }
    return created;
  }

  /** Channel health: cluster sizes and growth, for the rationale/perf panels. */
  channelStats(): { size: number; clusters: { entity: string; n: number }[] } {
    const channel = [...this.graph.propositions.values()].filter((p) => p.status === 'candidate-channel');
    const counts = new Map<string, number>();
    for (const p of channel) for (const e of p.entities) counts.set(e, (counts.get(e) ?? 0) + 1);
    const clusters = [...counts].filter(([, n]) => n >= 2).map(([entity, n]) => ({ entity, n }));
    return { size: channel.length, clusters };
  }
}

type EvidenceLevel = 'attach' | 'ask' | 'hold';

/**
 * How far the retrieval evidence lets a confirmer go, whatever it says. Words in common with the object are the
 * strongest kind (an entity or name hit is full strength; one shared evidence word is weak); structure — who sent it,
 * when it is about, what kind of source — counts in independent facets; an outstanding semantic match (≥3σ above the
 * pool) counts only next to a structural facet. A message needs more than a sensor reading, which has no words at all.
 * A stranger's message earns at most a question, and only when it names something already known.
 */
function evidenceLevel(source: ObservedEvent['source'], unknownSender: boolean, s: NonNullable<CandidateObject['signals']>): EvidenceLevel {
  const facets = s.facets ?? (s.structural > 0 ? 1 : 0);
  if (source !== 'message') return s.lexical > 0 || facets >= 1 ? 'attach' : 'hold';
  if (unknownSender) return s.lexical >= 0.5 ? 'ask' : 'hold';
  if (s.lexical >= 0.5 || facets >= 2 || (s.lexical > 0 && facets >= 1) || (s.semantic >= 0.9 && facets >= 1)) return 'attach';
  if (s.lexical > 0) return 'ask';
  return 'hold';
}

/** Remove the sender's name (and its parts) from a text before embedding it as a query. */
function stripSender(text: string, sender?: string): string {
  if (!sender) return text;
  let out = text;
  for (const part of [sender, ...sender.split(/[\s()]+/).filter((p) => p.length >= 3)]) out = out.split(part).join(' ');
  out = out.replace(/^\s*:\s*/, '').replace(/\s+/g, ' ').trim();
  return out || text;
}

function metaStart(ev: ObservedEvent): ISODate | undefined {
  const s = ev.meta?.start;
  if (typeof s !== 'string') return undefined;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return `${s.slice(0, 16)}:00${ev.t.slice(-6)}`;
  return undefined;
}
