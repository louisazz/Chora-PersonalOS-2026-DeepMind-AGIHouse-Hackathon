/**
 * Declarative renderer: SurfacePlan slots → catalog components, grouped by the view grammar's regions.
 * Components are type declarations; the renderer never decides what to show, only how a slot looks.
 */
import type { ComponentId, DomainId, Slot, SurfacePlan, ViewSpec, WorldState, SuggestedAction, EmptyKind, SilenceReason } from '@/contract/types';
import { VIEW_GRAMMAR } from '@/contract/catalog';
import { t as dict } from '@/contract/i18n';
import { fmtDate, fmtTime } from '@/core/util';
import { useController } from './hooks';

const DOMAIN_EMOJI: Record<DomainId, string> = { study: '📖', fitness: '💪', travel: '✈️', health: '💗', work: '💼', games: '🎮', finance: '💰', music: '🎵', family: '👨‍👩‍👧' };
const INTENT_EMOJI: Record<string, string> = { 'calendar.reminder': '⏰', 'alarm.set': '⏰', 'open.link': '🔗', share: '↗️', 'check.gear': '🥊', 'leave.by': '🚇', reply: '💬' };

const REGION_TITLES: Record<string, string> = {
  now: 'Right now',
  domains: 'My life',
  upcoming: 'Upcoming',
  ongoing: 'Ongoing',
  memories: 'Memories',
  people: 'People',
  header: '',
  facts: 'What is known',
  actions: 'Actions',
  messages: 'Messages',
  'shared-matters': 'Shared matters',
  requirements: 'Requirements',
  todos: 'To-dos',
  propositions: 'What PersonOS believes',
  stream: 'Everything, by time',
};

export function Renderer({ plan, view }: { plan: SurfacePlan; view: ViewSpec }) {
  const c = useController();
  const lang = c.lang;
  const regions = plan.slots.length && plan.slots.every((s) => s.region === 'stream') ? ['stream'] : VIEW_GRAMMAR[view.kind];
  return (
    <>
      {regions.map((region) => {
        const slots = plan.slots.filter((s) => s.region === region);
        if (slots.length === 0 && region !== 'now') return null;
        const title = REGION_TITLES[region] ?? region;
        return (
          <div key={region}>
            {title && (
              <div className="section">
                {title}
                {region === 'now' && slots.length === 0 && <small>{dict(lang).silence['nothing-worth-saying']}</small>}
              </div>
            )}
            <RegionBody region={region} slots={slots} />
          </div>
        );
      })}
    </>
  );
}

function RegionBody({ region, slots }: { region: string; slots: Slot[] }) {
  if (region === 'now') return <div className="cards">{slots.map((s) => <SlotView key={s.id} slot={s} />)}</div>;
  if (region === 'requirements')
    return (
      <div className="grid2">
        {slots.map((s) => (
          <SlotView key={s.id} slot={s} />
        ))}
      </div>
    );
  const listLike: ComponentId[] = ['object-row', 'todo-row', 'proposition-row', 'conversation-ref', 'checklist'];
  const asList = slots.every((s) => listLike.includes(s.component));
  if (asList) return <div className="list">{slots.map((s) => <SlotView key={s.id} slot={s} />)}</div>;
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {slots.map((s) => (
        <SlotView key={s.id} slot={s} />
      ))}
    </div>
  );
}

