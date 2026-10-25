/**
 * Persona skeleton: the single source of truth for synthetic data.
 * Events, annotations, expectations and correction scripts are all DERIVED from this by generate.ts.
 * Everything persona-specific (band, venues, friends, gym, commute) is a parameter here, never in core.
 */
import type { ContextId, DomainId, EventSource, Scope, Predicate, MatterShape } from '@/contract/types';

export interface SkeletonPerson {
  id: string;
  name: string; // how they appear as a sender on the device
  role: string; // friend | coach | pm | designer | family | unknown
}

export interface SkeletonMatter {
  id: string;
  title: string;
  shape: MatterShape;
  domain: DomainId;
  /** Local wall-clock [y, m, d, hh, mm]. */
  when?: [number, number, number, number, number];
  place?: string;
  /** Exists before day 1 (seeded) or must be discovered from events. */
  seeded: boolean;
  /** Entity strings this matter is about (used for ground truth, never read by core). */
  entities: string[];
  participants?: { personId: string; role: string }[];
  refersTo?: string[]; // ids of preferences/goals it refers to
  typicality?: number;
  attrs?: Record<string, string | number | boolean | null>;
}

/** A scripted event in the story. `day` is 0-based from the fixture start. */
export interface ScriptedEvent {
  key: string;
  day: number;
  time: [number, number];
  source: EventSource;
  senderId?: string;
  app?: string;
  text: string;
  meta?: Record<string, string | number | boolean | null>;
  /** Ground truth. */
  about?: string; // matter/object id, or undefined when noise
  acceptable?: string[];
  cls: 'signal' | 'ambiguous' | 'contradiction' | 'noise';
  propositions: { text: string; conf: number; entities: string[]; kind: 'fact' | 'habit' | 'request' }[];
  dateRef?: [number, number, number, number, number];
  worldState?: 'scheduled' | 'happening' | 'past' | 'cancelled' | 'rescheduled';
  /** Role in a correction triple. */
  triple?: { correctionKey: string; role: 'in-scope' | 'out-of-scope' | 'ambiguous' };
}

export interface ScriptedCorrection {
  key: string;
  eventKey: string;
  fromMatterId: string;
  toMatterId: string;
  scope: Scope;
  predicate: Predicate;
  evidence: string;
}

export interface DailyPlan {
  day: number;
  /** Context by hour window, used for expectations. */
  contexts: { from: number; to: number; ctx: ContextId }[];
  shouldSurface: { hour: number; objectId: string; why: string }[];
  shouldStaySilent: { hour: number; objectId: string; reason: 'bad-context' | 'low-conf' | 'budget' | 'nothing-worth-saying' }[];
}

export interface PersonaSkeleton {
  name: string;
  city: string;
  timezone: string;
  seed: number;
  /** Fixture start day (local), inclusive; 14 days. */
  start: [number, number, number];
  days: number;
  people: SkeletonPerson[];
  domains: DomainId[];
  preferences: { id: string; name: string; domain: DomainId; aliases?: string[] }[];
  goals: { id: string; title: string; domain: DomainId }[];
  activities: { id: string; title: string; domain: DomainId; cadence?: string }[];
  commitments: { id: string; title: string; domain: DomainId; status: string }[];
  habits: { text: string; entities: string[] }[];
  matters: SkeletonMatter[];
  script: ScriptedEvent[];
  corrections: ScriptedCorrection[];
  dailyPlan: DailyPlan[];
  /** Noise vocab. */
  noise: {
    otherArtists: string[];
    marketingApps: string[];
    systemNotifs: string[];
    calendarNoise: string[];
    photoCaptions: string[];
    familyMessages: string[];
    workNoise: string[];
  };
  commute: { line: string; station: string; departure: string; leaveBy: string };
}

// ---------------------------------------------------------------------------
// Default persona: Bay Area, two Sunset Rollercoaster shows, Boxing + November half marathon, BART commute.
// ---------------------------------------------------------------------------

const P = {
  A: 'p_alex',
  B: 'p_ben',
  COACH: 'p_marcus',
  PM: 'p_jess',
  DESIGN: 'p_sam',
  MOM: 'p_mom',
  UNKNOWN: 'p_unknown',
};

const M = {
  FILLMORE: 'm_fillmore',
  GREEK: 'm_greek',
  HALF: 'm_half',
  REQ_INTERVIEWS: 'm_req_interviews',
  REQ_FORM: 'm_req_form',
  REQ_LAZY: 'm_req_lazy',
};

