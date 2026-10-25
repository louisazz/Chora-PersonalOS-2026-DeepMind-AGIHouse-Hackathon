/**
 * Life graph store. Pure TS, no DOM. Views do not own data: membership is derived from typed edges.
 */
import type {
  Correction,
  DomainId,
  Edge,
  Feedback,
  GraphObject,
  ISODate,
  Matter,
  ObjectType,
  Proposition,
  RelationType,
  Suggestion,
  ViewSpec,
  ComponentId,
} from '@/contract/types';

export interface StructureConflict {
  t: ISODate;
  viewId: string;
  component: ComponentId;
  subjectType: ObjectType;
  fallback: ComponentId;
}

export interface GraphSnapshot {
  objects: (GraphObject | Matter)[];
  edges: Edge[];
  propositions: Proposition[];
  corrections: Correction[];
  suggestions: Suggestion[];
  feedback: Feedback[];
  conflicts: StructureConflict[];
}

export type Listener = () => void;

export class Graph {
  objects = new Map<string, GraphObject | Matter>();
  edges = new Map<string, Edge>();
  propositions = new Map<string, Proposition>();
  corrections = new Map<string, Correction>();
  suggestions = new Map<string, Suggestion>();
  feedback: Feedback[] = [];
  conflicts: StructureConflict[] = [];
  private out = new Map<string, Set<string>>();
  private inc = new Map<string, Set<string>>();
  private listeners = new Set<Listener>();
  private batchDepth = 0;
  private dirty = false;

  // -------------------------------------------------------------------------
  // mutation
  // -------------------------------------------------------------------------
  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  batch<T>(fn: () => T): T {
    this.batchDepth += 1;
    try {
      return fn();
    } finally {
      this.batchDepth -= 1;
      if (this.batchDepth === 0 && this.dirty) {
        this.dirty = false;
        for (const l of this.listeners) l();
      }
    }
  }
  private emit(): void {
    if (this.batchDepth > 0) {
      this.dirty = true;
      return;
    }
    for (const l of this.listeners) l();
  }

  addObject(o: GraphObject | Matter): void {
    this.objects.set(o.id, o);
    this.emit();
  }
  updateObject(id: string, patch: Partial<GraphObject> & Partial<Matter>): void {
    const o = this.objects.get(id);
    if (!o) return;
    this.objects.set(id, { ...o, ...patch } as GraphObject | Matter);
    this.emit();
  }
  addEdge(e: Edge): void {
    this.edges.set(e.id, e);
    if (!this.out.has(e.from)) this.out.set(e.from, new Set());
    if (!this.inc.has(e.to)) this.inc.set(e.to, new Set());
    this.out.get(e.from)!.add(e.id);
    this.inc.get(e.to)!.add(e.id);
    this.emit();
  }
  removeEdge(id: string): void {
    const e = this.edges.get(id);
    if (!e) return;
    this.edges.delete(id);
    this.out.get(e.from)?.delete(id);
    this.inc.get(e.to)?.delete(id);
    this.emit();
  }
  upsertProposition(p: Proposition): void {
    this.propositions.set(p.id, p);
    this.emit();
  }
  addCorrection(c: Correction): void {
    this.corrections.set(c.id, c);
    this.emit();
  }
  upsertSuggestion(s: Suggestion): void {
    this.suggestions.set(s.id, s);
    this.emit();
  }
  addFeedback(f: Feedback): void {
    this.feedback.push(f);
    this.emit();
  }
  addConflict(c: StructureConflict): void {
    this.conflicts.push(c);
    this.emit();
  }

