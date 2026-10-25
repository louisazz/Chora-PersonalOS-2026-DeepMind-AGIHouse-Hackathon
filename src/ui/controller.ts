/**
 * UI-facing controller: owns the graph, attributor, replay engine, adapters and UI state.
 * React reads it through useSyncExternalStore (see hooks.ts). No persona knowledge here.
 */
import type {
  ContextId,
  EmbeddingAdapter,
  Fixture,
  InferenceAdapter,
  ISODate,
  Matter,
  ObservedEvent,
  Proposition,
  Scope,
  SurfacePlan,
  SuggestedAction,
  ViewSpec,
  EventSource,
} from '@/contract/types';
import { Attributor, type ProcessOutcome } from '@/core/attribution';
import { applyCorrection, attachmentEdges, type CorrectionInput, withdrawEvidence } from '@/core/correction';
import { Graph } from '@/core/graph';
import { DEFAULT_POLICY, evaluateSuggestions, inferContext, type ContextState, type Evaluation } from '@/core/policy';
import { ReplayEngine } from '@/core/replay';
import { inferIntent, planView, type CompareMode } from '@/core/surface';
import { newId } from '@/core/util';
import { HashedEmbedding } from '@/adapters/embedding/hashed';
import { RulesInference } from '@/adapters/inference/rules';
import type { Lang } from '@/contract/i18n';

export type InferenceChoice = 'rules' | 'litertlm-e2b' | 'llama';
export type EmbeddingChoice = 'hashed' | 'gemma' | 'litertlm';

export interface LogLine {
  t: number;
  text: string;
}

export interface ExecutionRecord {
  t: ISODate;
  action: SuggestedAction;
  result: string;
}

export class Controller {
  graph = new Graph();
  attributor: Attributor;
  replay?: ReplayEngine;
  fixture?: Fixture;
  lang: Lang = 'en';
  contextOverride?: ContextId;
  density: Record<string, 0 | 1 | 2 | 3> = {};
  mode: CompareMode = 'adaptive';
  viewStack: ViewSpec[] = [{ id: 'life', kind: 'life', organizingObjectId: 'me' }];
  tab: 'life' | 'work' | 'model' = 'life';
  plans = new Map<string, SurfacePlan>();
  evaluation: Evaluation = { shown: [], silent: [], interruptsUsed: 0 };
  context: ContextState;
  lastOutcome?: ProcessOutcome;
  inference: InferenceChoice = 'rules';
  embedding: EmbeddingChoice = 'hashed';
  modelStatus = 'rules adapter (no model loaded)';
  embeddingStatus = 'lexical hashed embedding';
  escalation?: InferenceAdapter & { loaded: boolean; loads: number[]; unload(): Promise<void> };
  busy = false;
  progress?: string;
  logs: LogLine[] = [];
  executions: ExecutionRecord[] = [];
  pendingScope?: { correctionId: string; propositionId: string; toObjectId: string; sender?: string };
  /** Proposition currently being moved in the correction dialog. */
  correcting?: string;
  private listeners = new Set<() => void>();
  private version = 0;

  constructor() {
    this.attributor = new Attributor(this.graph, new HashedEmbedding(), new RulesInference());
    this.attributor.onEmbeddingFallback = (err) => {
      this.embedding = 'hashed';
      this.embeddingStatus = `FELL BACK to lexical: ${err}`;
      this.log(this.embeddingStatus);
    };
    this.context = inferContext(new Date().toISOString());
    this.graph.subscribe(() => this.recompute());
  }

