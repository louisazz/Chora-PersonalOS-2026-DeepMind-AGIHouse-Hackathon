/** Data contract shared by every runtime (web, Android WebView, synth generator, eval). Display strings live in i18n.ts. */

export type ISODate = string; // ISO-8601 with timezone offset

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

/** Six typed, directed relations. No untyped "related". */
export type RelationType =
  | 'part-of' // X is a component/member of Y (order item → order; preference → activity)
  | 'plays-role' // person plays a situational role in Y (companion, coach, recruiter)
  | 'in-state' // matter is in a world state
  | 'refers-to' // a message/proposition/matter points at Y without owning it
  | 'evidence-for' // a proposition supports a node or an edge
  | 'applies-to'; // a correction rule applies to Y (scope lives in the predicate)

/** Life-graph node types. Only `matter` has stages. */
export type ObjectType =
  | 'person'
  | 'activity' // ongoing practice: music, fitness, work, travel ... (no endpoint; the "domain" rows)
  | 'goal'
  | 'preference'
  | 'experience'
  | 'item'
  | 'commitment'
  | 'matter';

/** Matter shapes are prototype fields, not strict classes: each matter carries a typicality. */
export type MatterShape = 'approaching-event' | 'deliverable' | 'decision-window';

/** World axis: describes the thing itself. Never mixed with system log or user stance. */
export type WorldState = 'scheduled' | 'happening' | 'past' | 'cancelled' | 'rescheduled';

/** User axis: the person's relation to the matter. */
export type UserStance = 'anticipating' | 'preparing' | 'in-progress' | 'reflecting';

/** Correction scope, narrowest explanation of the error wins. */
export type Scope = 'instance' | 'relation' | 'rule';

export type SilenceReason =
  | 'nothing-worth-saying'
  | 'budget' // suppressed by the structure/interrupt budget
  | 'low-conf'
  | 'bad-context' // e.g. in a meeting, late night
  | 'no-permission';

export type EmptyKind =
  | 'truly-empty'
  | 'no-match'
  | 'loading'
  | 'unavailable'
  | 'not-applicable'
  | 'no-permission'
  | 'unknown';

export type PropositionKind = 'fact' | 'habit' | 'request';

export type EventSource =
  | 'calendar'
  | 'message'
  | 'photo'
  | 'media' // now-playing / listening history
  | 'workout'
  | 'notification'
  | 'manual' // typed into the feed box
  | 'world'; // local static feed: show announcements, transit, weather

/** Situational context the policy conditions on. Inferred from signals, never a user toggle in product. */
export type ContextId = 'home' | 'commute' | 'desk' | 'meeting' | 'gym' | 'night';

/** Inferred intent, an input to policy (not a dial). */
export type Intent = 'glance' | 'plan-next' | 'review-trend' | 'recall';

/** Life domains shown on the Life page. Each is an `activity` object; this id is a stable key. */
export type DomainId =
  | 'study'
  | 'fitness'
  | 'travel'
  | 'health'
  | 'work'
  | 'games'
  | 'finance'
  | 'music'
  | 'family';

// ---------------------------------------------------------------------------
// Observation layer
// ---------------------------------------------------------------------------

export interface ObservedEvent {
  id: string;
  t: ISODate;
  source: EventSource;
  /** Sender as it appears on the device: contact name or raw number. */
  sender?: string;
  app?: string;
  /** Message body, notification body, calendar title, track "Artist — Title", photo caption. */
  text?: string;
  meta?: Record<string, string | number | boolean | null>;
}

// ---------------------------------------------------------------------------
// Representation layer
// ---------------------------------------------------------------------------

export type PropositionStatus =
  | 'pending'
  | 'attributed'
  | 'candidate-channel' // could not attach to any active object; kept at low priority
  | 'ask-user' // ambiguous or conflicting corrections; never guessed
  | 'dropped' // obviously worthless
  | 'frozen' // user froze it: kept but inert
  | 'deleted';

