/**
 * View projection: graph + context + intent + density → K candidate SurfacePlans → semantic-subject veto →
 * score → one plan → diff against the previous plan with the structure budget applied.
 */
import type { ComponentId, ContextId, DiffOp, EmptyKind, Intent, ISODate, Matter, ObjectType, Slot, SurfacePlan, Suggestion, ViewSpec } from '@/contract/types';
import { CATALOG, FALLBACK_COMPONENT, compatible, preferredComponents } from '@/contract/catalog';
import type { Graph } from './graph';
import type { Evaluation } from './policy';
import { dayOf, fmtDate, fmtTime } from './util';

export type CompareMode = 'adaptive' | 'fixed' | 'stream';

export interface PlanInput {
  graph: Graph;
  view: ViewSpec;
  context: ContextId;
  intent: Intent;
  density: 0 | 1 | 2 | 3;
  now: ISODate;
  evaluation: Evaluation;
  prev?: SurfacePlan;
  mode: CompareMode;
  structureBudget?: number;
}

interface Candidate {
  name: string;
  slots: Slot[];
}

const DENSITY_NOW = [0, 1, 2, 4];

function slot(region: string, component: ComponentId, subjectId: string, props: Record<string, unknown>, extra: Partial<Slot> = {}): Slot {
  const sub = typeof props.propositionId === 'string' ? `:${props.propositionId}` : typeof props.suggestionId === 'string' ? `:${props.suggestionId}` : '';
  return { id: `${region}:${component}:${subjectId}${sub}`, region, component, subjectId, area: CATALOG[component].area, props, ...extra };
}

export interface ConflictSink {
  conflicts: { t: ISODate; viewId: string; component: ComponentId; subjectType: ObjectType; fallback: ComponentId }[];
}
const sink: ConflictSink = { conflicts: [] };

/** Pick a component for a subject under the compatibility table; record a conflict on fallback (no graph writes: planning is pure). */
export function pickComponent(_graph: Graph, viewId: string, wanted: ComponentId, subjectType: ObjectType, now: ISODate): ComponentId {
  if (compatible(wanted, subjectType)) return wanted;
  sink.conflicts.push({ t: now, viewId, component: wanted, subjectType, fallback: FALLBACK_COMPONENT });
  return FALLBACK_COMPONENT;
}

function suggestionSlot(graph: Graph, s: Suggestion, viewId: string, now: ISODate): Slot {
  const o = graph.obj(s.objectId);
  const component = pickComponent(graph, viewId, 'suggestion-card', o?.type ?? 'matter', now);
  const domain = graph.domainOf(s.objectId);
  return slot('now', component, s.objectId, { suggestionId: s.id, title: s.title, action: s.action, conf: s.conf, urgency: s.urgency, domain, objectName: o?.displayName }, { tapTo: `matter:${s.objectId}`, actionTarget: s.objectId });
}

function newSince(graph: Graph, objectIds: Set<string>, now: ISODate): number {
  const since = new Date(now).getTime() - 48 * 3600 * 1000;
  let n = 0;
  for (const p of graph.propositions.values()) if (p.status === 'attributed' && p.attributedTo && objectIds.has(p.attributedTo) && p.source.eventId !== 'seed' && new Date(p.t).getTime() >= since) n += 1;
  return n;
}

function emptyKind(graph: Graph, objectIds: Set<string>): EmptyKind {
  if (objectIds.size <= 1) return 'truly-empty';
  return 'no-match';
}

// ---------------------------------------------------------------------------
// candidate generators per view kind
// ---------------------------------------------------------------------------

/** Propositions awaiting the user's answer, newest first; the card's subject is the top candidate object. */
function askSlots(graph: Graph, members: Set<string> | undefined, viewId: string, now?: ISODate): Slot[] {
  const since = now ? new Date(now).getTime() - 48 * 3600 * 1000 : 0;
  return [...graph.propositions.values()]
    .filter((p) => p.status === 'ask-user' && (p.candidates?.length ?? 0) > 0 && new Date(p.t).getTime() >= since)
    .filter((p) => !members || p.candidates!.some((c) => members.has(c.objectId)))
    .sort((a, b) => b.t.localeCompare(a.t))
    .slice(0, 2)
    .map((p) => {
      const top = p.candidates![0]!;
      const subject = members && !members.has(top.objectId) ? p.candidates!.find((c) => members.has(c.objectId))!.objectId : top.objectId;
      return slot('now', 'ask-card', subject, { propositionId: p.id, text: p.text, sender: p.source.sender, candidates: p.candidates!.map((c) => ({ objectId: c.objectId, name: graph.obj(c.objectId)?.displayName ?? c.objectId, score: c.score })), viewId }, { tapTo: `matter:${subject}`, actionTarget: subject });
    });
}

