/**
 * Proactive layer: matter state + context + inferred intent → suggestions, with calibrated silence.
 * Suggestions are derived (never stored as truth): deleting a proposition re-derives them.
 * Three kinds of change are separated: content (unlimited), structure (budgeted, in surface.ts),
 */
import type { ContextId, ISODate, Matter, Rationale, SilenceReason, Suggestion, SuggestedAction, Proposition } from '@/contract/types';
import type { Graph } from './graph';
import { clamp, dayOf, fmtDate, fmtTime, hourOf, weekdayOf } from './util';
import { resolveDateRef } from './triage';

export interface PolicyOptions {
  lowConf: number;
  interruptBudgetPerDay: number;
  horizonDays: number;
}
export const DEFAULT_POLICY: PolicyOptions = { lowConf: 0.4, interruptBudgetPerDay: 3, horizonDays: 7 };

export interface ContextState {
  id: ContextId;
  signals: string[];
  at: ISODate;
}

/** Clock-based default context; the UI (or real sensors on the phone) can override. */
export function inferContext(now: ISODate, override?: ContextId): ContextState {
  if (override) return { id: override, signals: ['override'], at: now };
  const h = hourOf(now);
  const wd = weekdayOf(now);
  const weekday = wd >= 1 && wd <= 5;
  if (h >= 23 || h < 7) return { id: 'night', signals: ['clock'], at: now };
  if (weekday && h >= 17 && h < 19) return { id: 'commute', signals: ['clock', 'weekday'], at: now };
  if (weekday && h >= 9 && h < 17) return { id: 'desk', signals: ['clock', 'weekday'], at: now };
  return { id: 'home', signals: ['clock'], at: now };
}

function hoursUntil(now: ISODate, when: ISODate): number {
  return (new Date(when).getTime() - new Date(now).getTime()) / 3600000;
}

function confOf(props: Proposition[]): number {
  if (props.length === 0) return 0.5;
  const s = props.reduce((a, p) => a + p.conf * (p.attributionConf ?? 1), 0);
  return clamp(s / props.length);
}

interface Draft {
  objectId: string;
  kind: string;
  title: string;
  action?: SuggestedAction;
  urgency: number;
  conf: number;
  because: string[];
  derivedFrom: string[];
  interrupt: boolean;
}

function recentChange(m: Matter, now: ISODate, hours = 36): Matter['worldLog'][number] | undefined {
  const last = m.worldLog[m.worldLog.length - 1];
  if (!last || last.state === 'scheduled') return undefined;
  return Math.abs(hoursUntil(last.t, now)) <= hours ? last : undefined;
}