function SlotView({ slot }: { slot: Slot }) {
  switch (slot.component) {
    case 'suggestion-card':
      return <SuggestionCard slot={slot} />;
    case 'object-row':
      return <ObjectRow slot={slot} />;
    case 'matter-header':
      return <MatterHeader slot={slot} />;
    case 'timeline':
      return <Timeline slot={slot} />;
    case 'checklist':
      return <ObjectRow slot={slot} />;
    case 'map-card':
      return <MapCard slot={slot} />;
    case 'photo-wall':
      return <PhotoWall slot={slot} />;
    case 'curve':
      return <Curve slot={slot} />;
    case 'action-button':
      return <ActionButton slot={slot} />;
    case 'silence-note':
      return <SilenceNote slot={slot} />;
    case 'empty-state':
      return <EmptyState slot={slot} />;
    case 'requirement-card':
      return <RequirementCard slot={slot} />;
    case 'todo-row':
      return <TodoRow slot={slot} />;
    case 'conversation-ref':
      return <ConversationRef slot={slot} />;
    case 'proposition-row':
      return <PropositionRow slot={slot} />;
    case 'ask-card':
      return <AskCard slot={slot} />;
    default:
      return null;
  }
}

function worldBadge(state: WorldState | undefined, lang: 'en') {
  if (!state || state === 'scheduled') return null;
  const cls = state === 'cancelled' ? 'bad' : state === 'rescheduled' ? 'warn' : '';
  return <span className={`badge ${cls}`}>{dict(lang).worldStates[state]}</span>;
}