export const defaultPersona: PersonaSkeleton = {
  name: 'Lou',
  city: 'San Francisco',
  timezone: 'America/Los_Angeles',
  seed: 20261024,
  start: [2026, 10, 25], // Sunday
  days: 14, // through Sat 11/07
  people: [
    { id: P.A, name: 'Alex Chen', role: 'friend' },
    { id: P.B, name: 'Ben Park', role: 'friend' },
    { id: P.COACH, name: 'Marcus (Coach)', role: 'coach' },
    { id: P.PM, name: 'Jess (PM)', role: 'pm' },
    { id: P.DESIGN, name: 'Sam Rivera', role: 'designer' },
    { id: P.MOM, name: 'Mom', role: 'family' },
    { id: P.UNKNOWN, name: '+1 (415) 555-0199', role: 'unknown' },
  ],
  domains: ['study', 'fitness', 'travel', 'health', 'work', 'games', 'finance', 'music'],
  preferences: [
    { id: 'pref_sunset', name: 'Sunset Rollercoaster', domain: 'music' },
    { id: 'pref_menitrust', name: 'Men I Trust', domain: 'music' },
  ],
  goals: [{ id: 'g_half', title: 'Finish the November half marathon', domain: 'fitness' }],
  activities: [{ id: 'a_boxing', title: 'Boxing', domain: 'fitness', cadence: 'Tue/Thu 19:00' }],
  commitments: [
    { id: 'c_o1a', title: 'Sort O-1A application materials', domain: 'work', status: '3 items left' },
    { id: 'c_snacks', title: 'Bring snacks for the team', domain: 'work', status: 'not bought yet' },
    { id: 'c_package', title: 'Pick up package from office locker', domain: 'work', status: 'locker 21, code 075514' },
  ],
  habits: [
    { text: 'Boxing class on Tuesday and Thursday evenings at 19:00', entities: ['Boxing'] },
    { text: 'Takes BART home from Montgomery around 18:42 on weekdays', entities: ['BART', 'Montgomery'] },
    { text: 'Long run on Saturday mornings', entities: ['run'] },
  ],
  matters: [
    {
      id: M.FILLMORE,
      title: 'Sunset Rollercoaster at The Fillmore',
      shape: 'approaching-event',
      domain: 'music',
      when: [2026, 11, 8, 20, 0],
      place: 'The Fillmore, San Francisco',
      seeded: false,
      entities: ['Sunset Rollercoaster', 'Fillmore', 'The Fillmore'],
      participants: [{ personId: P.A, role: 'companion' }],
      refersTo: ['pref_sunset'],
    },
    {
      id: M.GREEK,
      title: 'Sunset Rollercoaster at The Greek Theatre',
      shape: 'approaching-event',
      domain: 'music',
      when: [2026, 11, 15, 19, 30],
      place: 'The Greek Theatre, Berkeley',
      seeded: false,
      entities: ['Sunset Rollercoaster', 'Greek', 'Greek Theatre', 'Berkeley'],
      participants: [{ personId: P.B, role: 'companion' }],
      refersTo: ['pref_sunset'],
    },
    {
      id: M.HALF,
      title: 'SF Half Marathon',
      shape: 'approaching-event',
      domain: 'fitness',
      when: [2026, 11, 22, 7, 0],
      place: 'Golden Gate Park, San Francisco',
      seeded: true,
      entities: ['half marathon', 'half', 'race'],
      participants: [{ personId: P.COACH, role: 'coach' }],
      refersTo: ['g_half'],
      attrs: { registered: true },
    },
    {
      id: M.REQ_INTERVIEWS,
      title: 'User interviews',
      shape: 'deliverable',
      domain: 'work',
      when: [2026, 11, 13, 17, 0],
      seeded: true,
      entities: ['user interviews', 'interviews'],
      participants: [{ personId: P.PM, role: 'owner' }],
      attrs: { status: 'in-progress' },
    },
    {
      id: M.REQ_FORM,
      title: 'New product form exploration',
      shape: 'deliverable',
      domain: 'work',
      when: [2026, 11, 20, 17, 0],
      seeded: true,
      entities: ['product form', 'form exploration'],
      participants: [{ personId: P.DESIGN, role: 'collaborator' }],
      attrs: { status: 'in-progress' },
    },
    {
      id: M.REQ_LAZY,
      title: 'Lazy new feature',
      shape: 'deliverable',
      domain: 'work',
      seeded: true,
      entities: ['Lazy', 'Lazy feature'],
      attrs: { status: 'not-started' },
      typicality: 0.6,
    },
  ],
  script: [
    // ---- Music thread -------------------------------------------------------
    {
      key: 'media_k1',
      day: 0,
      time: [21, 10],
      source: 'media',
      app: 'Spotify',
      text: 'Sunset Rollercoaster — My Jinji',
      cls: 'signal',
      about: 'pref_sunset',
      propositions: [{ text: 'Listens to Sunset Rollercoaster', conf: 0.7, entities: ['Sunset Rollercoaster'], kind: 'habit' }],
    },
    {
      key: 'a_invite',
      day: 1,
      time: [12, 40],
      source: 'message',
      senderId: P.A,
      app: 'Messages',
      text: 'Sunset Rollercoaster is playing the Fillmore on Sat Nov 8 — want to go together? I can grab presale.',
      cls: 'signal',
      about: M.FILLMORE,
      propositions: [
        { text: 'Alex Chen invites to Sunset Rollercoaster at The Fillmore on Sat Nov 8', conf: 0.9, entities: ['Alex Chen', 'Sunset Rollercoaster', 'The Fillmore'], kind: 'request' },
      ],
      dateRef: [2026, 11, 8, 20, 0],
    },
    {
      key: 'media_k2',
      day: 2,
      time: [8, 15],
      source: 'media',
      app: 'Spotify',
      text: 'Sunset Rollercoaster — Summum Bonum',
      cls: 'signal',
      about: 'pref_sunset',
      propositions: [{ text: 'Listens to Sunset Rollercoaster', conf: 0.7, entities: ['Sunset Rollercoaster'], kind: 'habit' }],
    },
    {
      key: 'world_fillmore_onsale',
      day: 4,
      time: [11, 0],
      source: 'world',
      app: 'Shows',
      text: 'Sunset Rollercoaster — The Fillmore, San Francisco, Sat Nov 8. Tickets on sale Fri Oct 30, 10:00 AM.',
      cls: 'signal',
      about: M.FILLMORE,
      propositions: [{ text: 'Tickets for Sunset Rollercoaster at The Fillmore go on sale Fri Oct 30 10:00', conf: 0.95, entities: ['Sunset Rollercoaster', 'The Fillmore'], kind: 'fact' }],
      dateRef: [2026, 10, 30, 10, 0],
      meta: { kind: 'onsale', onsaleAt: '2026-10-30T10:00' },
    },
    {
      key: 'world_greek_added',
      day: 7,
      time: [11, 5],
      source: 'world',
      app: 'Shows',
      text: 'Sunset Rollercoaster — The Greek Theatre, Berkeley, Sun Nov 15. Doors 6:30 PM.',
      cls: 'signal',
      about: M.GREEK, // the Greek matter exists by now (created through the user's correction on day 5)
      propositions: [{ text: 'Sunset Rollercoaster plays The Greek Theatre in Berkeley on Sun Nov 15', conf: 0.9, entities: ['Sunset Rollercoaster', 'The Greek Theatre', 'Berkeley'], kind: 'fact' }],
      dateRef: [2026, 11, 15, 19, 30],
    },
    {
      key: 'b_tickets',
      day: 5,
      time: [13, 20],
      source: 'message',
      senderId: P.B,
      app: 'Messages',
      text: 'Got the tickets!! Send me your ID photo before the 12th so I can transfer yours.',
      cls: 'ambiguous',
      about: M.GREEK,
      propositions: [{ text: 'Ben Park bought tickets and needs an ID photo before Nov 12', conf: 0.85, entities: ['Ben Park', 'tickets', 'ID'], kind: 'request' }],
      dateRef: [2026, 11, 12, 23, 59],
    },
    {
      key: 'media_k3',
      day: 6,
      time: [19, 30],
      source: 'media',
      app: 'Spotify',
      text: 'Sunset Rollercoaster — Candlelight',
      cls: 'signal',
      about: 'pref_sunset',
      propositions: [{ text: 'Listens to Sunset Rollercoaster', conf: 0.7, entities: ['Sunset Rollercoaster'], kind: 'habit' }],
    },
    {
      key: 'b_meet',
      day: 8,
      time: [18, 5],
      source: 'message',
      senderId: P.B,
      app: 'Messages',
      text: 'What time should we meet in Berkeley? Thinking 6 at Downtown Berkeley BART then walk up.',
      cls: 'signal',
      about: M.GREEK,
      propositions: [{ text: 'Ben Park proposes meeting at Downtown Berkeley BART at 18:00 before the show', conf: 0.85, entities: ['Ben Park', 'Berkeley', 'BART'], kind: 'request' }],
      triple: { correctionKey: 'b_to_greek', role: 'in-scope' },
    },
    {
      key: 'a_reschedule',
      day: 9,
      time: [10, 25],
      source: 'message',
      senderId: P.A,
      app: 'Messages',
      text: 'Heads up — the Fillmore show got moved to Sunday the 9th, same time. Still good?',
      cls: 'contradiction',
      about: M.FILLMORE,
      propositions: [{ text: 'The Fillmore show is rescheduled to Sun Nov 9, same time', conf: 0.9, entities: ['The Fillmore', 'Alex Chen'], kind: 'fact' }],
      dateRef: [2026, 11, 9, 20, 0],
      worldState: 'rescheduled',
      triple: { correctionKey: 'b_to_greek', role: 'out-of-scope' },
    },
    {
      key: 'unknown_extra',
      day: 11,
      time: [16, 45],
      source: 'message',
      senderId: P.UNKNOWN,
      app: 'Messages',
      text: 'hey it’s Dana from the run club — are you going to Sunset Rollercoaster? which night?',
      cls: 'ambiguous',
      about: undefined,
      propositions: [{ text: 'Dana asks which Sunset Rollercoaster night the user is going to', conf: 0.6, entities: ['Sunset Rollercoaster', 'Dana'], kind: 'request' }],
      triple: { correctionKey: 'b_to_greek', role: 'ambiguous' },
    },
    // ---- Fitness thread -----------------------------------------------------
    {
      key: 'cal_boxing_tue1',
      day: 2,
      time: [7, 0],
      source: 'calendar',
      app: 'Calendar',
      text: 'Boxing — 3rd Street Gym',
      meta: { start: '2026-10-27T19:00', end: '2026-10-27T20:00', location: '3rd Street Gym, Dogpatch' },
      cls: 'signal',
      about: 'a_boxing',
      propositions: [{ text: 'Boxing class Tue Oct 27 19:00 at 3rd Street Gym', conf: 0.9, entities: ['Boxing', '3rd Street Gym'], kind: 'fact' }],
      dateRef: [2026, 10, 27, 19, 0],
    },
    {
      key: 'coach_wraps',
      day: 2,
      time: [15, 10],
      source: 'message',
      senderId: P.COACH,
      app: 'WhatsApp',
      text: 'Tonight we do pad work — bring your own hand wraps and gloves, the loaners are out.',
      cls: 'signal',
      about: 'a_boxing',
      propositions: [{ text: 'Coach asks to bring hand wraps and gloves to tonight’s Boxing class', conf: 0.9, entities: ['Marcus (Coach)', 'Boxing', 'hand wraps', 'gloves'], kind: 'request' }],
      dateRef: [2026, 10, 27, 19, 0],
    },
    {
      key: 'workout_run_sat1',
      day: 6,
      time: [9, 40],
      source: 'workout',
      app: 'Health',
      text: 'Run 14.2 km · 1:21:05 · avg 5:42/km',
      meta: { km: 14.2, minutes: 81, pace: 5.7 },
      cls: 'signal',
      about: 'g_half',
      propositions: [{ text: 'Long run 14.2 km at 5:42/km on Sat Oct 31', conf: 0.95, entities: ['run'], kind: 'fact' }],
    },
    {
      key: 'coach_pacing',
      day: 7,
      time: [20, 15],
      source: 'message',
      senderId: P.COACH,
      app: 'WhatsApp',
      text: 'Here’s your race pacing plan for the half: 5:35/km first 10k, then see how you feel.',
      cls: 'ambiguous',
      about: M.HALF,
      propositions: [{ text: 'Coach sends a race pacing plan: 5:35/km for the first 10 km', conf: 0.9, entities: ['Marcus (Coach)', 'half marathon', 'pacing plan'], kind: 'fact' }],
    },
    {
      key: 'cal_boxing_thu2',
      day: 11,
      time: [7, 0],
      source: 'calendar',
      app: 'Calendar',
      text: 'Boxing — 3rd Street Gym',
      meta: { start: '2026-11-05T19:00', end: '2026-11-05T20:00', location: '3rd Street Gym, Dogpatch' },
      cls: 'signal',
      about: 'a_boxing',
      propositions: [{ text: 'Boxing class Thu Nov 5 19:00 at 3rd Street Gym', conf: 0.9, entities: ['Boxing', '3rd Street Gym'], kind: 'fact' }],
      dateRef: [2026, 11, 5, 19, 0],
    },
    {
      key: 'coach_cancel',
      day: 11,
      time: [14, 2],
      source: 'message',
      senderId: P.COACH,
      app: 'WhatsApp',
      text: 'No class tonight, gym is closed for a floor repair. Back Tuesday.',
      cls: 'contradiction',
      about: 'a_boxing',
      propositions: [{ text: 'Boxing class on Thu Nov 5 is cancelled (gym closed)', conf: 0.95, entities: ['Marcus (Coach)', 'Boxing'], kind: 'fact' }],
      dateRef: [2026, 11, 5, 19, 0],
      worldState: 'cancelled',
      triple: { correctionKey: 'pacing_to_half', role: 'out-of-scope' },
    },
    {
      key: 'coach_pacing_v2',
      day: 12,
      time: [9, 30],
      source: 'message',
      senderId: P.COACH,
      app: 'WhatsApp',
      text: 'Updated pacing plan attached — slightly faster first 5k since your long run looked easy.',
      cls: 'signal',
      about: M.HALF,
      propositions: [{ text: 'Coach sends an updated pacing plan with a faster first 5 km', conf: 0.9, entities: ['Marcus (Coach)', 'pacing plan'], kind: 'fact' }],
      triple: { correctionKey: 'pacing_to_half', role: 'in-scope' },
    },
    {
      key: 'coach_greatwork',
      day: 13,
      time: [11, 0],
      source: 'message',
      senderId: P.COACH,
      app: 'WhatsApp',
      text: 'Great work this week 👊',
      cls: 'ambiguous',
      about: undefined,
      propositions: [{ text: 'Coach praises this week’s work', conf: 0.5, entities: ['Marcus (Coach)'], kind: 'fact' }],
      triple: { correctionKey: 'pacing_to_half', role: 'ambiguous' },
    },
    {
      key: 'workout_run_sat2',
      day: 13,
      time: [9, 50],
      source: 'workout',
      app: 'Health',
      text: 'Run 16.1 km · 1:30:12 · avg 5:36/km',
      meta: { km: 16.1, minutes: 90, pace: 5.6 },
      cls: 'signal',
      about: 'g_half',
      propositions: [{ text: 'Long run 16.1 km at 5:36/km on Sat Nov 7', conf: 0.95, entities: ['run'], kind: 'fact' }],
    },
    // ---- Work thread --------------------------------------------------------
    {
      key: 'pm_interviews_1',
      day: 1,
      time: [10, 5],
      source: 'message',
      senderId: P.PM,
      app: 'Slack',
      text: 'Can we lock the user interviews script by Thursday? I have 5 participants confirmed.',
      cls: 'signal',
      about: M.REQ_INTERVIEWS,
      propositions: [{ text: 'Jess wants the user interviews script locked by Thursday; 5 participants confirmed', conf: 0.9, entities: ['Jess (PM)', 'user interviews'], kind: 'request' }],
      dateRef: [2026, 10, 29, 17, 0],
    },
    {
      key: 'design_form_1',
      day: 3,
      time: [15, 30],
      source: 'message',
      senderId: P.DESIGN,
      app: 'Slack',
      text: 'Posted three directions for the new product form exploration in Figma — curious which one you’d push.',
      cls: 'signal',
      about: M.REQ_FORM,
      propositions: [{ text: 'Sam posted three directions for the product form exploration in Figma', conf: 0.9, entities: ['Sam Rivera', 'product form', 'Figma'], kind: 'fact' }],
    },
    {
      key: 'pm_interviews_2',
      day: 8,
      time: [9, 45],
      source: 'message',
      senderId: P.PM,
      app: 'Slack',
      text: 'Two interviews done, notes in the doc. Third one moved to Friday.',
      cls: 'signal',
      about: M.REQ_INTERVIEWS,
      propositions: [{ text: 'Two user interviews done; third moved to Friday', conf: 0.9, entities: ['Jess (PM)', 'user interviews'], kind: 'fact' }],
    },
    {
      key: 'design_form_2',
      day: 10,
      time: [11, 15],
      source: 'message',
      senderId: P.DESIGN,
      app: 'Slack',
      text: 'Went with direction B for the form, prototype link in the thread.',
      cls: 'signal',
      about: M.REQ_FORM,
      propositions: [{ text: 'Sam chose direction B for the product form; prototype posted', conf: 0.9, entities: ['Sam Rivera', 'product form'], kind: 'fact' }],
    },
    {
      key: 'lazy_mention',
      day: 9,
      time: [16, 0],
      source: 'message',
      senderId: P.PM,
      app: 'Slack',
      text: 'Not urgent: when you have a sec, scope the Lazy feature so we can size it.',
      cls: 'signal',
      about: M.REQ_LAZY,
      propositions: [{ text: 'Jess asks to scope the Lazy feature when there is time', conf: 0.8, entities: ['Jess (PM)', 'Lazy'], kind: 'request' }],
    },
    {
      key: 'package_notif',
      day: 4,
      time: [14, 20],
      source: 'notification',
      app: 'Luxer One',
      text: 'Your package is in locker 21. Access code 075514.',
      cls: 'signal',
      about: 'c_package',
      propositions: [{ text: 'Package waiting in office locker 21, code 075514', conf: 0.95, entities: ['locker 21'], kind: 'fact' }],
    },
    {
      key: 'package_notif_dup',
      day: 5,
      time: [9, 0],
      source: 'notification',
      app: 'Luxer One',
      text: 'Reminder: your package is in locker 21. Access code 075514.',
      cls: 'signal',
      about: 'c_package',
      propositions: [{ text: 'Package waiting in office locker 21, code 075514', conf: 0.95, entities: ['locker 21'], kind: 'fact' }],
    },
    {
      key: 'package_code_change',
      day: 7,
      time: [8, 30],
      source: 'notification',
      app: 'Luxer One',
      text: 'Your locker code has changed. Locker 21, new access code 118342.',
      cls: 'contradiction',
      about: 'c_package',
      propositions: [{ text: 'Package locker 21 code changed to 118342', conf: 0.95, entities: ['locker 21'], kind: 'fact' }],
    },
    {
      key: 'bart_delay',
      day: 3,
      time: [18, 20],
      source: 'world',
      app: 'BART',
      text: 'BART: 10-min delays on the Yellow line from Montgomery due to an earlier equipment problem.',
      cls: 'signal',
      about: 'a_commute',
      propositions: [{ text: 'BART Yellow line delayed 10 minutes from Montgomery', conf: 0.9, entities: ['BART', 'Montgomery'], kind: 'fact' }],
    },
    // ---- Ambiguous and contradictory events (persona content, part of the story) ----------------
    {
      key: 'a_saturday',
      day: 3,
      time: [19, 10],
      source: 'message',
      senderId: P.A,
      app: 'Messages',
      text: 'Are we still on for Saturday?',
      cls: 'ambiguous',
      about: M.FILLMORE,
      propositions: [{ text: 'Alex Chen asks whether Saturday is still on', conf: 0.6, entities: ['Alex Chen', 'Saturday'], kind: 'request' }],
    },
    {
      key: 'pm_interviews_deadline',
      day: 4,
      time: [16, 40],
      source: 'message',
      senderId: P.PM,
      app: 'Slack',
      text: 'Interviews script deadline pushed to Monday, no rush over the weekend.',
      cls: 'contradiction',
      about: M.REQ_INTERVIEWS,
      propositions: [{ text: 'User interviews script deadline moved to Mon Nov 2', conf: 0.9, entities: ['Jess (PM)', 'user interviews'], kind: 'fact' }],
      dateRef: [2026, 11, 2, 17, 0],
      worldState: 'rescheduled',
    },
    {
      key: 'a_presale',
      day: 6,
      time: [10, 50],
      source: 'message',
      senderId: P.A,
      app: 'Messages',
      text: 'Presale went fine, I got 2 for the Fillmore. You owe me a beer.',
      cls: 'ambiguous',
      about: M.FILLMORE,
      propositions: [{ text: 'Alex Chen bought 2 presale tickets for The Fillmore show', conf: 0.9, entities: ['Alex Chen', 'The Fillmore', 'tickets'], kind: 'fact' }],
    },
    {
      key: 'cal_sunset_dup',
      day: 6,
      time: [11, 0],
      source: 'calendar',
      app: 'Calendar',
      text: 'Sunset Rollercoaster @ The Fillmore',
      meta: { start: '2026-11-08T20:00', end: '2026-11-08T23:00', location: 'The Fillmore, San Francisco' },
      cls: 'signal',
      about: M.FILLMORE,
      propositions: [{ text: 'Calendar: Sunset Rollercoaster at The Fillmore on Sat Nov 8 20:00', conf: 0.95, entities: ['Sunset Rollercoaster', 'The Fillmore'], kind: 'fact' }],
      dateRef: [2026, 11, 8, 20, 0],
    },
    {
      key: 'jess_doc',
      day: 6,
      time: [14, 25],
      source: 'message',
      senderId: P.PM,
      app: 'Slack',
      text: 'Can you send me the doc when you’re done?',
      cls: 'ambiguous',
      about: M.REQ_INTERVIEWS,
      propositions: [{ text: 'Jess asks for the doc when done', conf: 0.5, entities: ['Jess (PM)'], kind: 'request' }],
    },
    {
      key: 'mom_training',
      day: 8,
      time: [19, 40],
      source: 'message',
      senderId: P.MOM,
      app: 'Messages',
      text: 'How is the marathon training going? Don’t overdo it.',
      cls: 'ambiguous',
      about: 'g_half',
      propositions: [{ text: 'Mom asks about marathon training', conf: 0.6, entities: ['Mom', 'marathon'], kind: 'request' }],
    },
    {
      key: 'coach_tue_time',
      day: 9,
      time: [12, 15],
      source: 'message',
      senderId: P.COACH,
      app: 'WhatsApp',
      text: 'Tuesday class is 7:30 not 7 this week, room change.',
      cls: 'contradiction',
      about: 'a_boxing',
      propositions: [{ text: 'Boxing class on Tue Nov 3 moved to 19:30', conf: 0.9, entities: ['Marcus (Coach)', 'Boxing'], kind: 'fact' }],
      dateRef: [2026, 11, 3, 19, 30],
      worldState: 'rescheduled',
    },
    {
      key: 'unknown_runclub',
      day: 9,
      time: [21, 5],
      source: 'message',
      senderId: P.UNKNOWN,
      app: 'Messages',
      text: 'run club thursday 6:30am at kezar, you in?',
      cls: 'ambiguous',
      about: undefined,
      propositions: [{ text: 'Unknown number invites to run club Thursday 6:30 at Kezar', conf: 0.6, entities: ['run club', 'Kezar'], kind: 'request' }],
      dateRef: [2026, 11, 5, 6, 30],
    },
    {
      key: 'world_bart_schedule',
      day: 10,
      time: [9, 0],
      source: 'world',
      app: 'BART',
      text: 'BART schedule change: evening Yellow line trains from Montgomery now every 12 minutes; the 6:42 PM departs 6:48 PM.',
      cls: 'contradiction',
      about: 'a_commute',
      propositions: [{ text: 'BART evening Yellow line from Montgomery: the 18:42 now departs 18:48', conf: 0.9, entities: ['BART', 'Montgomery'], kind: 'fact' }],
    },
    {
      key: 'a_setlist',
      day: 10,
      time: [22, 30],
      source: 'message',
      senderId: P.A,
      app: 'Messages',
      text: 'Did you see the setlist from their LA show? 😍',
      cls: 'ambiguous',
      about: 'pref_sunset',
      acceptable: [M.FILLMORE],
      propositions: [{ text: 'Alex Chen shares the setlist from a recent Sunset Rollercoaster show in LA', conf: 0.6, entities: ['Alex Chen', 'setlist'], kind: 'fact' }],
    },
    {
      key: 'coach_raceday',
      day: 10,
      time: [17, 30],
      source: 'message',
      senderId: P.COACH,
      app: 'WhatsApp',
      text: 'Race day logistics coming next week — bib pickup is Saturday before.',
      cls: 'ambiguous',
      about: M.HALF,
      propositions: [{ text: 'Coach: race day logistics next week; bib pickup the Saturday before', conf: 0.8, entities: ['Marcus (Coach)', 'race', 'bib'], kind: 'fact' }],
    },
    {
      key: 'cal_dentist_moved',
      day: 11,
      time: [7, 0],
      source: 'calendar',
      app: 'Calendar',
      text: 'Dentist (moved)',
      meta: { start: '2026-11-10T15:00', end: '2026-11-10T16:00' },
      cls: 'contradiction',
      about: undefined,
      propositions: [{ text: 'Calendar: Dentist moved to Tue Nov 10 15:00', conf: 0.8, entities: ['Dentist'], kind: 'fact' }],
      dateRef: [2026, 11, 10, 15, 0],
    },
    {
      key: 'sam_feedback',
      day: 12,
      time: [10, 10],
      source: 'message',
      senderId: P.DESIGN,
      app: 'Slack',
      text: 'Any feedback on the prototype?',
      cls: 'ambiguous',
      about: M.REQ_FORM,
      propositions: [{ text: 'Sam asks for feedback on the prototype', conf: 0.6, entities: ['Sam Rivera', 'prototype'], kind: 'request' }],
    },
    {
      // Same friend, another topic, inside the routing rule's window: the rule must not swallow it.
      key: 'b_run',
      day: 9,
      time: [12, 40],
      source: 'message',
      senderId: P.B,
      app: 'Messages',
      text: 'Wanna go for a run Sunday morning? Kezar at 8?',
      cls: 'ambiguous',
      about: undefined,
      propositions: [{ text: 'Ben Park proposes a run on Sunday morning at Kezar', conf: 0.7, entities: ['Ben Park', 'Kezar'], kind: 'request' }],
      dateRef: [2026, 11, 8, 8, 0],
      triple: { correctionKey: 'b_to_greek', role: 'out-of-scope' },
    },
    {
      key: 'b_late',
      day: 12,
      time: [18, 20],
      source: 'message',
      senderId: P.B,
      app: 'Messages',
      text: 'running a bit late, start without me',
      cls: 'ambiguous',
      about: undefined,
      propositions: [{ text: 'Ben Park is running late', conf: 0.5, entities: ['Ben Park'], kind: 'fact' }],
    },
  ],
  corrections: [
    {
      key: 'b_to_greek',
      eventKey: 'b_tickets',
      fromMatterId: M.FILLMORE,
      toMatterId: M.GREEK,
      scope: 'relation',
      predicate: { sender: 'Ben Park' },
      evidence: 'sender = Ben Park',
    },
    {
      key: 'pacing_to_half',
      eventKey: 'coach_pacing',
      fromMatterId: 'a_boxing',
      toMatterId: M.HALF,
      scope: 'rule',
      predicate: { entity: 'pacing plan' },
      evidence: 'entity = pacing plan',
    },
  ],
  dailyPlan: [
    { day: 2, contexts: [{ from: 9, to: 17, ctx: 'desk' }, { from: 17, to: 19, ctx: 'commute' }], shouldSurface: [{ hour: 17, objectId: 'a_boxing', why: 'class tonight; coach asked to bring wraps' }], shouldStaySilent: [] },
    { day: 4, contexts: [{ from: 9, to: 12, ctx: 'meeting' }, { from: 12, to: 18, ctx: 'desk' }, { from: 19, to: 23, ctx: 'home' }], shouldSurface: [{ hour: 20, objectId: M.FILLMORE, why: 'tickets on sale tomorrow 10:00' }], shouldStaySilent: [{ hour: 11, objectId: M.FILLMORE, reason: 'bad-context' }] },
    { day: 9, contexts: [{ from: 9, to: 18, ctx: 'desk' }], shouldSurface: [{ hour: 11, objectId: M.FILLMORE, why: 'show rescheduled to Nov 9 — must interrupt' }], shouldStaySilent: [] },
    { day: 11, contexts: [{ from: 9, to: 18, ctx: 'desk' }], shouldSurface: [{ hour: 15, objectId: 'a_boxing', why: 'class tonight cancelled — must interrupt' }], shouldStaySilent: [] },
  ],
  noise: {
    otherArtists: ['Men I Trust — Show Me How', 'Tame Impala — Let It Happen', 'Thee Sacred Souls — Can I Call You Rose?', 'Hiatus Kaiyote — Red Room', 'Bonobo — Kerala', 'Toro y Moi — Ordinary Pleasure', 'Durand Jones — Witchoo'],
    marketingApps: ['DoorDash', 'Uber', 'Lyft', 'Instacart', 'Airbnb', 'Ticketmaster', 'Nike', 'Strava'],
    systemNotifs: ['Battery at 20%', 'System update available', 'Screen time report ready', 'Low storage', 'Wi-Fi connected: Office-5G', 'Bluetooth: Pixel Buds connected'],
    calendarNoise: ['1:1 with Jess', 'Design review', 'Dentist', 'Team lunch', 'Sprint planning', 'All-hands', 'Haircut', 'Therapy'],
    photoCaptions: ['IMG — Dolores Park', 'IMG — tacos', 'IMG — fog over Twin Peaks', 'IMG — latte art', 'IMG — bike by the Embarcadero', 'IMG — bookstore'],
    familyMessages: ['Call me when you get a chance', 'Did you eat?', 'Sending you the recipe', 'Happy Sunday ☀️', 'Your cousin says hi'],
    workNoise: ['Reminder: timesheet due', 'Build #4412 passed', 'New comment on your doc', 'Jess reacted 👍 to your message', 'PTO request approved'],
  },
  commute: { line: 'Yellow line', station: 'Montgomery', departure: '18:42', leaveBy: '18:26' },
};