function lifeCandidates(inp: PlanInput): Candidate[] {
  const { graph, evaluation, now, density, view } = inp;
  const shown = [...evaluation.shown].sort((a, b) => b.urgency * b.conf - a.urgency * a.conf);
  const domains = graph.objectsOfType('activity').filter((a) => a.domain);
  const domainRows = (hintMode: 'count' | 'latest'): Slot[] =>
    domains.map((d) => {
      const members = graph.membersOf({ id: `domain:${d.id}`, kind: 'domain', organizingObjectId: d.id });
      const n = newSince(graph, members, now);
      const top = shown.find((s) => members.has(s.objectId));
      let hint = '';
      if (top) hint = top.title;
      else if (n > 0) {
        const latest = [...graph.propositions.values()].filter((p) => p.status === 'attributed' && members.has(p.attributedTo!)).sort((a, b) => b.t.localeCompare(a.t))[0];
        const about = latest ? graph.obj(latest.attributedTo!)?.displayName ?? '' : '';
        hint = hintMode === 'count' ? `${n} new about ${about}` : latest?.text ?? '';
      }
      const silence = !top && n === 0 ? evaluation.silent.find((s) => members.has(s.objectId))?.silenceReason : undefined;
      return slot('domains', 'object-row', d.id, { name: d.displayName, domain: d.domain, hint, unread: n > 0 || !!top, silence }, { tapTo: `domain:${d.id}` });
    });
  const nowSlots = (k: number) => shown.slice(0, k).map((s) => suggestionSlot(graph, s, view.id, now));
  const k = DENSITY_NOW[density] ?? 2;
  const silenceNote = (): Slot[] => {
    if (shown.length > 0 || k === 0 || askSlots(graph, undefined, view.id, now).length > 0) return [];
    const reason = evaluation.silent[0]?.silenceReason ?? 'nothing-worth-saying';
    const act = domains[0];
    return act ? [slot('now', 'silence-note', act.id, { reason, suppressed: evaluation.silent.map((s) => ({ title: s.title, reason: s.silenceReason })) })] : [];
  };
  const asks = askSlots(graph, undefined, view.id, now);
  return [
    { name: `density-${density}`, slots: [...asks, ...nowSlots(k), ...silenceNote(), ...domainRows('count')] },
    { name: `density-${Math.max(0, density - 1)}`, slots: [...asks, ...nowSlots(DENSITY_NOW[Math.max(0, density - 1)] ?? 1), ...silenceNote(), ...domainRows('latest')] },
    // Plausible-but-wrong candidate: promote the top suggestion's *action* to the title of a card with no object subject.
    // This is what the semantic-subject test must veto (the card's subject would be the system's advice, not a matter).
    ...(shown[0]
      ? [
          {
            name: 'advice-first',
            slots: [slot('now', 'suggestion-card', 'system:advice', { title: shown[0].action?.label ?? shown[0].title, conf: shown[0].conf, urgency: shown[0].urgency, objectName: 'PersonOS' }, { tapTo: 'settings', actionTarget: 'system:advice' }), ...domainRows('count')],
          },
        ]
      : []),
  ];
}

function matterRow(graph: Graph, m: Matter, viewId: string, intent: Intent, now: ISODate, region: string): Slot {
  const wanted = preferredComponents('matter', intent).find((c) => c !== 'suggestion-card' && c !== 'action-button') ?? 'object-row';
  const component = pickComponent(graph, viewId, intent === 'glance' ? 'object-row' : wanted, 'matter', now);
  const people = graph.peopleOf(m.id).map((x) => x.person.displayName);
  const props = graph.activePropositionsOf(m.id);
  return slot(region, component, m.id, { name: m.displayName, when: m.when, place: m.place, worldState: m.worldState, people, count: props.length, latest: props[props.length - 1]?.text, shape: m.shape }, { tapTo: `matter:${m.id}` });
}