export interface Proposition {
  id: string;
  text: string;
  conf: number;
  kind: PropositionKind;
  source: { eventId: string; source: EventSource; sender?: string; app?: string };
  t: ISODate;
  /** Surface strings mentioned: band, venue, person, place, thing. */
  entities: string[];
  /** A date the proposition talks about (not when it was observed). */
  dateRef?: ISODate;
  /** Attribution result. */
  attributedTo?: string;
  relation?: RelationType;
  attributionConf?: number;
  status: PropositionStatus;
  /** Candidate object ids considered, for the rationale panel and for replay. */
  candidates?: { objectId: string; score: number }[];
  /** Id of the correction that constrained this attribution, if any. */
  constrainedBy?: string;
}

export interface GraphObject {
  id: string;
  type: ObjectType;
  displayName: string;
  createdAt: ISODate;
  /** Only for `activity` nodes that are life domains. */
  domain?: DomainId;
  aliases?: string[];
  attrs?: Record<string, string | number | boolean | null>;
}

export interface WorldStateChange {
  state: WorldState;
  t: ISODate;
  /** Proposition id or text explaining the transition. */
  evidence: string;
  when?: ISODate; // new date for reschedules
  /** What the transition replaced, so withdrawing its evidence can roll it back. */
  prevWhen?: ISODate;
  prevState?: WorldState;
}

export type SystemAction = 'reminded' | 'suggested' | 'executed' | 'silenced' | 'asked';

export interface SystemLogEntry {
  action: SystemAction;
  t: ISODate;
  detail: string;
  silenceReason?: SilenceReason;
  /** The suggestion interrupted (urgency ≥ 0.9): counts against the day's interrupt budget once, not per redraw. */
  interrupt?: boolean;
}

export interface Matter extends GraphObject {
  type: 'matter';
  shape: MatterShape;
  /** 0..1 — how typical an instance of its shape it is. Low typicality stays in the candidate channel. */
  typicality: number;
  worldState: WorldState;
  worldLog: WorldStateChange[];
  systemLog: SystemLogEntry[];
  userStance: UserStance;
  /** For approaching events: when; for deliverables/decisions: the deadline. */
  when?: ISODate;
  place?: string;
}

export interface Edge {
  id: string;
  from: string;
  to: string;
  type: RelationType;
  t: ISODate;
  conf: number;
  /** plays-role: the role name (companion, coach, recruiter, organizer). */
  role?: string;
  /** in-state: the state asserted. */
  state?: WorldState;
  /** applies-to: scope predicate of a correction rule. */
  predicate?: Predicate;
  /** evidence-for / refers-to: proposition id, or correction id for applies-to. */
  evidence?: string;
}

/** Conjunctive predicate used by relation- and rule-level corrections. */
export interface Predicate {
  sender?: string;
  source?: EventSource;
  entity?: string;
  timeWindow?: { from: ISODate; to: ISODate };
}

export interface Correction {
  id: string;
  /** Proposition id that was moved. */
  item: string;
  fromObj: string | null;
  toObj: string;
  scope: Scope;
  predicate: Predicate;
  /** Human-readable evidence, e.g. "sender = B". */
  evidence: string;
  t: ISODate;
  confirmed: 'default' | 'user' | 'repeat';
  /** Materialized applies-to edge id for relation/rule scope. */
  edgeId?: string;
  supersededBy?: string;
}

// ---------------------------------------------------------------------------
// Policy layer
// ---------------------------------------------------------------------------

export type ActionIntent =
  | 'calendar.reminder'
  | 'alarm.set'
  | 'open.link'
  | 'share'
  | 'check.gear'
  | 'leave.by'
  | 'reply';

export interface SuggestedAction {
  label: string;
  intent: ActionIntent;
  args: Record<string, string>;
}

export interface Rationale {
  /** Proposition ids or short sentences the suggestion rests on. */
  because: string[];
  context: ContextId;
  conf: number;
  urgency: number;
  /** Candidates that lost or were suppressed, with the reason. */
  suppressed?: { objectId: string; title: string; reason: SilenceReason | 'outscored' }[];
}

export interface Suggestion {
  id: string;
  objectId: string;
  title: string;
  action?: SuggestedAction;
  conf: number;
  urgency: number;
  rationale: Rationale;
  shown: boolean;
  silenceReason?: SilenceReason;
  /** Proposition ids this suggestion is derived from; deleting any of them re-evaluates it. */
  derivedFrom: string[];
  context: ContextId;
  t: ISODate;
}

