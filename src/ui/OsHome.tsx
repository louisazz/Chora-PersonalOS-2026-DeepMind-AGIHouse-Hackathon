/** Mounts the OS home screen (src/os) in a shadow root and feeds it live snapshots from the controller. */
import { useEffect, useRef } from 'react';
import type { Matter, Proposition, Suggestion } from '@/contract/types';
import type { PropositionOutcome } from '@/core/attribution';
import { fmtDate, fmtTime } from '@/core/util';
import { connectLive, publishLive, type LiveCard, type LiveMatter, type LiveSnapshot } from '@/os/live';
import { useController } from './hooks';
import osCss from '@/os/os.css?inline';
import workCss from '@/os/work-domain.css?inline';
import healthCss from '@/os/health-domain.css?inline';
import musicCss from '@/os/music-domain.css?inline';
import learningCss from '@/os/learning-domain.css?inline';
import agentCss from '@/os/agent-domain.css?inline';

type C = ReturnType<typeof useController>;

/** Core domain ids → OS home domain ids. */
const DOMAIN: Record<string, string> = { study: 'learning', fitness: 'fitness', travel: 'travel', health: 'health', work: 'work', games: 'games', finance: 'finance', music: 'music' };
/** Observation source → the app whose icon marks "new activity from" on a domain tile. */
const SOURCE_ICON: Record<string, string> = { media: 'music', calendar: 'calendar', message: 'phone', notification: 'maps', workout: 'fit', photo: 'photos' };

const EXTRA_CSS = `
:host{display:block;--scale:1;--ease:cubic-bezier(.2,.8,.2,1);font-family:-apple-system,BlinkMacSystemFont,"Inter","Helvetica Neue","PingFang SC",sans-serif;color:#17191e;-webkit-font-smoothing:antialiased}
.live-show{justify-content:space-between;align-items:center}
.live-show-main{display:flex;flex-direction:column;gap:2px;text-align:left}
.live-show-main span{font-size:12px;color:var(--muted)}
.live-show-state{font-size:12px;color:var(--muted);white-space:nowrap}
.live-show-state.changed,.live-changed{color:#c43d2f;font-weight:600}
.live-subhead{font-size:13px;font-weight:600;margin:14px 0 6px;color:var(--muted)}
.live-memory p.is-frozen{opacity:.5;text-decoration:line-through}
.live-actions{flex-wrap:wrap}
`;