function domainCandidates(inp: PlanInput): Candidate[] {
  const { graph, view, evaluation, now, intent, density } = inp;
  const root = graph.obj(view.organizingObjectId)!;
  const members = graph.membersOf(view);
  const shown = evaluation.shown.filter((s) => members.has(s.objectId));
  const nowSlots = [...askSlots(graph, members, view.id, now), ...shown.slice(0, DENSITY_NOW[density] ?? 2).map((s) => suggestionSlot(graph, s, view.id, now))];
  const matters = [...members].map((id) => graph.matter(id)).filter((m): m is Matter => !!m);
  const upcoming = matters.filter((m) => m.worldState !== 'past' && m.worldState !== 'cancelled' && m.when && m.when >= now.slice(0, 10)).sort((a, b) => (a.when ?? '').localeCompare(b.when ?? ''));
  const cancelled = matters.filter((m) => m.worldState === 'cancelled' && m.when && dayOf(m.when) >= dayOf(now));
  const past = matters.filter((m) => m.worldState === 'past' || (m.when && m.when < now.slice(0, 10) && m.worldState !== 'cancelled'));
  const ongoing = [...members].map((id) => graph.obj(id)!).filter((o) => o && (o.type === 'activity' || o.type === 'goal' || o.type === 'preference') && o.id !== root.id);
  const people = [...members].map((id) => graph.obj(id)!).filter((o) => o && o.type === 'person');
  const upcomingSlots = [...upcoming, ...cancelled].map((m) => matterRow(graph, m, view.id, intent, now, 'upcoming'));
  const ongoingSlots = ongoing.map((o) => {
    const props = graph.activePropositionsOf(o.id);
    const series = props.map((p) => p.text.match(/(\d+(?:\.\d+)?)\s*km/i)?.[1]).filter(Boolean).map(Number);
    const wanted = intent === 'review-trend' && series.length >= 2 ? 'curve' : 'object-row';
    const component = pickComponent(graph, view.id, wanted, o.type, now);
    return slot('ongoing', component, o.id, { name: o.displayName, type: o.type, count: props.length, latest: props[props.length - 1]?.text, series, cadence: o.attrs?.cadence }, { tapTo: `object:${o.id}` });
  });
  const memorySlots = past.map((m) => {
    // Past matters are experiences for rendering purposes: never a to-do row.
    const component = pickComponent(graph, view.id, intent === 'recall' ? 'timeline' : 'object-row', 'matter', now);
    return slot('memories', component, m.id, { name: m.displayName, when: m.when, place: m.place, worldState: m.worldState }, { tapTo: `matter:${m.id}` });
  });
  const peopleSlots = people.map((p) => slot('people', 'object-row', p.id, { name: p.displayName, type: 'person', roles: graph.outEdges(p.id, 'plays-role').filter((e) => members.has(e.to)).map((e) => graph.obj(e.to)?.displayName) }, { tapTo: `person:${p.id}` }));
  const emptyUpcoming = upcomingSlots.length ? [] : [slot('upcoming', 'empty-state', root.id, { kind: emptyKind(graph, members) })];
  return [
    { name: `density-${density}`, slots: [...nowSlots, ...upcomingSlots, ...emptyUpcoming, ...ongoingSlots, ...memorySlots, ...peopleSlots] },
    { name: 'compact', slots: [...nowSlots.slice(0, 1), ...upcomingSlots.map((s) => ({ ...s, component: 'object-row' as ComponentId, area: 1 as const })), ...emptyUpcoming, ...ongoingSlots.map((s) => ({ ...s, component: 'object-row' as ComponentId, area: 1 as const })), ...peopleSlots] },
    // Wrong candidate: a "global now" that pulls the most urgent suggestion from any domain into this view.
    ...(evaluation.shown[0] && !members.has(evaluation.shown[0].objectId)
      ? [{ name: 'global-now', slots: [suggestionSlot(graph, evaluation.shown[0], view.id, now), ...upcomingSlots, ...ongoingSlots, ...peopleSlots] }]
      : []),
  ];
}