function SuggestionCard({ slot }: { slot: Slot }) {
  const c = useController();
  const d = dict(c.lang);
  const p = slot.props as { title: string; action?: SuggestedAction; conf: number; urgency: number; domain?: DomainId; objectName?: string; suggestionId?: string };
  return (
    <div className="card" onClick={() => slot.tapTo && c.open(slot.tapTo)}>
      <div className="icon">{p.action ? INTENT_EMOJI[p.action.intent] ?? '•' : p.domain ? DOMAIN_EMOJI[p.domain] : '•'}</div>
      <div>
        <div className="t">{p.title}</div>
        {p.action && (
          <div className="a">
            {d.suggestedAction}: {p.action.label}
          </div>
        )}
        <div className="f">
          {p.domain && (
            <span>
              {d.from}: {d.domains[p.domain]}
            </span>
          )}
          <span className="pill" title="confidence">
            conf {p.conf.toFixed(2)}
          </span>
          <span className="pill" title="urgency">
            urg {p.urgency.toFixed(2)}
          </span>
        </div>
      </div>
      {p.action && (
        <div className="actions" onClick={(e) => e.stopPropagation()}>
          <button className="primary" onClick={() => void c.execute(p.action!)}>
            {p.action.label}
          </button>
          <button className="ghost" onClick={() => p.suggestionId && c.dismiss(p.suggestionId)}>
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

function ObjectRow({ slot }: { slot: Slot }) {
  const c = useController();
  const d = dict(c.lang);
  const p = slot.props as { name: string; domain?: DomainId; hint?: string; unread?: boolean; silence?: SilenceReason; type?: string; when?: string; place?: string; worldState?: WorldState; people?: string[]; count?: number; latest?: string; role?: string; roles?: string[]; cadence?: string; big?: boolean };
  const name = p.domain ? d.domains[p.domain] : p.name;
  const sub: string[] = [];
  if (p.when) sub.push(`${fmtDate(p.when, c.lang)} ${fmtTime(p.when)}`);
  if (p.place) sub.push(p.place);
  if (p.people?.length) sub.push(p.people.join(', '));
  if (p.role) sub.push(p.role);
  if (p.roles?.length) sub.push(p.roles.join(', '));
  if (p.cadence) sub.push(p.cadence);
  if (p.latest && !p.when) sub.push(p.latest);
  const silenceHint = !p.hint && p.silence && p.silence !== 'nothing-worth-saying' ? d.silence[p.silence] : '';
  return (
    <div className={`row ${sub.length ? 'sub' : ''}`} onClick={() => slot.tapTo && c.open(slot.tapTo)}>
      {p.domain && <span className="emoji">{DOMAIN_EMOJI[p.domain]}</span>}
      {p.type === 'person' && <span className="emoji">👤</span>}
      <span className="name" style={p.big ? { fontSize: 22 } : undefined}>
        {name}
        {worldBadge(p.worldState, c.lang)}
      </span>
      {(p.hint || silenceHint) && <span className="hint">{p.hint || silenceHint}</span>}
      {p.unread && <span className="dot" />}
      {slot.tapTo && <span className="chev">›</span>}
      {sub.length > 0 && <div className="meta">{sub.join(' · ')}</div>}
    </div>
  );
}

function MatterHeader({ slot }: { slot: Slot }) {
  const c = useController();
  const d = dict(c.lang);
  const p = slot.props as { name: string; when?: string; place?: string; worldState?: WorldState; worldLog?: { state: WorldState; t: string; when?: string }[]; stance?: string; shape?: string; typicality?: number; domain?: DomainId };
  return (
    <div className="header">
      <div className="sub">
        {p.domain ? `${DOMAIN_EMOJI[p.domain]} ${d.domains[p.domain]}` : ''} {p.shape && <span className="pill">{p.shape}</span>}
      </div>
      <h2>
        {p.name}
        {worldBadge(p.worldState, c.lang)}
      </h2>
      <div className="sub">
        {p.when ? `${fmtDate(p.when, c.lang)} ${fmtTime(p.when)}` : ''}
        {p.place ? ` · ${p.place}` : ''}
      </div>
      {p.worldLog && p.worldLog.length > 1 && (
        <div className="sub" style={{ marginTop: 6, fontSize: 12 }}>
          {p.worldLog.map((w, i) => (
            <span key={i}>
              {i > 0 && ' → '}
              {d.worldStates[w.state]}
              {w.when ? ` (${fmtDate(w.when, c.lang)})` : ''}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Timeline({ slot }: { slot: Slot }) {
  const p = slot.props as { entries?: { t: string; text: string; detail?: string }[]; title?: string; name?: string; when?: string; place?: string };
  const entries = p.entries ?? [];
  return (
    <div className="timeline">
      {p.title && <div className="section" style={{ fontSize: 14, margin: '0 0 6px' }}>{p.title}</div>}
      {p.name && <div style={{ fontWeight: 600 }}>{p.name}{p.when ? ` · ${fmtDate(p.when)}` : ''}{p.place ? ` · ${p.place}` : ''}</div>}
      {entries.map((e, i) => (
        <div className="e" key={i}>
          <span className="w">{e.t.slice(5, 16).replace('T', ' ')}</span>
          <span>
            {e.text}
            {e.detail && <span className="m"> · {e.detail}</span>}
          </span>
        </div>
      ))}
    </div>
  );
}

function MapCard({ slot }: { slot: Slot }) {
  const c = useController();
  const p = slot.props as { name: string; place?: string; when?: string };
  return (
    <div className="card" style={{ minWidth: 0 }} onClick={() => slot.tapTo && c.open(slot.tapTo)}>
      <div className="icon">📍</div>
      <div>
        <div className="t">{p.place ?? p.name}</div>
        <div className="a">{p.name}{p.when ? ` · ${fmtDate(p.when, c.lang)} ${fmtTime(p.when)}` : ''}</div>
      </div>
    </div>
  );
}

function PhotoWall({ slot }: { slot: Slot }) {
  const p = slot.props as { name: string };
  return (
    <div className="card" style={{ minWidth: 0 }}>
      <div className="icon">🖼️</div>
      <div className="t">{p.name}</div>
    </div>
  );
}

function Curve({ slot }: { slot: Slot }) {
  const c = useController();
  const p = slot.props as { name: string; series?: number[]; count?: number; latest?: string };
  const s = p.series ?? [];
  const w = 300;
  const h = 70;
  const max = Math.max(1, ...s);
  const min = Math.min(...s, max);
  const pts = s.map((v, i) => `${(i / Math.max(1, s.length - 1)) * (w - 10) + 5},${h - 8 - ((v - min) / Math.max(0.1, max - min)) * (h - 20)}`).join(' ');
  return (
    <div className="curve" onClick={() => slot.tapTo && c.open(slot.tapTo)}>
      <div style={{ fontWeight: 600 }}>{p.name}</div>
      <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ display: 'block' }}>
        <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="2" />
        {s.map((v, i) => (
          <circle key={i} cx={(i / Math.max(1, s.length - 1)) * (w - 10) + 5} cy={h - 8 - ((v - min) / Math.max(0.1, max - min)) * (h - 20)} r="3" fill="currentColor" />
        ))}
      </svg>
      <div style={{ color: 'var(--muted)', fontSize: 12 }}>
        {s.length} runs · last {s[s.length - 1]} km
      </div>
    </div>
  );
}

function ActionButton({ slot }: { slot: Slot }) {
  const c = useController();
  const p = slot.props as { label: string; intent: SuggestedAction['intent']; suggestionId?: string; conf: number };
  const s = p.suggestionId ? c.graph.suggestions.get(p.suggestionId) : undefined;
  return (
    <div className="row sub" style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 14 }}>
      <button className="primary" onClick={() => s?.action && void c.execute(s.action)}>
        {INTENT_EMOJI[p.intent] ?? ''} {p.label}
      </button>
      <span className="pill">conf {p.conf.toFixed(2)}</span>
    </div>
  );
}

function SilenceNote({ slot }: { slot: Slot }) {
  const c = useController();
  const d = dict(c.lang);
  const p = slot.props as { reason: SilenceReason; suppressed?: { title: string; reason?: SilenceReason }[] };
  return (
    <div className="silence">
      <div>🤫 {d.silence[p.reason]}</div>
      {p.suppressed?.slice(0, 3).map((s, i) => (
        <div key={i} style={{ fontSize: 12, marginTop: 4 }}>
          · {s.title} <span className="pill">{s.reason ? d.silence[s.reason] : ''}</span>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ slot }: { slot: Slot }) {
  const c = useController();
  const p = slot.props as { kind: EmptyKind };
  return <div className="empty">∅ {dict(c.lang).empty[p.kind] ?? p.kind}</div>;
}

function RequirementCard({ slot }: { slot: Slot }) {
  const c = useController();
  const d = dict(c.lang);
  const p = slot.props as { name: string; status?: string; conversations?: number; when?: string };
  const statusLabel = p.status === 'in-progress' ? 'In progress' : p.status === 'not-started' ? 'Not started' : String(p.status ?? '');
  return (
    <div className="req" onClick={() => slot.tapTo && c.open(slot.tapTo)}>
      <div className="st">{statusLabel}</div>
      <div className="n">{p.name}</div>
      <div className="c">{d.relatedConversations(p.conversations ?? 0)} ›</div>
    </div>
  );
}

function TodoRow({ slot }: { slot: Slot }) {
  const c = useController();
  const p = slot.props as { name: string; status?: string };
  return (
    <div className="row" onClick={() => slot.tapTo && c.open(slot.tapTo)}>
      <span className="name">{p.name}</span>
      <span className="hint">{p.status}</span>
      <span className="chev">›</span>
    </div>
  );
}

function ConversationRef({ slot }: { slot: Slot }) {
  const c = useController();
  const d = dict(c.lang);
  const p = slot.props as { propositionId: string; text: string; sender?: string; t: string; about?: string; constrainedBy?: string };
  const corr = p.constrainedBy ? c.graph.corrections.get(p.constrainedBy) : undefined;
  return (
    <div className="prop">
      <span className="emoji">💬</span>
      <div className="body">
        <div>{p.text.replace(/^[^:]+:\s*/, '')}</div>
        <div className="m">
          {p.sender} · {fmtDate(p.t, c.lang)} {fmtTime(p.t)}
          {p.about ? ` · → ${p.about}` : ''}
          {corr && <span className="badge ok">rule: {corr.evidence}</span>}
        </div>
      </div>
      <div className="ops">
        <button onClick={() => c.openCorrection(p.propositionId)}>{d.moveTo}</button>
      </div>
    </div>
  );
}

function PropositionRow({ slot }: { slot: Slot }) {
  const c = useController();
  const d = dict(c.lang);
  const p = slot.props as { propositionId?: string; text: string; conf?: number; status?: string; about?: string; source?: { source: string; sender?: string }; t?: string; kind?: string; constrainedBy?: string; rule?: boolean; candidates?: { objectId: string; score: number }[]; stream?: boolean };
  const prop = p.propositionId ? c.graph.propositions.get(p.propositionId) : undefined;
  const frozen = prop?.status === 'frozen';
  const ask = prop?.status === 'ask-user';
  return (
    <div className="prop" style={frozen ? { opacity: 0.5 } : undefined}>
      <div className="body">
        <div>
          {p.conf !== undefined && (
            <span className="conf" title={`conf ${p.conf}`}>
              <i style={{ width: `${Math.round((p.conf ?? 0) * 100)}%` }} />
            </span>
          )}
          {p.text}
          {p.rule && <span className="badge ok">rule</span>}
        </div>
        <div className="m">
          {p.source ? `${p.source.source}${p.source.sender ? ' · ' + p.source.sender : ''}` : ''}
          {p.t ? ` · ${fmtDate(p.t, c.lang)} ${fmtTime(p.t)}` : ''}
          {p.about ? ` · → ${p.about}` : ''}
          {p.status && p.status !== 'attributed' && <span className={`badge ${ask ? 'warn' : ''}`}>{p.status}</span>}
          {p.constrainedBy && <span className="badge ok">by rule</span>}
        </div>
        {ask && prop && (
          <div className="ask" style={{ marginTop: 6 }}>
            <div style={{ marginBottom: 6 }}>{d.askUser}</div>
            <div className="chips">
              {(prop.candidates ?? []).map((cand) => (
                <button key={cand.objectId} onClick={() => c.resolveAsk(prop.id, cand.objectId)}>
                  {c.objectName(cand.objectId)} <span className="pill">{cand.score.toFixed(2)}</span>
                </button>
              ))}
              <button className="ghost" onClick={() => c.openCorrection(prop.id)}>
                {d.newMatter}
              </button>
            </div>
          </div>
        )}
      </div>
      {prop && !p.stream && (
        <div className="ops">
          <button onClick={() => c.openCorrection(prop.id)} title={d.moveTo}>
            ↪
          </button>
          <button onClick={() => c.toggleFreeze(prop.id)}>{frozen ? d.unfreeze : d.freeze}</button>
          <button onClick={() => c.deleteProposition(prop.id)}>{d.delete}</button>
        </div>
      )}
    </div>
  );
}

function AskCard({ slot }: { slot: Slot }) {
  const c = useController();
  const d = dict(c.lang);
  const p = slot.props as { propositionId: string; text: string; sender?: string; candidates: { objectId: string; name: string; score: number }[] };
  return (
    <div className="card ask" style={{ minWidth: 300 }} onClick={(e) => e.stopPropagation()}>
      <div className="icon">❓</div>
      <div>
        <div className="t">{d.askUser}</div>
        <div className="a">“{p.text.replace(/^[^:]+:\s*/, '')}”{p.sender ? ` — ${p.sender}` : ''}</div>
        <div className="chips" style={{ marginTop: 8 }}>
          {p.candidates.slice(0, 3).map((k) => (
            <button key={k.objectId} className="primary" onClick={() => c.resolveAsk(p.propositionId, k.objectId)}>
              {k.name}
            </button>
          ))}
          <button onClick={() => c.openCorrection(p.propositionId)}>{d.newMatter}</button>
          <button className="ghost" onClick={() => c.deleteProposition(p.propositionId)}>{d.delete}</button>
        </div>
      </div>
    </div>
  );
}