export type ViewKind = 'life' | 'domain' | 'matter' | 'person' | 'work' | 'user-model';

export interface ViewSpec {
  id: string;
  kind: ViewKind;
  organizingObjectId: string;
}

export type ComponentId =
  | 'suggestion-card'
  | 'object-row'
  | 'matter-header'
  | 'timeline'
  | 'checklist'
  | 'map-card'
  | 'photo-wall'
  | 'curve'
  | 'action-button'
  | 'silence-note'
  | 'empty-state'
  | 'requirement-card'
  | 'todo-row'
  | 'conversation-ref'
  | 'proposition-row'
  | 'ask-card';

export interface Slot {
  id: string;
  /** Which layout region of the view grammar this slot sits in. */
  region: string;
  component: ComponentId;
  /** The object this slot is about. The semantic-subject test reads this. */
  subjectId: string;
  /** Relative visual weight 1..3 (largest area wins the subject test). */
  area: 1 | 2 | 3;
  props: Record<string, unknown>;
  /** Where a tap goes (view id) — the fourth subject signal. */
  tapTo?: string;
  /** Primary action target object — the third subject signal. */
  actionTarget?: string;
}

export type DiffOp =
  | { kind: 'content'; slotId: string; props: Record<string, unknown> }
  | { kind: 'structure'; op: 'add'; slot: Slot; index: number }
  | { kind: 'structure'; op: 'remove'; slotId: string }
  | { kind: 'structure'; op: 'move'; slotId: string; index: number }
  | { kind: 'structure'; op: 'replace'; slotId: string; component: ComponentId }
  | { kind: 'interrupt'; suggestionId: string };

export interface SurfacePlan {
  viewId: string;
  organizingObjectId: string;
  version: number;
  /** Replay time at which this plan was computed (budget accounting is per day). */
  plannedAt?: ISODate;
  slots: Slot[];
  lastDiff: DiffOp[];
  structureBudgetUsed: number;
  structureBudget: number;
  /** Structural ops deferred because the budget was exhausted; applied on next deliberate entry. */
  deferred: DiffOp[];
  /** Why this plan: which candidate won, which were vetoed by the subject test. */
  rationale: { chosen: string; vetoed: { candidate: string; reason: string }[]; scored: { candidate: string; score: number }[]; conflicts?: string[] };
  density: 0 | 1 | 2 | 3;
  context: ContextId;
  intent: Intent;
}

export type FeedbackType = 'tap' | 'dismiss' | 'undo' | 'more' | 'less' | 'correct';

export interface Feedback {
  type: FeedbackType;
  target: string;
  t: ISODate;
}

// ---------------------------------------------------------------------------
// Adapter contracts (the three fork points). Every tool schema ≤ 4 fields.
// ---------------------------------------------------------------------------

export interface ExtractedProposition {
  text: string;
  conf: number;
  entities: string[];
  kind: PropositionKind;
}

export interface ExtractRequest {
  event: ObservedEvent;
  knownEntities: string[];
  today: ISODate;
}

export interface ExtractResponse {
  propositions: ExtractedProposition[];
  /** 'drop' when the event is obviously worthless (marketing, system noise). */
  verdict: 'keep' | 'drop';
  dateRef?: ISODate;
  /** World-axis transition the event asserts (reschedule / cancel), if any. */
  worldState?: WorldState;
}

export interface CandidateObject {
  objectId: string;
  type: ObjectType;
  displayName: string;
  summary: string;
  score: number;
  /** Matters: when they happen / are due. Lets a confirmer tell "same event" from "new event". */
  when?: ISODate;
  /** Decomposed retrieval evidence: lexical = non-person entity overlap, structural = roles/time/source priors, semantic = embedding. */
  signals?: { lexical: number; structural: number; semantic: number; facets?: number };
}

export interface ApplicableConstraint {
  correctionId: string;
  scope: Scope;
  toObj: string;
  evidence: string;
}

export interface ConfirmRequest {
  proposition: ExtractedProposition & { t: ISODate; sender?: string; source: EventSource };
  candidates: CandidateObject[];
  constraints: ApplicableConstraint[];
  today: ISODate;
}