  // -------------------------------------------------------------------------
  // queries
  // -------------------------------------------------------------------------
  obj(id: string): GraphObject | Matter | undefined {
    return this.objects.get(id);
  }
  matter(id: string): Matter | undefined {
    const o = this.objects.get(id);
    return o && o.type === 'matter' ? (o as Matter) : undefined;
  }
  outEdges(id: string, type?: RelationType): Edge[] {
    const ids = this.out.get(id);
    if (!ids) return [];
    const res: Edge[] = [];
    for (const eid of ids) {
      const e = this.edges.get(eid);
      if (e && (!type || e.type === type)) res.push(e);
    }
    return res;
  }
  inEdges(id: string, type?: RelationType): Edge[] {
    const ids = this.inc.get(id);
    if (!ids) return [];
    const res: Edge[] = [];
    for (const eid of ids) {
      const e = this.edges.get(eid);
      if (e && (!type || e.type === type)) res.push(e);
    }
    return res;
  }
  edgesOfType(type: RelationType): Edge[] {
    const res: Edge[] = [];
    for (const e of this.edges.values()) if (e.type === type) res.push(e);
    return res;
  }
  objectsOfType<T extends GraphObject = GraphObject>(type: ObjectType): T[] {
    const res: T[] = [];
    for (const o of this.objects.values()) if (o.type === type) res.push(o as T);
    return res;
  }
  matters(): Matter[] {
    return this.objectsOfType<Matter>('matter');
  }
  domainActivity(domain: DomainId): GraphObject | undefined {
    for (const o of this.objects.values()) if (o.type === 'activity' && o.domain === domain) return o;
    return undefined;
  }
  /** Walk part-of edges upward until an activity with a domain is found. */
  domainOf(id: string, depth = 0): DomainId | undefined {
    const o = this.objects.get(id);
    if (!o || depth > 6) return undefined;
    if (o.type === 'activity' && o.domain) return o.domain;
    for (const e of this.outEdges(id, 'part-of')) {
      const d = this.domainOf(e.to, depth + 1);
      if (d) return d;
    }
    for (const e of this.outEdges(id, 'refers-to')) {
      const d = this.domainOf(e.to, depth + 1);
      if (d) return d;
    }
    return undefined;
  }
  personByName(name: string): GraphObject | undefined {
    const n = name.trim().toLowerCase();
    for (const o of this.objects.values()) {
      if (o.type !== 'person') continue;
      if (o.displayName.toLowerCase() === n) return o;
      if (o.aliases?.some((a) => a.toLowerCase() === n)) return o;
    }
    return undefined;
  }
  /** Propositions attached to an object (evidence-for or refers-to edges from the proposition). */
  propositionsOf(objectId: string): Proposition[] {
    const res: Proposition[] = [];
    for (const e of this.inEdges(objectId)) {
      if (e.type !== 'evidence-for' && e.type !== 'refers-to') continue;
      const p = this.propositions.get(e.from);
      if (p && p.status !== 'deleted') res.push(p);
    }
    res.sort((a, b) => new Date(a.t).getTime() - new Date(b.t).getTime());
    return res;
  }
  /** Live propositions: attributed and not frozen/deleted. */
  activePropositionsOf(objectId: string): Proposition[] {
    return this.propositionsOf(objectId).filter((p) => p.status === 'attributed');
  }
  peopleOf(objectId: string): { person: GraphObject; role: string }[] {
    const res: { person: GraphObject; role: string }[] = [];
    for (const e of this.inEdges(objectId, 'plays-role')) {
      const person = this.objects.get(e.from);
      if (person) res.push({ person, role: e.role ?? 'participant' });
    }
    return res;
  }
  /** Members of a view: typed traversal, never a free-form "related". */
  membersOf(view: ViewSpec): Set<string> {
    const members = new Set<string>();
    const root = view.organizingObjectId;
    if (view.kind === 'life' || view.kind === 'user-model') {
      for (const o of this.objects.values()) members.add(o.id);
      members.add('me');
      return members;
    }
    if (view.kind === 'work') {
      const work = this.domainActivity('work');
      if (work) for (const id of this.membersOf({ id: 'w', kind: 'domain', organizingObjectId: work.id })) members.add(id);
      return members;
    }
    if (view.kind === 'domain') {
      // direct part-of members, then objects that refer to those members (one hop), then people who play roles.
      const direct = this.inEdges(root, 'part-of').map((e) => e.from);
      for (const id of direct) members.add(id);
      for (const id of [...direct]) {
        for (const e of this.inEdges(id, 'refers-to')) {
          const o = this.objects.get(e.from);
          if (o && o.type !== 'person') members.add(e.from);
        }
        for (const e of this.inEdges(id, 'part-of')) members.add(e.from);
      }
      for (const id of [...members]) for (const e of this.inEdges(id, 'plays-role')) members.add(e.from);
      members.add(root);
      return members;
    }
    if (view.kind === 'matter') {
      members.add(root);
      for (const e of this.inEdges(root)) if (e.type === 'plays-role' || e.type === 'part-of' || e.type === 'refers-to') members.add(e.from);
      for (const e of this.outEdges(root, 'refers-to')) members.add(e.to);
      return members;
    }
    if (view.kind === 'person') {
      members.add(root);
      for (const e of this.outEdges(root, 'plays-role')) members.add(e.to);
      return members;
    }
    return members;
  }
  /** Matters a person plays a role in. */
  mattersOfPerson(personId: string): Matter[] {
    const res: Matter[] = [];
    for (const e of this.outEdges(personId, 'plays-role')) {
      const m = this.matter(e.to);
      if (m) res.push(m);
    }
    return res;
  }

  // -------------------------------------------------------------------------
  // snapshots (replay)
  // -------------------------------------------------------------------------
  snapshot(): GraphSnapshot {
    return structuredClone({
      objects: [...this.objects.values()],
      edges: [...this.edges.values()],
      propositions: [...this.propositions.values()],
      corrections: [...this.corrections.values()],
      suggestions: [...this.suggestions.values()],
      feedback: this.feedback,
      conflicts: this.conflicts,
    });
  }
  restore(s: GraphSnapshot): void {
    const c = structuredClone(s);
    this.objects = new Map(c.objects.map((o) => [o.id, o]));
    this.edges = new Map();
    this.out = new Map();
    this.inc = new Map();
    this.propositions = new Map(c.propositions.map((p) => [p.id, p]));
    this.corrections = new Map(c.corrections.map((x) => [x.id, x]));
    this.suggestions = new Map(c.suggestions.map((x) => [x.id, x]));
    this.feedback = c.feedback;
    this.conflicts = c.conflicts;
    this.batch(() => {
      for (const e of c.edges) this.addEdge(e);
    });
    this.emit();
  }
  clear(): void {
    this.restore({ objects: [], edges: [], propositions: [], corrections: [], suggestions: [], feedback: [], conflicts: [] });
  }
}
