/**
 * Corrections are scoped constraints, not data edits.
 * correction(item, from, to, scope, predicate, evidence, t)
 * - instance: move this one proposition; add the sender's plays-role edge on the target.
 */
import type { ApplicableConstraint, Correction, Edge, EventSource, ISODate, Matter, Predicate, Proposition, Scope } from '@/contract/types';
import type { Graph } from './graph';
import { addDays, newId } from './util';

export interface CorrectionInput {
  propositionId: string;
  toObjectId: string;
  scope: Scope;
  predicate?: Predicate;
  evidence?: string;
  t: ISODate;
  confirmed: 'user' | 'default' | 'repeat';
  /** For rule scope: which entity string the rule keys on. Defaults to the proposition's first entity. */
  ruleEntity?: string;
}

export interface CorrectionResult {
  correction: Correction;
  upgradedFrom?: Scope;
  superseded: string[];
}

export function specificity(p: Predicate): number {
  return (p.sender ? 1 : 0) + (p.source ? 1 : 0) + (p.entity ? 1 : 0) + (p.timeWindow ? 1 : 0);
}

export function predicateMatches(p: Predicate, prop: { sender?: string; source: EventSource; entities: string[]; t: ISODate; text?: string }): boolean {
  if (p.sender && (prop.sender ?? '').toLowerCase() !== p.sender.toLowerCase()) return false;
  if (p.source && prop.source !== p.source) return false;
  if (p.entity) {
    const e = p.entity.toLowerCase();
    const inEntities = prop.entities.some((x) => x.toLowerCase().includes(e) || (x.length >= 4 && e.includes(x.toLowerCase())));
    const inText = !!prop.text && prop.text.toLowerCase().includes(e);
    if (!inEntities && !inText) return false;
  }
  if (p.timeWindow) {
    const t = new Date(prop.t).getTime();
    if (t < new Date(p.timeWindow.from).getTime() || t > new Date(p.timeWindow.to).getTime()) return false;
  }
  return specificity(p) > 0;
}

/** Predicates overlap when one could fire on the same proposition as the other (same keyed values). */
function overlaps(a: Predicate, b: Predicate): boolean {
  const sameSender = !a.sender || !b.sender || a.sender.toLowerCase() === b.sender.toLowerCase();
  const sameSource = !a.source || !b.source || a.source === b.source;
  const sameEntity = !a.entity || !b.entity || a.entity.toLowerCase() === b.entity.toLowerCase();
  return sameSender && sameSource && sameEntity && (!!a.sender === !!b.sender || !!a.entity === !!b.entity);
}

/** Current attachment edges of a proposition (evidence-for / refers-to). */
export function attachmentEdges(graph: Graph, propositionId: string): Edge[] {
  return graph.outEdges(propositionId).filter((e) => e.type === 'evidence-for' || e.type === 'refers-to');
}

/** Ensure person --plays-role--> object; returns the edge. */
export function ensureRole(graph: Graph, personId: string, objectId: string, role: string, t: ISODate, evidence?: string): Edge {
  const existing = graph.outEdges(personId, 'plays-role').find((e) => e.to === objectId);
  if (existing) return existing;
  const e: Edge = { id: newId('e'), from: personId, to: objectId, type: 'plays-role', t, conf: 0.9, role, evidence };
  graph.addEdge(e);
  return e;
}