function matterCandidates(inp: PlanInput): Candidate[] {
  const { graph, view, evaluation, now } = inp;
  const m = graph.matter(view.organizingObjectId);
  if (!m) return [{ name: 'missing', slots: [slot('header', 'empty-state', view.organizingObjectId, { kind: 'unknown' })] }];
  const props = graph.activePropositionsOf(m.id);
  const people = graph.peopleOf(m.id);
  const sugg = evaluation.shown.filter((s) => s.objectId === m.id);
  const silent = evaluation.silent.filter((s) => s.objectId === m.id);
  const header = slot('header', 'matter-header', m.id, { name: m.displayName, when: m.when, place: m.place, worldState: m.worldState, worldLog: m.worldLog, stance: m.userStance, shape: m.shape, typicality: m.typicality, domain: graph.domainOf(m.id) }, { tapTo: `matter:${m.id}` });
  const facts = props.filter((p) => p.source.source !== 'message').map((p) => slot('facts', 'proposition-row', m.id, { propositionId: p.id, text: p.text, conf: p.conf, source: p.source, t: p.t, kind: p.kind }));
  const messages = props.filter((p) => p.source.source === 'message').map((p) => slot('messages', 'conversation-ref', m.id, { propositionId: p.id, text: p.text, sender: p.source.sender, t: p.t, constrainedBy: p.constrainedBy }, { tapTo: `matter:${m.id}` }));
  const peopleSlots = people.map((x) => slot('people', 'object-row', x.person.id, { name: x.person.displayName, type: 'person', role: x.role }, { tapTo: `person:${x.person.id}` }));
  const actions = sugg.filter((s) => s.action).map((s) => slot('actions', 'action-button', m.id, { suggestionId: s.id, label: s.action!.label, intent: s.action!.intent, conf: s.conf }, { actionTarget: m.id }));
  const silenceSlots = sugg.length === 0 && silent.length ? [slot('actions', 'silence-note', m.id, { reason: silent[0]!.silenceReason, suppressed: silent.map((s) => ({ title: s.title, reason: s.silenceReason })) })] : [];
  const sys = m.systemLog.length
    ? [slot('facts', 'timeline', m.id, { entries: m.systemLog.slice(-5).map((l) => ({ t: l.t, text: l.action + (l.silenceReason ? ` (${l.silenceReason})` : ''), detail: graph.suggestions.get(l.detail)?.title ?? l.detail.replace(/^sug_[^_]+_[^_]+_/, '') })), title: 'System log' })]
    : [];
  return [
    { name: 'full', slots: [header, ...actions, ...silenceSlots, ...facts, ...messages, ...peopleSlots, ...sys] },
    { name: 'messages-first', slots: [header, ...messages, ...actions, ...facts, ...peopleSlots] },
  ];
}

function personCandidates(inp: PlanInput): Candidate[] {
  const { graph, view, now, intent } = inp;
  const p = graph.obj(view.organizingObjectId);
  if (!p) return [{ name: 'missing', slots: [slot('header', 'empty-state', view.organizingObjectId, { kind: 'unknown' })] }];
  const header = slot('header', 'object-row', p.id, { name: p.displayName, type: 'person', role: p.attrs?.role, big: true });
  const matters = graph.mattersOfPerson(p.id).sort((a, b) => (a.when ?? '').localeCompare(b.when ?? ''));
  const shared = matters.map((m) => matterRow(graph, m, view.id, intent, now, 'shared-matters'));
  const msgs = [...graph.propositions.values()].filter((x) => x.status === 'attributed' && x.source.sender === p.displayName).sort((a, b) => a.t.localeCompare(b.t)).map((x) => slot('messages', 'conversation-ref', x.attributedTo!, { propositionId: x.id, text: x.text, sender: x.source.sender, t: x.t, about: graph.obj(x.attributedTo!)?.displayName, constrainedBy: x.constrainedBy }, { tapTo: `matter:${x.attributedTo}` }));
  const rules = graph.outEdges(p.id, 'applies-to').map((e) => slot('header', 'proposition-row', p.id, { text: `Routing rule: messages from ${p.displayName} → ${graph.obj(e.to)?.displayName}`, rule: true, correctionId: e.evidence, predicate: e.predicate }));
  const empty = shared.length ? [] : [slot('shared-matters', 'empty-state', p.id, { kind: 'truly-empty' })];
  return [{ name: 'full', slots: [header, ...rules, ...shared, ...empty, ...msgs] }];
}