/** Draft suggestions from graph state. Persona-agnostic: everything comes from matters, propositions and attrs. */
export function draftSuggestions(graph: Graph, now: ISODate, opts: PolicyOptions): Draft[] {
  const drafts: Draft[] = [];
  const dayNow = dayOf(now);

  for (const m of graph.matters()) {
    const props = graph.activePropositionsOf(m.id);
    const derivedFrom = props.map((p) => p.id);
    const conf = confOf(props);
    const change = recentChange(m, now);

    // Interrupts: reschedule / cancel must surface regardless of context.
    if (change && (change.state === 'rescheduled' || change.state === 'cancelled')) {
      const ev = props.find((p) => p.id === change.evidence);
      drafts.push({
        objectId: m.id,
        kind: change.state,
        title: change.state === 'cancelled' ? `${m.displayName} is cancelled` : `${m.displayName} moved to ${m.when ? fmtDate(m.when) + ' ' + fmtTime(m.when) : 'a new time'}`,
        action: change.state === 'rescheduled' ? { label: 'Update reminder', intent: 'calendar.reminder', args: { objectId: m.id, when: m.when ?? '' } } : undefined,
        urgency: 1,
        conf: Math.max(conf, ev?.conf ?? 0),
        because: [ev ? ev.id : change.evidence],
        derivedFrom,
        interrupt: true,
      });
    }
    if (m.worldState === 'cancelled' || m.worldState === 'past') continue;
    if (!m.when) {
      // Deliverables without a date: surface only when a request arrived in the last 2 days.
      const recent = props.filter((p) => p.kind === 'request' && Math.abs(hoursUntil(p.t, now)) <= 48);
      if (recent.length && m.shape === 'deliverable') {
        drafts.push({ objectId: m.id, kind: 'request', title: `${m.displayName}: ${recent[recent.length - 1]!.text.replace(/^[^:]+:\s*/, '')}`, urgency: 0.35, conf, because: recent.map((p) => p.id), derivedFrom, interrupt: false });
      }
      continue;
    }
    const h = hoursUntil(now, m.when);
    if (h < -3) continue;
    const withinHorizon = h <= opts.horizonDays * 24;
    const sameDay = dayOf(m.when) === dayNow;
    const matterDates = new Set([m.when, ...m.worldLog.map((w) => w.when)].filter((x): x is string => !!x).map(dayOf));

    // On-sale window mentioned by a proposition: the date that follows "on sale" in the text, not the show date.
    const onsaleAt = (p: Proposition): ISODate | undefined => {
      const mm = p.text.match(/on sale\s+(?:on\s+)?([^.;\n]{3,40})/i);
      return mm ? resolveDateRef(mm[1]!, p.t) : undefined;
    };
    const onsaleProp = props.map((p) => ({ p, at: /on sale/i.test(p.text) ? onsaleAt(p) : undefined })).find((x) => x.at && hoursUntil(now, x.at) > -1 && hoursUntil(now, x.at) < 48);
    if (onsaleProp && onsaleProp.at) {
      const onsale = onsaleProp.p;
      const at = onsaleProp.at;
      const hu = hoursUntil(now, at);
      drafts.push({
        objectId: m.id,
        kind: 'onsale',
        title: `${m.displayName}: tickets on sale ${dayOf(at) === dayNow ? 'today' : 'tomorrow'} ${fmtTime(at)}`,
        action: { label: 'Add reminder', intent: 'calendar.reminder', args: { objectId: m.id, when: at } },
        urgency: clamp(1 - hu / 48, 0.5, 0.95),
        conf: Math.max(conf, onsale.conf),
        because: [onsale.id],
        derivedFrom,
        interrupt: false,
      });
    }
    // Gear / bring requests for a same-day matter.
    const gear = props.filter((p) => p.kind === 'request' && /\b(bring|pack|wraps|gloves|gear|id photo|passport|bib)\b/i.test(p.text));
    if (withinHorizon && sameDay && gear.length) {
      const items = gear.flatMap((p) => p.entities.filter((e) => !/^[A-Z]/.test(e) || /wraps|gloves/i.test(e))).slice(0, 3);
      drafts.push({
        objectId: m.id,
        kind: 'gear',
        title: `${m.displayName} tonight — bring ${items.length ? items.join(' and ') : 'what was asked'}`,
        action: { label: 'Check gear before leaving', intent: 'check.gear', args: { objectId: m.id } },
        urgency: clamp(1 - h / 12, 0.6, 0.9),
        conf: Math.max(conf, ...gear.map((p) => p.conf)),
        because: gear.map((p) => p.id),
        derivedFrom,
        interrupt: false,
      });
    } else if (withinHorizon && sameDay && h > -1) {
      drafts.push({
        objectId: m.id,
        kind: 'today',
        title: `${m.displayName} today at ${fmtTime(m.when)}`,
        urgency: clamp(0.8 - h / 24, 0.4, 0.8),
        conf,
        because: derivedFrom.slice(-2),
        derivedFrom,
        interrupt: false,
      });
    }
    // Requests with a deadline (send ID before the 12th) on an upcoming matter.
    const deadline = props.find((p) => p.kind === 'request' && p.dateRef && /\b(before|by|until|due|deadline|no later than|send me|need)\b/i.test(p.text) && !matterDates.has(dayOf(p.dateRef)) && hoursUntil(now, p.dateRef) > 0 && hoursUntil(now, p.dateRef) < 72);
    if (deadline && deadline.dateRef) {
      drafts.push({
        objectId: m.id,
        kind: 'deadline',
        title: `${m.displayName}: ${deadline.text.replace(/^[^:]+:\s*/, '')}`,
        action: { label: 'Reply', intent: 'reply', args: { objectId: m.id, to: deadline.source.sender ?? '' } },
        urgency: clamp(1 - hoursUntil(now, deadline.dateRef) / 72, 0.4, 0.8),
        conf: deadline.conf,
        because: [deadline.id],
        derivedFrom,
        interrupt: false,
      });
    }
    // Deliverable due soon.
    if (withinHorizon && m.shape === 'deliverable' && h > 0 && h < 72 && !drafts.some((d) => d.objectId === m.id)) {
      drafts.push({ objectId: m.id, kind: 'due', title: `${m.displayName} due ${fmtDate(m.when)}`, urgency: clamp(1 - h / 72, 0.3, 0.7), conf, because: derivedFrom.slice(-1), derivedFrom, interrupt: false });
    }
  }

  // Scheduled departures on activities (commute): surface within 2h before departure on weekdays.
  for (const a of graph.objectsOfType('activity')) {
    const dep = a.attrs?.departure;
    if (typeof dep !== 'string') continue;
    const wd = weekdayOf(now);
    if (wd === 0 || wd === 6) continue;
    const [hh, mm] = dep.split(':').map(Number);
    const depAt = `${dayNow}T${String(hh).padStart(2, '0')}:${String(mm ?? 0).padStart(2, '0')}:00${now.slice(-6)}`;
    const hu = hoursUntil(now, depAt);
    if (hu < -0.5 || hu > 2) continue;
    const props = graph.activePropositionsOf(a.id).filter((p) => dayOf(p.t) === dayNow);
    const disruption = props.find((p) => /delay|now departs|every \d+ min/i.test(p.text));
    const leaveBy = typeof a.attrs?.leaveBy === 'string' ? a.attrs.leaveBy : undefined;
    drafts.push({
      objectId: a.id,
      kind: 'departure',
      title: disruption ? `${dep} ${a.attrs?.line ?? a.displayName} from ${a.attrs?.station ?? ''}: ${disruption.text.replace(/^[^:]+:\s*/, '')}` : `${dep} ${a.attrs?.line ?? a.displayName} departs ${a.attrs?.station ?? ''}`,
      action: leaveBy ? { label: `Leave by ${leaveBy}`, intent: 'leave.by', args: { objectId: a.id, time: leaveBy } } : undefined,
      urgency: clamp(1 - hu / 2, 0.5, 0.9),
      conf: disruption ? disruption.conf : 0.7,
      because: disruption ? [disruption.id] : props.slice(-1).map((p) => p.id),
      derivedFrom: props.map((p) => p.id),
      interrupt: !!disruption,
    });
  }
  return drafts;
}