export interface ConfirmResponse {
  /** candidate object id, 'new' to create, 'none' to leave unattached. */
  objectId: string;
  relation: RelationType;
  conf: number;
  newObject?: { type: ObjectType; displayName: string; shape?: MatterShape; when?: ISODate; place?: string };
}

export interface InferenceStats {
  calls: number;
  totalMs: number;
  lastMs: number;
  lastTokensPerSec?: number;
  loadMs?: number;
  backend: string;
}

export interface InferenceAdapter {
  readonly name: string;
  readonly kind: 'oracle' | 'rules' | 'model';
  ready(): Promise<void>;
  extract(req: ExtractRequest): Promise<ExtractResponse>;
  confirm(req: ConfirmRequest): Promise<ConfirmResponse>;
  stats(): InferenceStats;
}

export interface EmbeddingAdapter {
  readonly name: string;
  readonly dim: number;
  ready(): Promise<void>;
  embed(texts: string[], mode: 'query' | 'document'): Promise<Float32Array[]>;
  stats(): InferenceStats;
}

export interface ExecutionAdapter {
  readonly name: string;
  execute(action: SuggestedAction): Promise<{ ok: boolean; detail: string }>;
}

export interface ObservationAdapter {
  readonly name: string;
  /** Pull the next batch of events at or before `until`. */
  pull(until: ISODate): Promise<ObservedEvent[]>;
}

// ---------------------------------------------------------------------------
// Fixture (synth output). One JSON read by every runtime.
// ---------------------------------------------------------------------------

export interface EventAnnotation {
  eventId: string;
  /** 'noise' | 'ambiguous' | 'contradiction' | 'signal' */
  cls: 'noise' | 'ambiguous' | 'contradiction' | 'signal';
  /** Ground-truth object id this event is about, if any (skeleton id, stable across runs). */
  objectId?: string;
  /** Other homes a reasonable system may choose for an ambiguous event (scored as acceptable, not wrong). */
  acceptable?: string[];
  /** Display names of objects the system may legitimately create and attach to (e.g. a preference named after an artist). */
  acceptableNamed?: string[];
  /** Oracle propositions (what a perfect extractor would say). */
  propositions: ExtractedProposition[];
  dateRef?: ISODate;
  /** For world-state changes. */
  worldState?: WorldState;
  /** Membership of a correction triple test. */
  triple?: { correctionKey: string; role: 'in-scope' | 'out-of-scope' | 'ambiguous' };
}

export interface Fixture {
  version: 1;
  generatedAt: ISODate;
  persona: PersonaSummary;
  /** Days covered. */
  from: ISODate;
  to: ISODate;
  /** Objects that exist before day 1 (seed: domains, friends, preferences, standing goals). */
  seedObjects: GraphObject[];
  seedEdges: Edge[];
  /** Habit propositions that exist before day 1, already attributed (edges included in seedEdges). */
  seedPropositions: Proposition[];
  /** Matters the story expects to be created later (by the system or by a user correction). Templates for the UI. */
  matterTemplates: MatterTemplate[];
  events: ObservedEvent[];
  annotations: EventAnnotation[];
  /** Day-by-day expectations derived from the skeleton: which suggestions should surface / stay silent. */
  expectations: DailyExpectation[];
  /** Scripted corrections used by replay and the triple tests. */
  corrections: CorrectionScript[];
}

export interface MatterTemplate {
  id: string;
  title: string;
  shape: MatterShape;
  when?: ISODate;
  place?: string;
  domain: DomainId;
  entities: string[];
}

export interface PersonaSummary {
  name: string;
  city: string;
  timezone: string;
  seed: number;
}

export interface DailyExpectation {
  date: ISODate;
  context: ContextId;
  shouldSurface: { objectId: string; why: string }[];
  shouldStaySilent: { objectId: string; reason: SilenceReason }[];
}

export interface CorrectionScript {
  key: string;
  /** Event whose proposition the user will move. */
  eventId: string;
  fromObjectId: string;
  toObjectId: string;
  scope: Scope;
  predicate: Predicate;
  evidence: string;
}