function workCandidates(inp: PlanInput): Candidate[] {
  const { graph, view, evaluation, now, density } = inp;
  const work = graph.domainActivity('work');
  if (!work) return [];
  const members = graph.membersOf(view);
  const shown = evaluation.shown.filter((s) => members.has(s.objectId));
  const nowSlots = shown.slice(0, Math.max(1, DENSITY_NOW[density] ?? 2)).map((s) => suggestionSlot(graph, s, view.id, now));
  const reqs = [...members].map((id) => graph.matter(id)).filter((m): m is Matter => !!m && m.shape === 'deliverable');
  const reqSlots = reqs.map((m) => {
    const convs = graph.activePropositionsOf(m.id).filter((p) => p.source.source === 'message');
    return slot('requirements', pickComponent(graph, view.id, 'requirement-card', 'matter', now), m.id, { name: m.displayName, status: m.attrs?.status ?? m.worldState, conversations: convs.length, when: m.when }, { tapTo: `matter:${m.id}` });
  });
  const todos = [...members].map((id) => graph.obj(id)!).filter((o) => o && o.type === 'commitment');
  const todoSlots = todos.map((c) => {
    const props = graph.activePropositionsOf(c.id);
    const latest = props[props.length - 1];
    return slot('todos', pickComponent(graph, view.id, 'todo-row', 'commitment', now), c.id, { name: c.displayName, status: latest ? latest.text.replace(/^[^:]+:\s*/, '') : c.attrs?.status }, { tapTo: `object:${c.id}` });
  });
  // Wrong candidate: render commitments as requirement cards (component identity mismatch → must fall back / be penalized).
  const wrong = todos.map((c) => slot('requirements', pickComponent(graph, view.id, 'requirement-card', 'commitment', now), c.id, { name: c.displayName }, { tapTo: `object:${c.id}` }));
  return [
    { name: `density-${density}`, slots: [...nowSlots, ...reqSlots, ...todoSlots] },
    { name: 'todos-as-cards', slots: [...nowSlots, ...reqSlots, ...wrong] },
  ];
}

function userModelCandidates(inp: PlanInput): Candidate[] {
  const { graph } = inp;
  const rows = [...graph.propositions.values()]
    .filter((p) => p.status !== 'dropped' && p.status !== 'deleted')
    .sort((a, b) => b.t.localeCompare(a.t))
    .map((p) => slot('propositions', 'proposition-row', p.attributedTo ?? 'me', { propositionId: p.id, text: p.text, conf: p.conf, status: p.status, attributedTo: p.attributedTo, about: p.attributedTo ? graph.obj(p.attributedTo)?.displayName : undefined, source: p.source, t: p.t, kind: p.kind, constrainedBy: p.constrainedBy, candidates: p.candidates }));
  return [{ name: 'all', slots: rows }];
}

function streamCandidate(inp: PlanInput): Candidate[] {
  const { graph } = inp;
  const rows = [...graph.propositions.values()]
    .filter((p) => p.status === 'attributed' || p.status === 'candidate-channel')
    .sort((a, b) => b.t.localeCompare(a.t))
    .map((p) => slot('stream', 'proposition-row', p.attributedTo ?? 'me', { propositionId: p.id, text: p.text, t: p.t, source: p.source, stream: true }));
  return [{ name: 'stream', slots: rows }];
}

// ---------------------------------------------------------------------------
// semantic-subject test, scoring, diff, budget
// ---------------------------------------------------------------------------

export interface SubjectVerdict {
  ok: boolean;
  reason?: string;
}