export function applyCorrection(graph: Graph, input: CorrectionInput): CorrectionResult {
  const prop = graph.propositions.get(input.propositionId);
  if (!prop) throw new Error(`unknown proposition ${input.propositionId}`);
  const target = graph.obj(input.toObjectId);
  if (!target) throw new Error(`unknown object ${input.toObjectId}`);

  return graph.batch(() => {
    const fromObj = prop.attributedTo ?? null;
    const senderPerson = prop.source.sender ? graph.personByName(prop.source.sender) : undefined;

    // 1. Move the proposition.
    for (const e of attachmentEdges(graph, prop.id)) graph.removeEdge(e.id);
    const relation = prop.relation ?? (prop.source.source === 'message' ? 'refers-to' : 'evidence-for');
    graph.addEdge({ id: newId('e'), from: prop.id, to: target.id, type: relation, t: input.t, conf: 1, evidence: 'correction' });

    // 2. Sender role: add on target; drop on source only if nothing else of theirs remains there.
    if (senderPerson) {
      ensureRole(graph, senderPerson.id, target.id, 'participant', input.t, 'correction');
      if (fromObj && fromObj !== target.id) {
        const stillThere = graph.propositionsOf(fromObj).some((p) => p.id !== prop.id && p.source.sender === prop.source.sender);
        if (!stillThere) {
          for (const e of graph.outEdges(senderPerson.id, 'plays-role')) if (e.to === fromObj) graph.removeEdge(e.id);
        }
      }
    }

    // 3. Scope: repeat detection may upgrade instance → relation.
    let scope: Scope = input.scope;
    let upgradedFrom: Scope | undefined;
    let confirmed = input.confirmed;
    if (scope === 'instance' && senderPerson) {
      const priorSame = [...graph.corrections.values()].filter(
        (c) => c.scope === 'instance' && c.toObj === target.id && graph.propositions.get(c.item)?.source.sender === prop.source.sender && !c.supersededBy,
      );
      if (priorSame.length >= 1) {
        upgradedFrom = 'instance';
        scope = 'relation';
        confirmed = 'repeat';
      }
    }

    // 4. Predicate.
    let predicate: Predicate = input.predicate ?? {};
    if (scope === 'relation' && specificity(predicate) === 0) {
      predicate = prop.source.sender ? { sender: prop.source.sender } : { source: prop.source.source };
    }
    // Narrowest scope that explains the error: a routing rule toward a dated matter expires with the matter.
    const targetWhen = (target as { when?: ISODate }).when;
    if (scope === 'relation' && targetWhen && !predicate.timeWindow) {
      const end = addDays(`${targetWhen.slice(0, 10)}T23:59:59${targetWhen.slice(-6)}`, 1);
      predicate = { ...predicate, timeWindow: { from: input.t, to: end } };
    }
    if (scope === 'rule' && !predicate.entity) {
      const ent = input.ruleEntity ?? prop.entities[0];
      if (ent) predicate = { ...predicate, entity: ent };
    }
    const evidence = input.evidence ?? describePredicate(scope, predicate, prop);

    const correction: Correction = {
      id: newId('corr'),
      item: prop.id,
      fromObj,
      toObj: target.id,
      scope,
      predicate: scope === 'instance' ? {} : predicate,
      evidence,
      t: input.t,
      confirmed,
    };

    // 5. Materialize applies-to edge for relation/rule; supersede older overlapping rules pointing elsewhere.
    const superseded: string[] = [];
    if (scope !== 'instance' && specificity(predicate) > 0) {
      for (const e of graph.edgesOfType('applies-to')) {
        if (!e.predicate || e.to === target.id) continue;
        if (overlaps(e.predicate, predicate) && specificity(e.predicate) <= specificity(predicate)) {
          graph.removeEdge(e.id);
          const old = e.evidence ? graph.corrections.get(e.evidence) : undefined;
          if (old) {
            graph.addCorrection({ ...old, supersededBy: correction.id });
            superseded.push(old.id);
          }
        }
      }
      const anchor = scope === 'relation' && senderPerson ? senderPerson.id : prop.id;
      const edge: Edge = { id: newId('e'), from: anchor, to: target.id, type: 'applies-to', t: input.t, conf: 1, predicate, evidence: correction.id };
      graph.addEdge(edge);
      correction.edgeId = edge.id;
    }

    graph.addCorrection(correction);
    graph.upsertProposition({ ...prop, attributedTo: target.id, relation, status: 'attributed', attributionConf: 1, constrainedBy: correction.id });
    graph.addFeedback({ type: 'correct', target: prop.id, t: input.t });
    return { correction, upgradedFrom, superseded };
  });
}

function describePredicate(scope: Scope, p: Predicate, prop: Proposition): string {
  if (scope === 'instance') return `only this item (${prop.id})`;
  const parts: string[] = [];
  if (p.sender) parts.push(`sender = ${p.sender}`);
  if (p.source) parts.push(`source = ${p.source}`);
  if (p.entity) parts.push(`entity = ${p.entity}`);
  if (p.timeWindow) parts.push(`time in [${p.timeWindow.from.slice(0, 10)}, ${p.timeWindow.to.slice(0, 10)}]`);
  return parts.join(' ∧ ') || 'no predicate';
}

/**
 * A deleted or frozen proposition stops supporting what it supported: world-state transitions it evidenced are rolled
 * back to what they replaced, and their in-state edges go. Returns the matters touched.
 */
export function withdrawEvidence(graph: Graph, propositionId: string): string[] {
  const touched: string[] = [];
  for (const m of graph.matters()) {
    const removed = m.worldLog.filter((w) => w.evidence === propositionId);
    if (removed.length === 0) continue;
    const log = m.worldLog.filter((w) => w.evidence !== propositionId);
    const last = log[log.length - 1];
    const patch: Partial<Matter> = { worldLog: log, worldState: last?.state ?? removed[0]!.prevState ?? 'scheduled' };
    const resched = removed.find((w) => w.state === 'rescheduled' && w.prevWhen);
    if (resched && m.when === resched.when) patch.when = resched.prevWhen;
    graph.updateObject(m.id, patch);
    for (const e of graph.inEdges(m.id, 'in-state')) if (e.evidence === propositionId) graph.removeEdge(e.id);
    touched.push(m.id);
  }
  return touched;
}

export interface ConstraintLookup {
  constraints: ApplicableConstraint[];
  /** Two constraints of equal specificity disagree → never guess. */
  conflict: boolean;
}

/** Retrieve applicable constraints for an incoming proposition by walking applies-to edges. */
export function applicableConstraints(
  graph: Graph,
  prop: { sender?: string; source: EventSource; entities: string[]; t: ISODate; text?: string },
): ConstraintLookup {
  const hits: (ApplicableConstraint & { spec: number })[] = [];
  for (const e of graph.edgesOfType('applies-to')) {
    if (!e.predicate) continue;
    if (!predicateMatches(e.predicate, prop)) continue;
    const corr = e.evidence ? graph.corrections.get(e.evidence) : undefined;
    hits.push({
      correctionId: corr?.id ?? e.id,
      scope: corr?.scope ?? (e.predicate.entity ? 'rule' : 'relation'),
      toObj: e.to,
      evidence: corr?.evidence ?? describePredicate('relation', e.predicate, { entities: prop.entities } as Proposition),
      spec: specificity(e.predicate),
    });
  }
  if (hits.length === 0) return { constraints: [], conflict: false };
  hits.sort((a, b) => b.spec - a.spec);
  const top = hits[0]!.spec;
  const topHits = hits.filter((h) => h.spec === top);
  const targets = new Set(topHits.map((h) => h.toObj));
  return { constraints: hits.map(({ spec: _s, ...rest }) => rest), conflict: targets.size > 1 };
}