export interface Evaluation {
  shown: Suggestion[];
  silent: Suggestion[];
  interruptsUsed: number;
}

/** Gate drafts by context, confidence and interrupt budget; write results to the graph. Idempotent. */
export function evaluateSuggestions(graph: Graph, now: ISODate, context: ContextState, opts: PolicyOptions = DEFAULT_POLICY): Evaluation {
  const drafts = draftSuggestions(graph, now, opts);
  const dayNow = dayOf(now);
  // The budget counts distinct interrupting suggestions actually shown today (from the matters' system logs), so a
  // redraw at the same moment neither re-consumes it nor flips earlier interrupts back to silent.
  const priorInterruptIds = new Set<string>();
  for (const m of graph.matters()) for (const l of m.systemLog) if (l.action === 'suggested' && l.interrupt && dayOf(l.t) === dayNow) priorInterruptIds.add(l.detail);
  let interruptsUsed = priorInterruptIds.size;
  const shown: Suggestion[] = [];
  const silent: Suggestion[] = [];
  const badContext = context.id === 'meeting' || context.id === 'night';

  const ranked = drafts.map((d) => ({ d, score: d.urgency * Math.max(d.conf, 0.2) })).sort((a, b) => b.score - a.score);
  for (const { d } of ranked) {
    const id = `sug_${d.objectId}_${d.kind}`;
    const alreadyBudgeted = priorInterruptIds.has(id);
    let silence: SilenceReason | undefined;
    if (d.conf < opts.lowConf) silence = 'low-conf';
    else if (badContext && !(d.interrupt && d.urgency >= 0.9)) silence = 'bad-context';
    else if (d.interrupt && !alreadyBudgeted && interruptsUsed >= opts.interruptBudgetPerDay) silence = 'budget';
    else if (d.urgency < 0.3) silence = 'nothing-worth-saying';
    if (!silence && d.interrupt && !alreadyBudgeted) {
      interruptsUsed += 1;
      priorInterruptIds.add(id);
    }
    const rationale: Rationale = { because: d.because, context: context.id, conf: d.conf, urgency: d.urgency, suppressed: [] };
    const s: Suggestion = {
      id,
      objectId: d.objectId,
      title: d.title,
      action: silence ? undefined : d.action,
      conf: Number(d.conf.toFixed(2)),
      urgency: Number(d.urgency.toFixed(2)),
      rationale,
      shown: !silence,
      silenceReason: silence,
      derivedFrom: d.derivedFrom,
      context: context.id,
      t: now,
    };
    (silence ? silent : shown).push(s);
  }
  // Attach the losers to each shown suggestion's rationale so the panel can show what was held back.
  for (const s of shown) s.rationale.suppressed = silent.map((x) => ({ objectId: x.objectId, title: x.title, reason: x.silenceReason! }));

  graph.batch(() => {
    const keep = new Set([...shown, ...silent].map((s) => s.id));
    for (const id of [...graph.suggestions.keys()]) if (!keep.has(id)) graph.suggestions.delete(id);
    for (const s of [...shown, ...silent]) graph.upsertSuggestion(s);
    for (const s of shown) {
      const m = graph.matter(s.objectId);
      if (m && !m.systemLog.some((l) => l.detail === s.id && dayOf(l.t) === dayNow)) graph.updateObject(m.id, { systemLog: [...m.systemLog, { action: 'suggested', t: now, detail: s.id, interrupt: s.urgency >= 0.9 }] });
    }
    for (const s of silent) {
      const m = graph.matter(s.objectId);
      if (m && !m.systemLog.some((l) => l.detail === s.id && l.silenceReason === s.silenceReason && dayOf(l.t) === dayNow)) graph.updateObject(m.id, { systemLog: [...m.systemLog, { action: 'silenced', t: now, detail: s.id, silenceReason: s.silenceReason }] });
    }
  });
  return { shown, silent, interruptsUsed };
}

/** Why a domain shows nothing right now: the typed silence. */
export function domainSilence(graph: Graph, domainActivityId: string, evaluation: Evaluation): SilenceReason {
  const members = graph.membersOf({ id: 'd', kind: 'domain', organizingObjectId: domainActivityId });
  const silent = evaluation.silent.filter((s) => members.has(s.objectId));
  if (silent.some((s) => s.silenceReason === 'bad-context')) return 'bad-context';
  if (silent.some((s) => s.silenceReason === 'budget')) return 'budget';
  if (silent.some((s) => s.silenceReason === 'low-conf')) return 'low-conf';
  return 'nothing-worth-saying';
}
