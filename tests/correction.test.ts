import { describe, expect, it } from 'vitest';
import { Graph } from '@/core/graph';
import { applyCorrection, applicableConstraints } from '@/core/correction';
import type { Edge, GraphObject, Matter, Proposition } from '@/contract/types';

function matter(id: string, name: string, when: string): Matter {
  return { id, type: 'matter', displayName: name, createdAt: '2026-10-25T00:00:00-07:00', shape: 'approaching-event', typicality: 0.9, worldState: 'scheduled', worldLog: [], systemLog: [], userStance: 'anticipating', when };
}
function person(id: string, name: string): GraphObject {
  return { id, type: 'person', displayName: name, createdAt: '2026-10-25T00:00:00-07:00' };
}
function prop(id: string, text: string, sender: string, t: string, entities: string[] = []): Proposition {
  return { id, text, conf: 0.8, kind: 'request', source: { eventId: 'e', source: 'message', sender }, t, entities: [sender, ...entities], status: 'attributed' };
}
function edge(from: string, to: string, type: Edge['type']): Edge {
  return { id: `e_${from}_${to}`, from, to, type, t: '2026-10-25T00:00:00-07:00', conf: 1 };
}

function setup() {
  const g = new Graph();
  g.addObject(matter('mA', 'Show A', '2026-11-08T20:00:00-08:00'));
  g.addObject(matter('mB', 'Show B', '2026-11-15T19:30:00-08:00'));
  g.addObject(person('pBen', 'Ben'));
  g.addObject(person('pAlex', 'Alex'));
  const p1 = prop('p1', 'Ben: got the tickets', 'Ben', '2026-10-30T13:20:00-07:00', ['tickets']);
  g.upsertProposition({ ...p1, attributedTo: 'mA', relation: 'refers-to', attributionConf: 0.6 });
  g.addEdge(edge('p1', 'mA', 'refers-to'));
  g.addEdge({ ...edge('pBen', 'mA', 'plays-role'), role: 'participant' });
  return g;
}

describe('corrections are scoped constraints', () => {
  it('instance scope moves one proposition and the sender role, no applies-to edge', () => {
    const g = setup();
    const r = applyCorrection(g, { propositionId: 'p1', toObjectId: 'mB', scope: 'instance', t: '2026-10-30T14:00:00-07:00', confirmed: 'user' });
    expect(r.correction.scope).toBe('instance');
    expect(g.propositions.get('p1')!.attributedTo).toBe('mB');
    expect(g.outEdges('pBen', 'plays-role').map((e) => e.to)).toEqual(['mB']);
    expect(g.edgesOfType('applies-to')).toHaveLength(0);
    // nothing applies to Ben's next message
    const look = applicableConstraints(g, { sender: 'Ben', source: 'message', entities: ['Ben'], t: '2026-11-02T18:00:00-08:00' });
    expect(look.constraints).toHaveLength(0);
  });

  it('relation scope materializes an applies-to edge that fires for the sender only, bounded by the matter date', () => {
    const g = setup();
    const r = applyCorrection(g, { propositionId: 'p1', toObjectId: 'mB', scope: 'relation', t: '2026-10-30T14:00:00-07:00', confirmed: 'user' });
    expect(r.correction.scope).toBe('relation');
    expect(r.correction.predicate.sender).toBe('Ben');
    expect(r.correction.predicate.timeWindow?.to.slice(0, 10)).toBe('2026-11-16');
    const edges = g.edgesOfType('applies-to');
    expect(edges).toHaveLength(1);
    expect(edges[0]!.from).toBe('pBen');
    expect(edges[0]!.to).toBe('mB');
    // in scope: Ben, before the show
    expect(applicableConstraints(g, { sender: 'Ben', source: 'message', entities: ['Ben'], t: '2026-11-02T18:00:00-08:00' }).constraints.map((c) => c.toObj)).toEqual(['mB']);
    // out of scope: Alex
    expect(applicableConstraints(g, { sender: 'Alex', source: 'message', entities: ['Alex'], t: '2026-11-02T18:00:00-08:00' }).constraints).toHaveLength(0);
    // out of scope: Ben, after the show has passed
    expect(applicableConstraints(g, { sender: 'Ben', source: 'message', entities: ['Ben'], t: '2026-11-20T18:00:00-08:00' }).constraints).toHaveLength(0);
  });

  it('rule scope keys on an entity and also matches the entity inside the text', () => {
    const g = setup();
    applyCorrection(g, { propositionId: 'p1', toObjectId: 'mB', scope: 'rule', ruleEntity: 'tickets', t: '2026-10-30T14:00:00-07:00', confirmed: 'user' });
    const hit = applicableConstraints(g, { sender: 'Alex', source: 'message', entities: ['Alex'], t: '2026-11-01T10:00:00-07:00', text: 'any spare tickets?' });
    expect(hit.constraints.map((c) => c.toObj)).toEqual(['mB']);
    const miss = applicableConstraints(g, { sender: 'Alex', source: 'message', entities: ['Alex'], t: '2026-11-01T10:00:00-07:00', text: 'see you there' });
    expect(miss.constraints).toHaveLength(0);
  });

  it('a second instance correction for the same sender → target auto-upgrades to relation', () => {
    const g = setup();
    applyCorrection(g, { propositionId: 'p1', toObjectId: 'mB', scope: 'instance', t: '2026-10-30T14:00:00-07:00', confirmed: 'user' });
    const p2 = prop('p2', 'Ben: what time?', 'Ben', '2026-11-01T10:00:00-07:00');
    g.upsertProposition({ ...p2, attributedTo: 'mA', relation: 'refers-to' });
    g.addEdge(edge('p2', 'mA', 'refers-to'));
    const r = applyCorrection(g, { propositionId: 'p2', toObjectId: 'mB', scope: 'instance', t: '2026-11-01T10:05:00-07:00', confirmed: 'user' });
    expect(r.upgradedFrom).toBe('instance');
    expect(r.correction.scope).toBe('relation');
    expect(r.correction.confirmed).toBe('repeat');
    expect(g.edgesOfType('applies-to')).toHaveLength(1);
  });

  it('two equally specific rules that disagree are a conflict: never guess', () => {
    const g = setup();
    g.addObject(matter('mC', 'Show C', '2026-11-20T20:00:00-08:00'));
    applyCorrection(g, { propositionId: 'p1', toObjectId: 'mB', scope: 'relation', t: '2026-10-30T14:00:00-07:00', confirmed: 'user' });
    // simulate a contradicting rule of equal specificity (different predicate key so it is not superseded)
    g.addEdge({ id: 'x', from: 'p1', to: 'mC', type: 'applies-to', t: '2026-10-31T00:00:00-07:00', conf: 1, predicate: { entity: 'tickets', timeWindow: { from: '2026-10-31T00:00:00-07:00', to: '2026-11-30T00:00:00-08:00' } } });
    const look = applicableConstraints(g, { sender: 'Ben', source: 'message', entities: ['Ben', 'tickets'], t: '2026-11-02T18:00:00-08:00' });
    expect(look.conflict).toBe(true);
  });
});