function venue(m: Matter): string {
  if (m.place) return m.place.split(',')[0]!.trim();
  const i = m.displayName.indexOf(' at ');
  return i > 0 ? m.displayName.slice(i + 4) : m.displayName;
}
function longDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
}
/** A clock of 00:00 means "unknown" in this graph (a date-only reschedule keeps no time), so it is not shown. */
function clockOf(iso?: string): string {
  if (!iso || iso.length <= 10) return '';
  const t = fmtTime(iso);
  return t === '00:00' ? '' : t;
}
function whenLabel(iso?: string): string {
  if (!iso) return '';
  const clock = clockOf(iso);
  return clock ? `${fmtDate(iso)} · ${clock}` : fmtDate(iso);
}
function eventText(c: C, p: Proposition): string {
  return c.eventById(p.source.eventId)?.text ?? p.text;
}
function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function clip(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
function hoursApart(a: string, b: string): number {
  return Math.abs(Date.parse(a) - Date.parse(b)) / 36e5;
}

/** One policy suggestion → one home card. */
function cardOf(c: C, s: Suggestion, band: string, matters: LiveMatter[], covered: Set<string>): LiveCard {
  const g = c.graph;
  const o = g.obj(s.objectId);
  const m = g.matter(s.objectId);
  const lm = matters.find((x) => x.id === s.objectId);
  const domain = DOMAIN[g.domainOf(s.objectId) ?? o?.domain ?? ''] ?? 'other';
  const because = s.rationale.because.map((id) => g.propositions.get(id)?.text ?? id);
  const base = { id: s.id, kind: 'suggestion' as const, domain, objectId: s.objectId, urgency: s.urgency, conf: s.conf, action: s.action, because, matterId: m?.id };
  const name = m?.displayName ?? o?.displayName ?? '';
  const rest = name && s.title.startsWith(name) ? s.title.slice(name.length).replace(/^[\s:—-]+/, '') : s.title;
  if (m) covered.add(m.id);
  if (m && lm && (m.worldState === 'cancelled' || m.worldState === 'rescheduled')) {
    return {
      ...base,
      flavor: 'change',
      title: m.worldState === 'cancelled' ? `${lm.short} show is cancelled` : `${lm.short} show moved to ${fmtDate(m.when ?? '')}`,
      sub: m.worldState === 'cancelled' || !clockOf(m.when) ? band : `${clockOf(m.when)} · ${band}`,
      cta: s.action?.label ?? 'View',
    };
  }
  if (domain === 'music' && m && lm) {
    const sale = /tickets on sale (.+)$/i.exec(s.title);
    if (sale) return { ...base, flavor: 'concert', title: `${band}, nearby`, sub: `${lm.whenLabel} · ${lm.short} · On sale ${sale[1]}`, cta: 'Auto-book tickets' };
    return { ...base, flavor: 'request', title: rest || s.title, sub: `${lm.short} · ${lm.whenLabel}`, cta: s.action?.label ?? 'View' };
  }
  if (domain === 'fitness' && m) {
    const bring = /tonight — bring (.+)$/i.exec(s.title);
    if (bring) return { ...base, flavor: 'boxing', title: `${(o?.displayName ?? 'Boxing').split(/[\s—-]/)[0]} tonight. ${cap(bring[1]!)}.`, sub: '', cta: 'View training plan' };
  }
  if (domain === 'work' && s.action?.intent === 'leave.by') {
    return { ...base, flavor: 'commute', title: `Leave at ${s.action.args.time ?? ''} for your BART train`, sub: /delay|now departs|every \d+/i.test(s.title) ? s.title : 'Pick up your package on the way.', cta: 'View your route' };
  }
  return { ...base, flavor: / due /.test(s.title) ? 'due' : 'other', title: s.title, sub: lm?.whenLabel ?? '', cta: s.action?.label ?? 'View' };
}

function buildSnapshot(c: C): LiveSnapshot {
  const g = c.graph;
  const now = c.now;
  const band = [...g.objects.values()].find((o) => (o.type as string) === 'preference' && g.domainOf(o.id) === 'music')?.displayName ?? 'Sunset Rollercoaster';

  const matters: LiveMatter[] = g
    .matters()
    .filter((m) => m.worldState !== 'past')
    .map((m) => {
      const props = g.activePropositionsOf(m.id);
      const changed = m.worldState === 'cancelled' ? 'Cancelled' : m.worldState === 'rescheduled' && m.when ? `Moved to ${whenLabel(m.when)}` : undefined;
      const onSale = props.map((p) => /on sale (.+?)(?:\.|$)/i.exec(p.text)?.[1]).find((x): x is string => !!x);
      return {
        id: m.id,
        name: m.displayName,
        short: venue(m),
        domain: DOMAIN[g.domainOf(m.id) ?? ''] ?? 'other',
        when: m.when,
        whenLabel: whenLabel(m.when),
        place: m.place,
        state: m.worldState,
        people: g.peopleOf(m.id).map((x) => x.person.displayName),
        messages: props.filter((p) => p.source.source === 'message').map((p) => ({ id: p.id, text: eventText(c, p), sender: p.source.sender, status: p.status })),
        facts: props.filter((p) => p.source.source !== 'message').map((p) => ({ id: p.id, text: p.text })),
        changed,
        onSale,
      };
    })
    .sort((a, b) => (a.when ?? '').localeCompare(b.when ?? ''));

  // Open questions: the system did not guess, so the person decides. Newest two reach the home screen.
  const asks: { t: string; card: LiveCard }[] = [];
  for (const p of g.propositions.values()) {
    if (p.status !== 'ask-user') continue;
    const candidates = (p.candidates ?? []).slice(0, 3).map((cd) => ({ objectId: cd.objectId, name: g.obj(cd.objectId)?.displayName ?? cd.objectId, score: cd.score }));
    const first = candidates[0];
    const text = eventText(c, p);
    asks.push({ t: p.t, card: {
      id: p.id,
      kind: 'ask',
      domain: first ? DOMAIN[g.domainOf(first.objectId) ?? ''] ?? 'other' : 'other',
      title: `${p.source.sender ?? 'Unknown number'}: “${clip(text, 60)}”`,
      sub: first ? `Is this about ${first.name}?` : 'Which of your things is this about?',
      cta: 'Sort it',
      urgency: 0.6,
      conf: p.attributionConf ?? 0,
      because: [],
      flavor: 'other',
      propositionId: p.id,
      sender: p.source.sender,
      text,
      candidates,
    } });
  }
  const covered = new Set<string>();
  const cards: LiveCard[] = c.evaluation.shown.map((s) => cardOf(c, s, band, matters, covered));
  // The next show stays present on the home screen even when the policy has nothing new to say about it.
  const nextShow = matters.find((m) => m.domain === 'music' && m.state !== 'cancelled');
  if (nextShow && !covered.has(nextShow.id)) {
    cards.push({ id: `matter:${nextShow.id}`, kind: 'suggestion', domain: 'music', objectId: nextShow.id, title: `${band}, nearby`, sub: `${nextShow.whenLabel} · ${nextShow.short}`, cta: 'View', urgency: 0, conf: 1, because: [], matterId: nextShow.id, flavor: 'concert' });
  }
  for (const a of asks.sort((x, y) => y.t.localeCompare(x.t)).slice(0, 2)) cards.push(a.card);
  // Home order: a change to something planned, then the show, then open questions, then the rest.
  const rank = (x: LiveCard) => (x.flavor === 'change' ? 0 : x.flavor === 'concert' ? 1 : x.kind === 'ask' ? 2 : 3);
  cards.sort((a, b) => rank(a) - rank(b) || b.urgency - a.urgency);

  const status: Partial<Record<string, string>> = {};
  const changedShow = matters.find((m) => m.domain === 'music' && m.changed);
  if (changedShow) status.music = `${changedShow.short} · ${changedShow.changed}`;
  else if (nextShow) status.music = `${band} nearby`;
  const nextFit = matters.find((m) => m.domain === 'fitness' && m.changed);
  if (nextFit) status.fitness = `${nextFit.short.split(/[\s—·-]/)[0]}: ${nextFit.changed!.toLowerCase()}`;
  const work = c.evaluation.shown.find((s) => DOMAIN[g.domainOf(s.objectId) ?? ''] === 'work');
  if (work && /delay|now departs|every \d+/i.test(work.title)) status.work = 'BART change tonight';

  // "New from" icons: the most recent thing filed into each domain, by observation source.
  const activity: Record<string, { id: string; sources: string[] } | null> = { music: null, fitness: null, work: null };
  const recent = [...g.propositions.values()].filter((p) => p.status === 'attributed' && !!p.attributedTo && hoursApart(p.t, now) <= 48).sort((a, b) => b.t.localeCompare(a.t));
  for (const p of recent) {
    const dom = DOMAIN[g.domainOf(p.attributedTo!) ?? ''];
    if (dom && dom in activity && !activity[dom]) activity[dom] = { id: p.id, sources: [SOURCE_ICON[p.source.source] ?? 'web'] };
  }

  const propositions = [...g.propositions.values()]
    .filter((p) => !['deleted', 'dropped', 'pending'].includes(p.status))
    .sort((a, b) => b.t.localeCompare(a.t))
    .map((p) => ({ id: p.id, text: p.text, conf: p.conf, status: p.status, about: p.attributedTo ? g.obj(p.attributedTo)?.displayName : undefined, source: p.source.source, sender: p.source.sender, kind: p.kind }));

  const silences = c.evaluation.silent.map((s) => ({ title: s.title, reason: s.silenceReason ?? 'nothing-worth-saying' }));

  const event = nextShow && nextShow.when ? { band, dateLong: longDate(nextShow.when), time: fmtTime(nextShow.when), venue: nextShow.short, onSale: nextShow.onSale ?? '', distance: '2.3 km' } : undefined;

  return {
    ready: true,
    timeLabel: fmtTime(now),
    dateLabel: `${fmtDate(now)} · San Francisco`,
    context: c.context.id,
    band,
    cards,
    matters,
    status,
    activity,
    propositions,
    silences,
    event,
    lastLog: c.logs[c.logs.length - 1]?.text,
  };
}

function describe(c: C, o: PropositionOutcome): string {
  const name = (id?: string) => (id ? c.graph.obj(id)?.displayName ?? id : '');
  switch (o.outcome) {
    case 'attributed':
      return `Filed under ${name(o.proposition.attributedTo)}`;
    case 'constrained':
      return `Filed under ${name(o.proposition.attributedTo)} by your rule`;
    case 'new-object':
      return `New: ${name(o.createdObjectId)}`;
    case 'candidate-channel':
      return 'Kept aside until more arrives';
    case 'ask-user':
      return 'Needs your call: see For now';
    case 'conflict':
      return 'Two rules disagree: asking you';
  }
}

export function OsHome() {
  const c = useController();
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    if (!el || el.shadowRoot) return;
    const shadow = el.attachShadow({ mode: 'open' });
    const phoneMode = document.documentElement.dataset.mode === 'phone';
    const style = document.createElement('style');
    style.textContent = [osCss, workCss, healthCss, musicCss, learningCss, agentCss, EXTRA_CSS, phoneMode ? '.phone{width:100vw;height:100dvh;border-radius:0}' : '.phone{margin:0 auto;box-shadow:0 0 0 1px #d8dbe3,0 24px 70px #171c3626}'].join('\n');
    shadow.appendChild(style);
    const studio = document.createElement('div');
    studio.id = 'studio';
    shadow.appendChild(studio);
    (window as unknown as { __personosOsStudio?: HTMLElement }).__personosOsStudio = studio;
    connectLive({
      feed: async (input) => {
        const o = await c.feed(input);
        if (!o) return 'Not processed';
        if (o.verdict === 'dropped') return 'Nothing worth keeping in that';
        return o.outcomes.map((x) => describe(c, x)).join('; ') || 'Processed';
      },
      dismiss: (sid) => c.dismiss(sid),
      execute: async (a) => {
        await c.execute(a);
        const r = c.executions[c.executions.length - 1]?.result ?? '';
        return r.startsWith('logged') ? `${a.label}: handed off (logged on this device)` : `${a.label}: ${r}`;
      },
      resolveAsk: (pid, oid) => c.resolveAsk(pid, oid),
      openCorrection: (pid) => c.openCorrection(pid),
      deleteProposition: (id) => c.deleteProposition(id),
      freezeProposition: (id) => c.toggleFreeze(id),
    });
    publishLive(buildSnapshot(c));
    // @ts-expect-error plain JS module, bundled by Vite
    void import('@/os/app.js');
  }, []);

  useEffect(() => {
    publishLive(buildSnapshot(c));
  });

  return <div ref={host} className="os-host" />;
}