  // -------------------------------------------------------------------------
  // subscription
  // -------------------------------------------------------------------------
  subscribe(l: () => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  snapshotVersion(): number {
    return this.version;
  }
  private emit(): void {
    this.version += 1;
    for (const l of this.listeners) l();
  }
  log(text: string): void {
    this.logs.push({ t: Date.now(), text });
    if (this.logs.length > 200) this.logs.shift();
    this.emit();
  }

  // -------------------------------------------------------------------------
  // lifecycle
  // -------------------------------------------------------------------------
  async loadFixture(url = './fixtures/persona-default.json'): Promise<void> {
    const r = await fetch(url);
    if (!r.ok) {
      this.log(`fixture fetch failed: ${r.status} ${url}`);
      throw new Error(`fixture ${r.status}`);
    }
    const fixture = (await r.json()) as Fixture;
    this.fixture = fixture;
    this.replay = new ReplayEngine(fixture, this.graph, this.attributor);
    this.replay.subscribe(() => this.recompute());
    this.replay.seed();
    this.log(`fixture loaded: ${fixture.events.length} events, ${fixture.seedObjects.length} seed objects`);
    this.recompute();
  }

  /** Precompute snapshots up to (not including) the day of the first scripted correction. */
  async precompute(): Promise<void> {
    if (!this.replay || !this.fixture) return;
    const firstCorrection = this.fixture.corrections[0];
    const ev = firstCorrection ? this.fixture.events.find((e) => e.id === firstCorrection.eventId) : undefined;
    const untilDay = ev ? this.replay.dayIndexOf(ev.t) - 1 : this.replay.totalDays - 1;
    this.busy = true;
    this.progress = 'precomputing…';
    this.emit();
    try {
      await this.replay.precompute(untilDay, (d) => {
        this.progress = `precomputed day ${d + 1}/${untilDay + 1}`;
        this.emit();
      });
      this.log(`precomputed days 0–${untilDay} (before the first correction point)`);
    } catch (e) {
      this.log(`precompute failed: ${String(e).slice(0, 200)}`);
      console.error(e);
    } finally {
      this.busy = false;
      this.progress = undefined;
    }
    this.recompute();
  }

  get now(): ISODate {
    return this.replay?.now ?? new Date().toISOString();
  }

  private recomputing = false;
  private planKeys = new Map<string, string>();
  private graphVersion = 0;

  /**
   * Recompute suggestions for the current time/context. Policy writes suggestions and system-log entries back to
   * the graph, which would re-trigger this through the graph subscription: the guard makes that a no-op, and a
   * change arriving while a recompute is running is coalesced into one follow-up pass.
   */
  recompute(): void {
    // JS is single-threaded: any graph notification that arrives while a recompute runs is the policy's own write.
    if (this.recomputing) return;
    this.recomputing = true;
    try {
      this.graphVersion += 1;
      this.context = inferContext(this.now, this.contextOverride);
      this.evaluation = evaluateSuggestions(this.graph, this.now, this.context, DEFAULT_POLICY);
    } finally {
      this.recomputing = false;
    }
    this.schedulePersist();
    this.emit();
  }

  // -------------------------------------------------------------------------
  // views
  // -------------------------------------------------------------------------
  get view(): ViewSpec {
    if (this.tab === 'work') return { id: 'work', kind: 'work', organizingObjectId: this.graph.domainActivity('work')?.id ?? 'work' };
    if (this.tab === 'model') return { id: 'user-model', kind: 'user-model', organizingObjectId: 'me' };
    return this.viewStack[this.viewStack.length - 1]!;
  }
  /** Plan a view. Re-planned only when its inputs changed (graph, time, context, density, mode), never per render. */
  plan(view: ViewSpec = this.view): SurfacePlan {
    const density = this.density[view.id] ?? 2;
    const key = `${this.graphVersion}|${this.now}|${this.context.id}|${density}|${this.mode}|${this.lang}`;
    const prev = this.plans.get(view.id);
    if (prev && this.planKeys.get(view.id) === key) return prev;
    const intent = inferIntent(this.graph, view, this.context.id);
    const plan = planView({ graph: this.graph, view, context: this.context.id, intent, density, now: this.now, evaluation: this.evaluation, prev, mode: this.mode });
    this.plans.set(view.id, plan);
    this.planKeys.set(view.id, key);
    return plan;
  }
  /** A deliberate entry into a view is the natural point where deferred structural changes may land. */
  private enter(viewId: string): void {
    const prev = this.plans.get(viewId);
    if (prev && prev.deferred.length) {
      this.plans.delete(viewId);
      this.planKeys.delete(viewId);
    }
  }
  open(target: string): void {
    const [kind, id] = target.split(':');
    if (!id) return;
    const o = this.graph.obj(id);
    if (!o) return;
    let view: ViewSpec | undefined;
    if (kind === 'matter' && o.type === 'matter') view = { id: `matter:${id}`, kind: 'matter', organizingObjectId: id };
    else if (kind === 'domain' || (o.type === 'activity' && o.domain)) view = { id: `domain:${id}`, kind: 'domain', organizingObjectId: id };
    else if (kind === 'person' || o.type === 'person') view = { id: `person:${id}`, kind: 'person', organizingObjectId: id };
    else if (o.type === 'matter') view = { id: `matter:${id}`, kind: 'matter', organizingObjectId: id };
    else {
      // Non-matter objects open the domain they belong to.
      const dom = this.graph.domainOf(id);
      const act = dom ? this.graph.domainActivity(dom) : undefined;
      if (act) view = { id: `domain:${act.id}`, kind: 'domain', organizingObjectId: act.id };
    }
    if (!view) return;
    this.tab = 'life';
    this.enter(view.id);
    this.viewStack.push(view);
    this.graph.addFeedback({ type: 'tap', target: id, t: this.now });
  }
  back(): void {
    if (this.viewStack.length > 1) this.viewStack.pop();
    this.enter(this.view.id);
    this.emit();
  }
  setTab(tab: 'life' | 'work' | 'model'): void {
    this.tab = tab;
    this.enter(this.view.id);
    this.emit();
  }
  setLang(lang: Lang): void {
    this.lang = lang;
    this.emit();
  }
  setContext(ctx?: ContextId): void {
    this.contextOverride = ctx;
    this.recompute();
  }
  setMode(mode: CompareMode): void {
    this.mode = mode;
    this.plans.clear();
    this.emit();
  }
  nudgeDensity(delta: 1 | -1): void {
    const id = this.view.id;
    const cur = this.density[id] ?? 2;
    this.density[id] = Math.max(0, Math.min(3, cur + delta)) as 0 | 1 | 2 | 3;
    this.graph.addFeedback({ type: delta > 0 ? 'more' : 'less', target: id, t: this.now });
  }

  // -------------------------------------------------------------------------
  // replay
  // -------------------------------------------------------------------------
  private async guarded(label: string, fn: () => Promise<void>): Promise<void> {
    this.busy = true;
    this.emit();
    try {
      await fn();
    } catch (e) {
      this.log(`${label} failed: ${String(e).slice(0, 200)}`);
      console.error(e);
    } finally {
      this.busy = false;
      this.progress = undefined;
    }
    this.recompute();
  }
  async seekDay(day: number): Promise<void> {
    if (!this.replay) return;
    await this.guarded('seek', async () => {
      await this.replay!.seekDay(day, (d) => {
        this.progress = `recomputing day ${d + 1} live…`;
        this.emit();
      });
    });
  }
  async stepEvent(): Promise<void> {
    if (!this.replay) return;
    await this.guarded('step', async () => {
      const o = await this.replay!.stepEvent();
      if (o) this.lastOutcome = o;
    });
  }
  async stepToTime(t: ISODate): Promise<void> {
    if (!this.replay) return;
    await this.guarded('step', async () => {
      const outs = await this.replay!.stepToTime(t);
      if (outs.length) this.lastOutcome = outs[outs.length - 1];
    });
  }
  reset(): void {
    this.replay?.reset();
    this.plans.clear();
    this.lastOutcome = undefined;
    this.restoredFrom = undefined;
    try {
      if (this.persistKey) localStorage.removeItem(this.persistKey);
    } catch {
      /* storage unavailable */
    }
    this.recompute();
  }

  // -------------------------------------------------------------------------
  // continuity: the graph as the user shaped it survives closing the app
  // -------------------------------------------------------------------------
  private persistTimer?: ReturnType<typeof setTimeout>;
  restoredFrom?: string;
  private get persistKey(): string | undefined {
    return this.fixture ? `personos:live:${this.fixture.generatedAt}` : undefined;
  }
  private schedulePersist(): void {
    if (!this.replay || this.busy || this.replay.busy || typeof localStorage === 'undefined') return;
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => this.persistState(), 400);
  }
  persistState(): void {
    const key = this.persistKey;
    if (!key || !this.replay || this.busy || this.replay.busy) return;
    try {
      const state = { savedAt: new Date().toISOString(), replay: this.replay.exportState(), ui: { density: this.density, lang: this.lang, mode: this.mode } };
      localStorage.setItem(key, JSON.stringify(state));
    } catch (e) {
      this.log(`persist failed: ${String(e).slice(0, 80)}`);
    }
  }
  /** Resume the state saved on this device, if any. Returns whether something was restored. */
  restorePersisted(): boolean {
    const key = this.persistKey;
    if (!key || !this.replay) return false;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return false;
      const state = JSON.parse(raw) as { savedAt: string; replay: Parameters<ReplayEngine['restoreState']>[0]; ui?: { density?: Record<string, 0 | 1 | 2 | 3>; lang?: Lang; mode?: CompareMode } };
      this.replay.restoreState(state.replay);
      if (state.ui?.density) this.density = state.ui.density;
      if (state.ui?.lang) this.lang = state.ui.lang;
      if (state.ui?.mode) this.mode = state.ui.mode;
      this.plans.clear();
      this.restoredFrom = state.savedAt;
      const g = this.graph;
      this.log(`restored live state saved ${state.savedAt.slice(11, 19)}Z: ${g.corrections.size} corrections, ${[...g.propositions.values()].filter((p) => p.status === 'attributed').length} attributed propositions, replay at ${this.replay.now.slice(0, 16)}`);
      this.recompute();
      return true;
    } catch (e) {
      this.log(`restore failed: ${String(e).slice(0, 80)}`);
      return false;
    }
  }
  async feed(input: { text: string; sender?: string; source: EventSource; app?: string }): Promise<ProcessOutcome | undefined> {
    if (!this.replay) return undefined;
    let o: ProcessOutcome | undefined;
    await this.guarded('feed', async () => {
      o = await this.replay!.feed({ text: input.text, sender: input.sender || undefined, source: input.source, app: input.app });
      this.lastOutcome = o;
      this.log(`fed ${input.source} event → ${o.outcomes.map((x) => x.outcome).join(', ') || o.verdict}`);
    });
    return o;
  }

  // -------------------------------------------------------------------------
  // corrections and the user model
  // -------------------------------------------------------------------------
  createMatter(spec: { displayName: string; when?: ISODate; place?: string; domainId?: string; entities?: string[] }): Matter {
    const m: Matter = {
      id: newId('m'),
      type: 'matter',
      displayName: spec.displayName,
      createdAt: this.now,
      shape: 'approaching-event',
      typicality: 0.9,
      worldState: 'scheduled',
      worldLog: [{ state: 'scheduled', t: this.now, evidence: 'user' }],
      systemLog: [],
      userStance: 'anticipating',
      when: spec.when,
      place: spec.place,
      aliases: spec.entities,
    };
    this.graph.batch(() => {
      this.graph.addObject(m);
      if (spec.domainId) this.graph.addEdge({ id: newId('e'), from: m.id, to: spec.domainId, type: 'part-of', t: this.now, conf: 1, evidence: 'user' });
      const text = `${spec.displayName} ${(spec.entities ?? []).join(' ')}`.toLowerCase();
      for (const o of this.graph.objects.values()) {
        if (o.type !== 'preference' && o.type !== 'goal') continue;
        if (text.includes(o.displayName.toLowerCase())) this.graph.addEdge({ id: newId('e'), from: m.id, to: o.id, type: 'refers-to', t: this.now, conf: 1, evidence: 'user' });
      }
    });
    return m;
  }

  openCorrection(propositionId: string): void {
    this.correcting = propositionId;
    this.emit();
  }
  closeCorrection(): void {
    this.correcting = undefined;
    this.emit();
  }

  /** Instance-scope move; returns the correction so the UI can offer to widen the scope. */
  correct(propositionId: string, toObjectId: string, scope: Scope = 'instance', extra: Partial<CorrectionInput> = {}): void {
    const prop = this.graph.propositions.get(propositionId);
    if (!prop) return;
    this.correcting = undefined;
    const res = applyCorrection(this.graph, { propositionId, toObjectId, scope, t: this.now, confirmed: 'user', ...extra });
    this.replay?.invalidateAfter(this.now);
    this.plans.clear();
    const c = res.correction;
    this.log(`correction ${c.scope}: ${prop.text.slice(0, 40)}… → ${this.graph.obj(toObjectId)?.displayName} (${c.evidence})${res.upgradedFrom ? ' [auto-upgraded: repeated]' : ''}`);
    if (c.scope === 'instance' && prop.source.sender) this.pendingScope = { correctionId: c.id, propositionId, toObjectId, sender: prop.source.sender };
    else this.pendingScope = undefined;
    this.recompute();
  }
  widenScope(scope: Scope): void {
    const p = this.pendingScope;
    this.pendingScope = undefined;
    if (!p) return;
    const prop = this.graph.propositions.get(p.propositionId);
    if (!prop) return;
    const res = applyCorrection(this.graph, { propositionId: p.propositionId, toObjectId: p.toObjectId, scope, t: this.now, confirmed: 'user' });
    const old = this.graph.corrections.get(p.correctionId);
    if (old) this.graph.addCorrection({ ...old, supersededBy: res.correction.id });
    this.log(`scope widened to ${scope}: ${res.correction.evidence}`);
    this.recompute();
  }
  dismissScope(): void {
    this.pendingScope = undefined;
    this.emit();
  }
  /** Answer an ask-user proposition. */
  resolveAsk(propositionId: string, toObjectId: string): void {
    this.correct(propositionId, toObjectId, 'instance');
  }
  deleteProposition(id: string): void {
    const p = this.graph.propositions.get(id);
    if (!p) return;
    let rolled: string[] = [];
    this.graph.batch(() => {
      for (const e of attachmentEdges(this.graph, id)) this.graph.removeEdge(e.id);
      this.graph.upsertProposition({ ...p, status: 'deleted' });
      rolled = withdrawEvidence(this.graph, id);
    });
    this.replay?.invalidateAfter(this.now);
    this.log(`deleted proposition: ${p.text.slice(0, 50)}${rolled.length ? ` · rolled back ${rolled.map((m) => this.objectName(m)).join(', ')}` : ''}`);
    this.recompute();
  }
  toggleFreeze(id: string): void {
    const p = this.graph.propositions.get(id);
    if (!p) return;
    if (p.status === 'frozen') {
      this.graph.upsertProposition({ ...p, status: p.attributedTo ? 'attributed' : 'candidate-channel' });
    } else {
      this.graph.batch(() => {
        this.graph.upsertProposition({ ...p, status: 'frozen' });
        withdrawEvidence(this.graph, id);
      });
    }
    this.replay?.invalidateAfter(this.now);
    this.recompute();
  }
  propositionsOfSuggestion(suggestionId: string): Proposition[] {
    const s = this.graph.suggestions.get(suggestionId);
    if (!s) return [];
    return s.rationale.because.map((id) => this.graph.propositions.get(id)).filter((p): p is Proposition => !!p);
  }

  // -------------------------------------------------------------------------
  // execution: Android bridge when present, otherwise logged
  // -------------------------------------------------------------------------
  async execute(action: SuggestedAction): Promise<void> {
    const bridge = (globalThis as { PersonOSBridge?: { execute(json: string): string } }).PersonOSBridge;
    let result: string;
    if (bridge) {
      try {
        result = bridge.execute(JSON.stringify(action));
      } catch (e) {
        result = `bridge error: ${String(e)}`;
      }
    } else result = `logged (no execution adapter): ${action.intent} ${JSON.stringify(action.args)}`;
    this.executions.push({ t: this.now, action, result });
    const m = this.graph.matter(action.args.objectId ?? '');
    if (m) this.graph.updateObject(m.id, { systemLog: [...m.systemLog, { action: 'executed', t: this.now, detail: `${action.intent}: ${result}` }] });
    this.graph.addFeedback({ type: 'tap', target: action.args.objectId ?? action.intent, t: this.now });
    this.log(`execute ${action.intent} → ${result}`);
  }
  dismiss(suggestionId: string): void {
    this.graph.addFeedback({ type: 'dismiss', target: suggestionId, t: this.now });
    const s = this.graph.suggestions.get(suggestionId);
    if (s) this.graph.upsertSuggestion({ ...s, shown: false, silenceReason: 'nothing-worth-saying' });
    this.plans.clear();
    this.emit();
  }

  // -------------------------------------------------------------------------
  // adapters
  // -------------------------------------------------------------------------
  async useInference(choice: InferenceChoice): Promise<void> {
    this.inference = choice;
    this.busy = true;
    this.progress = `loading ${choice}…`;
    this.emit();
    try {
      let adapter: InferenceAdapter;
      if (choice === 'rules') adapter = new RulesInference();
      else if (choice === 'llama') {
        const { LlamaServerInference } = await import('@/adapters/inference/llamaServer');
        adapter = new LlamaServerInference();
        await adapter.ready();
      } else {
        const { LiteRtLmWebInference } = await import('@/adapters/inference/litertlmWeb');
        adapter = new LiteRtLmWebInference({ modelUrl: '/models/gemma-4-E2B-it-web.litertlm', label: 'litert-lm-web:gemma-4-E2B', onProgress: (m) => this.setProgress(m) });
        await adapter.ready();
      }
      this.attributor.setInference(adapter);
      this.modelStatus = `${adapter.name} (${adapter.stats().backend})${adapter.stats().loadMs ? `, loaded in ${(adapter.stats().loadMs! / 1000).toFixed(1)} s` : ''}`;
      this.log(`inference → ${adapter.name}`);
    } catch (e) {
      this.modelStatus = `failed to load ${choice}: ${String(e).slice(0, 120)}`;
      this.inference = 'rules';
      this.attributor.setInference(new RulesInference());
      this.log(this.modelStatus);
    } finally {
      this.busy = false;
      this.progress = undefined;
      this.emit();
    }
  }
  async useEmbedding(choice: EmbeddingChoice): Promise<void> {
    this.embedding = choice;
    this.busy = true;
    this.progress = `loading embedding ${choice}…`;
    this.emit();
    try {
      let adapter: EmbeddingAdapter;
      if (choice === 'hashed') adapter = new HashedEmbedding();
      else if (choice === 'litertlm') {
        const { LiteRtLmEmbedding } = await import('@/adapters/embedding/litertlm');
        adapter = new LiteRtLmEmbedding({ modelUrl: '/models/embeddinggemma-2-text-270m.litertlm', onProgress: (m) => this.setProgress(m) });
        await adapter.ready();
      } else {
        const { GemmaEmbedding } = await import('@/adapters/embedding/gemma');
        adapter = new GemmaEmbedding({ onProgress: (m) => this.setProgress(m) });
        await adapter.ready();
      }
      this.attributor.setEmbedding(adapter);
      this.embeddingStatus = `${adapter.name} (${adapter.stats().backend})${adapter.stats().loadMs ? `, loaded in ${(adapter.stats().loadMs! / 1000).toFixed(1)} s` : ''}`;
      this.log(`embedding → ${adapter.name}`);
    } catch (e) {
      this.embeddingStatus = `failed: ${String(e).slice(0, 120)}`;
      this.embedding = 'hashed';
      this.attributor.setEmbedding(new HashedEmbedding());
      this.log(this.embeddingStatus);
    } finally {
      this.busy = false;
      this.progress = undefined;
      this.emit();
    }
  }
  async useEscalation(enabled: boolean): Promise<void> {
    if (!enabled) {
      await this.escalation?.unload();
      this.escalation = undefined;
      this.attributor.setEscalation(undefined);
      this.emit();
      return;
    }
    const { LiteRtLmWebInference } = await import('@/adapters/inference/litertlmWeb');
    const e = new LiteRtLmWebInference({ modelUrl: '/models/gemma-4-E4B-it-web.litertlm', label: 'litert-lm-web:gemma-4-E4B (escalation)', idleUnloadMs: 90_000, onProgress: (m) => this.setProgress(m) });
    this.escalation = e;
    this.attributor.setEscalation(e);
    this.log('escalation layer armed: E4B loads on demand, unloads after 90 s idle');
    this.emit();
  }
  private setProgress(m: string): void {
    this.progress = m;
    this.emit();
  }

  // -------------------------------------------------------------------------
  // helpers for the panels
  // -------------------------------------------------------------------------
  objectName(id?: string): string {
    if (!id) return '';
    return this.graph.obj(id)?.displayName ?? id;
  }
  eventById(id: string): ObservedEvent | undefined {
    return this.fixture?.events.find((e) => e.id === id) ?? this.replay?.fed.find((e) => e.id === id);
  }
}

export const controller = new Controller();