/** Four signals: largest area, title (header), primary action target, tap destination. All must point inside the view. */
export function semanticSubjectTest(graph: Graph, view: ViewSpec, slots: Slot[]): SubjectVerdict {
  const members = graph.membersOf(view);
  const inside = (id: string) => (view.kind === 'life' || view.kind === 'user-model' ? !!graph.obj(id) || id === 'me' : members.has(id) || id === view.organizingObjectId);
  if (slots.length === 0) return { ok: true };
  const largest = [...slots].sort((a, b) => b.area - a.area)[0]!;
  if (!inside(largest.subjectId)) return { ok: false, reason: `largest area is about ${largest.subjectId}, not a member of this view` };
  const header = slots.find((s) => s.region === 'header');
  if (header && header.subjectId !== view.organizingObjectId) return { ok: false, reason: `title subject ${header.subjectId} ≠ organizing object` };
  for (const s of slots) {
    if (s.actionTarget && !inside(s.actionTarget)) return { ok: false, reason: `action targets ${s.actionTarget}, outside the view` };
    if (s.tapTo) {
      const target = s.tapTo.split(':')[1];
      if (target && !inside(target) && !['settings'].includes(s.tapTo)) return { ok: false, reason: `tap goes to ${s.tapTo}, outside the view` };
      if (s.tapTo === 'settings') return { ok: false, reason: 'tap goes to the system, not to an object' };
    }
    if (!inside(s.subjectId)) return { ok: false, reason: `slot ${s.id} is about ${s.subjectId}, outside the view` };
  }
  return { ok: true };
}

function scoreCandidate(c: Candidate, inp: PlanInput): number {
  let score = 0;
  for (const s of c.slots) {
    if (s.component === 'suggestion-card') score += (Number(s.props.urgency) || 0) * (Number(s.props.conf) || 0.2);
    if (s.component === 'empty-state') score -= 0.05;
    // Component preference under the intent.
    const subj = inp.graph.obj(s.subjectId);
    if (subj) {
      const pref = preferredComponents(subj.type, inp.intent);
      const idx = pref.indexOf(s.component);
      if (idx >= 0) score += 0.08 * (pref.length - idx) / pref.length;
    }
  }
  // Density fit: number of 'now' slots vs target.
  const nowN = c.slots.filter((s) => s.region === 'now').length;
  score -= 0.1 * Math.abs(nowN - (DENSITY_NOW[inp.density] ?? 2));
  // Stability: structural distance from the previous plan.
  if (inp.prev) {
    const prevIds = new Set(inp.prev.slots.map((s) => s.id));
    const curIds = new Set(c.slots.map((s) => s.id));
    let d = 0;
    for (const id of prevIds) if (!curIds.has(id)) d += 1;
    for (const id of curIds) if (!prevIds.has(id)) d += 1;
    score -= 0.03 * d;
  }
  return score;
}

export function diffPlans(prev: Slot[] | undefined, next: Slot[]): DiffOp[] {
  const ops: DiffOp[] = [];
  const prevById = new Map((prev ?? []).map((s) => [s.id, s]));
  const nextIds = new Set(next.map((s) => s.id));
  for (const s of prev ?? []) if (!nextIds.has(s.id)) ops.push({ kind: 'structure', op: 'remove', slotId: s.id });
  next.forEach((s, i) => {
    const p = prevById.get(s.id);
    if (!p) ops.push({ kind: 'structure', op: 'add', slot: s, index: i });
    else {
      if (p.component !== s.component) ops.push({ kind: 'structure', op: 'replace', slotId: s.id, component: s.component });
      if (JSON.stringify(p.props) !== JSON.stringify(s.props)) ops.push({ kind: 'content', slotId: s.id, props: s.props });
      const prevIndex = (prev ?? []).findIndex((x) => x.id === s.id);
      if (prevIndex !== i && Math.abs(prevIndex - i) > 0 && (prev ?? []).length === next.length) ops.push({ kind: 'structure', op: 'move', slotId: s.id, index: i });
    }
  });
  return ops;
}

export function planView(inp: PlanInput): SurfacePlan {
  const { graph, view, prev, mode } = inp;
  const budget = inp.structureBudget ?? 6;
  sink.conflicts = [];
  let candidates: Candidate[];
  if (mode === 'stream') candidates = streamCandidate(inp);
  else {
    switch (view.kind) {
      case 'life':
        candidates = lifeCandidates(inp);
        break;
      case 'domain':
        candidates = domainCandidates(inp);
        break;
      case 'matter':
        candidates = matterCandidates(inp);
        break;
      case 'person':
        candidates = personCandidates(inp);
        break;
      case 'work':
        candidates = workCandidates(inp);
        break;
      case 'user-model':
        candidates = userModelCandidates(inp);
        break;
    }
    if (mode === 'fixed') {
      // Fixed layout: same objects, generic rows, no suggestion cards, no density adaptation.
      candidates = candidates.slice(0, 1).map((c) => ({ name: 'fixed', slots: c.slots.filter((s) => s.region !== 'now').map((s) => ({ ...s, component: s.component === 'matter-header' ? s.component : ('object-row' as ComponentId), area: 1 as const })) }));
    }
  }
  const vetoed: { candidate: string; reason: string }[] = [];
  const scored: { candidate: string; score: number }[] = [];
  let best: { c: Candidate; score: number } | undefined;
  for (const c of candidates) {
    const verdict = semanticSubjectTest(graph, view, c.slots);
    if (!verdict.ok) {
      vetoed.push({ candidate: c.name, reason: verdict.reason ?? 'subject test failed' });
      continue;
    }
    const score = scoreCandidate(c, inp);
    scored.push({ candidate: c.name, score: Number(score.toFixed(3)) });
    if (!best || score > best.score) best = { c, score };
  }
  const chosen = best?.c ?? { name: 'empty', slots: [] };
  const sameDay = prev && dayOf(prev.plannedAt ?? inp.now) === dayOf(inp.now);
  let used = sameDay ? prev!.structureBudgetUsed : 0;
  const ops = diffPlans(prev?.slots, chosen.slots);
  const structural = ops.filter((o) => o.kind === 'structure');
  const deferred: DiffOp[] = [];
  let slots = chosen.slots;
  // The budget governs change to a view the user already has in front of them; the first population of a view is free.
  const populated = !!prev && prev.slots.length > 0;
  if (populated && mode === 'adaptive' && used + structural.length > budget) {
    // Over budget: keep previous structure, apply content updates only, but let interrupts into 'now'.
    const interruptAdds = structural.filter((o) => o.kind === 'structure' && o.op === 'add' && o.slot.region === 'now' && (Number(o.slot.props.urgency) >= 0.9 || o.slot.component === 'ask-card'));
    const allowed = new Set(interruptAdds.map((o) => (o as { slot: Slot }).slot.id));
    const nextById = new Map(chosen.slots.map((s) => [s.id, s]));
    slots = prev.slots.map((s) => nextById.get(s.id) ?? s).filter((s) => nextById.has(s.id) || true);
    for (const s of chosen.slots) if (allowed.has(s.id) && !slots.some((x) => x.id === s.id)) slots.unshift(s);
    for (const o of structural) if (!(o.op === 'add' && allowed.has(o.slot.id))) deferred.push(o);
    used += interruptAdds.length;
  } else if (populated) {
    used += structural.length;
  }
  const version = (prev?.version ?? 0) + 1;
  return {
    viewId: view.id,
    organizingObjectId: view.organizingObjectId,
    version,
    plannedAt: inp.now,
    slots,
    lastDiff: ops,
    structureBudgetUsed: used,
    structureBudget: budget,
    deferred,
    rationale: { chosen: chosen.name, vetoed, scored, conflicts: sink.conflicts.map((c) => `${c.component} for ${c.subjectType} → ${c.fallback}`) },
    density: inp.density,
    context: inp.context,
    intent: inp.intent,
  };
}

/** Infer intent from stance, entry point and clock. An input to policy, not a dial. */
export function inferIntent(graph: Graph, view: ViewSpec, context: ContextId): Intent {
  if (context === 'commute' || context === 'meeting') return 'glance';
  if (view.kind === 'matter') {
    const m = graph.matter(view.organizingObjectId);
    if (m?.worldState === 'past') return 'recall';
    return 'plan-next';
  }
  if (view.kind === 'domain') {
    const root = graph.obj(view.organizingObjectId);
    if (root?.domain === 'fitness' && context === 'home') return 'review-trend';
    return 'plan-next';
  }
  return 'glance';
}

export function describeSlot(s: Slot): string {
  return `${s.component}@${s.region} about ${String(s.props.name ?? s.props.title ?? s.subjectId)}${s.props.when ? ' ' + fmtDate(String(s.props.when)) + ' ' + fmtTime(String(s.props.when)) : ''}`;
}
