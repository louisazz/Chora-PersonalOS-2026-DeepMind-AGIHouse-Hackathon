/** Side panels: replay, context, rationale, on-device performance, feed box, correction dialog. */
import { useEffect, useState } from 'react';
import type { ContextId, EventSource, Scope } from '@/contract/types';
import { t as dict } from '@/contract/i18n';
import { fmtDate, fmtTime } from '@/core/util';
import { useController } from './hooks';
import type { CompareMode } from '@/core/surface';

const CONTEXTS: ContextId[] = ['home', 'commute', 'desk', 'meeting', 'gym', 'night'];

export function ReplayPanel() {
  const c = useController();
  const d = dict(c.lang);
  const st = c.replay?.status();
  if (!st || !c.replay) return null;
  const day = Math.max(0, Math.min(st.day, st.totalDays - 1));
  const next = c.fixture?.events[st.cursor];
  return (
    <div className="panel">
      <h3>
        {d.replay} · {fmtDate(st.now, c.lang)} {fmtTime(st.now)} <span className={`badge ${st.live ? 'warn' : 'ok'}`}>{st.live ? 'live' : 'precomputed'}</span>
      </h3>
      <input className="slider" type="range" min={-1} max={st.totalDays - 1} value={st.cursor === 0 ? -1 : day} disabled={c.busy} onChange={(e) => void c.seekDay(Number(e.target.value))} />
      <div className="toolbar">
        <button disabled={c.busy || !next} onClick={() => void c.stepEvent()}>
          ▶ next event
        </button>
        <button disabled={c.busy} onClick={() => void c.seekDay(day)}>
          ⏭ end of day
        </button>
        <button className="ghost" disabled={c.busy} onClick={() => c.reset()}>
          {d.reset}
        </button>
        <span className="mono">
          {st.cursor}/{st.total}
        </span>
      </div>
      {next && (
        <div className="mono" style={{ marginTop: 6, color: 'var(--muted)' }}>
          next: [{next.source}
          {next.sender ? ` · ${next.sender}` : ''}] {next.text?.slice(0, 90)}
        </div>
      )}
      {c.progress && <div className="progress">{c.progress}</div>}
      {st.invalidatedAt && <div className="mono" style={{ color: 'var(--warn)' }}>snapshots after {fmtDate(st.invalidatedAt, c.lang)} invalidated: later days recompute live</div>}
    </div>
  );
}

export function ContextPanel() {
  const c = useController();
  const d = dict(c.lang);
  return (
    <div className="panel">
      <h3>
        {d.context} · {d.contexts[c.context.id]} <span className="pill">{c.context.signals.join(', ')}</span>
      </h3>
      <div className="chips">
        <button className={!c.contextOverride ? 'on' : ''} onClick={() => c.setContext(undefined)}>
          auto
        </button>
        {CONTEXTS.map((x) => (
          <button key={x} className={c.contextOverride === x ? 'on' : ''} onClick={() => c.setContext(x)}>
            {d.contexts[x]}
          </button>
        ))}
      </div>
      <div className="toolbar" style={{ marginTop: 8 }}>
        <span style={{ color: 'var(--muted)' }}>{d.compare}:</span>
        {(['adaptive', 'fixed', 'stream'] as CompareMode[]).map((m) => (
          <button key={m} className={c.mode === m ? 'on primary' : ''} onClick={() => c.setMode(m)}>
            {d.compareModes[m]}
          </button>
        ))}
        <button onClick={() => c.nudgeDensity(-1)}>− {d.less}</button>
        <button onClick={() => c.nudgeDensity(1)}>+ {d.more}</button>
      </div>
    </div>
  );
}

export function RationalePanel() {
  const c = useController();
  const d = dict(c.lang);
  const plan = c.plans.get(c.view.id);
  const members = c.graph.membersOf(c.view);
  const shown = c.evaluation.shown.filter((s) => c.view.kind === 'life' || members.has(s.objectId));
  const silent = c.evaluation.silent.filter((s) => c.view.kind === 'life' || members.has(s.objectId));
  const o = c.lastOutcome;
  return (
    <div className="panel">
      <h3>{d.rationale}</h3>
      {plan && (
        <div className="kv">
          <b>view</b>
          <span>
            {c.view.kind} · intent {plan.intent} · density {plan.density} · v{plan.version}
          </span>
          <b>chosen</b>
          <span>
            {plan.rationale.chosen} {plan.rationale.scored.map((s) => `${s.candidate}=${s.score}`).join(', ')}
          </span>
          {plan.rationale.vetoed.length > 0 && (
            <>
              <b>vetoed</b>
              <span className="vetoed">{plan.rationale.vetoed.map((v) => `${v.candidate}: ${v.reason}`).join(' · ')}</span>
            </>
          )}
          <b>structure</b>
          <span>
            {plan.structureBudgetUsed}/{plan.structureBudget} used · {plan.lastDiff.filter((x) => x.kind === 'content').length} content · {plan.lastDiff.filter((x) => x.kind === 'structure').length} structure
            {plan.deferred.length ? ` · ${plan.deferred.length} deferred` : ''}
            {plan.rationale.conflicts?.length ? ` · component fallbacks: ${plan.rationale.conflicts.join(', ')}` : ''}
          </span>
        </div>
      )}
      {shown.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <b>shown</b>
          {shown.map((s) => (
            <div key={s.id} style={{ margin: '4px 0' }}>
              • {s.title} <span className="pill">conf {s.conf}</span> <span className="pill">urg {s.urgency}</span>
              <div className="mono" style={{ color: 'var(--muted)' }}>
                because: {s.rationale.because.map((id) => c.graph.propositions.get(id)?.text.slice(0, 60) ?? id).join(' | ')}
              </div>
            </div>
          ))}
        </div>
      )}
      {silent.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <b>held back</b>
          {silent.map((s) => (
            <div key={s.id} style={{ margin: '4px 0', color: 'var(--muted)' }}>
              🤫 {s.title} <span className="badge warn">{s.silenceReason ? d.silence[s.silenceReason] : ''}</span>
            </div>
          ))}
        </div>
      )}
      {o && (
        <div style={{ marginTop: 8 }}>
          <b>last event</b>
          <div className="mono" style={{ color: 'var(--muted)' }}>
            {o.verdict} · {o.timing.totalMs.toFixed(0)} ms{o.escalations ? ` · escalated ${o.escalations}` : ''}
            {o.inference ? ` · via ${o.extractor === 'structured' ? 'structured mapping' : o.inference} + ${o.embedding ?? ''}` : ''}
          </div>
          {o.outcomes.map((x, i) => (
            <div key={i} style={{ margin: '4px 0' }}>
              <div>
                {x.proposition.text.slice(0, 90)} → <b>{x.outcome}</b> {x.proposition.attributedTo ? `(${c.objectName(x.proposition.attributedTo)}${x.proposition.attributionConf ? `, conf ${x.proposition.attributionConf.toFixed(2)}` : ''})` : ''}
              </div>
              <div className="mono" style={{ color: 'var(--muted)' }}>
                candidates: {x.candidates.map((k) => `${k.displayName} ${k.score}`).join(' | ') || 'none'}
                {x.constraints.length ? ` · constraints: ${x.constraints.map((k) => `${k.scope} → ${c.objectName(k.toObj)} (${k.evidence})`).join('; ')}` : ''}
              </div>
            </div>
          ))}
          {o.worldChange && (
            <div className="mono" style={{ color: 'var(--warn)' }}>
              world axis: {c.objectName(o.worldChange.objectId)} → {o.worldChange.state} {o.worldChange.when ? fmtDate(o.worldChange.when, c.lang) : ''}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function PerfPanel() {
  const c = useController();
  const d = dict(c.lang);
  const { infer, embed, escalate } = c.attributor.adapters;
  const is = infer.stats();
  const es = embed.stats();
  const ch = c.attributor.channelStats();
  const recent = c.attributor.log.slice(-20);
  const avg = recent.length ? recent.reduce((a, o) => a + o.timing.totalMs, 0) / recent.length : 0;
  const today = c.now.slice(0, 10);
  const callsToday = c.attributor.log.filter((o) => o.t.slice(0, 10) === today).length;
  const escToday = c.attributor.log.filter((o) => o.t.slice(0, 10) === today).reduce((a, o) => a + o.escalations, 0);
  return (
    <div className="panel">
      <h3>{d.perf}</h3>
      <div className="kv">
        <b>inference</b>
        <span>
          {c.modelStatus}
          <div className="chips" style={{ marginTop: 4 }}>
            <button className={c.inference === 'rules' ? 'on' : ''} disabled={c.busy} onClick={() => void c.useInference('rules')}>
              rules
            </button>
            <button className={c.inference === 'litertlm-e2b' ? 'on' : ''} disabled={c.busy} onClick={() => void c.useInference('litertlm-e2b')}>
              Gemma 4 E2B · LiteRT-LM WebGPU
            </button>
            <button className={c.inference === 'llama' ? 'on' : ''} disabled={c.busy} onClick={() => void c.useInference('llama')}>
              localhost
            </button>
          </div>
        </span>
        <b>embedding</b>
        <span>
          {c.embeddingStatus}
          <div className="chips" style={{ marginTop: 4 }}>
            <button className={c.embedding === 'hashed' ? 'on' : ''} disabled={c.busy} onClick={() => void c.useEmbedding('hashed')}>
              lexical
            </button>
            <button className={c.embedding === 'gemma' ? 'on' : ''} disabled={c.busy} onClick={() => void c.useEmbedding('gemma')}>
              EmbeddingGemma 2 · ONNX
            </button>
            <button className={c.embedding === 'litertlm' ? 'on' : ''} disabled={c.busy} onClick={() => void c.useEmbedding('litertlm')}>
              EmbeddingGemma 2 · LiteRT-LM
            </button>
          </div>
        </span>
        <b>escalation</b>
        <span>
          {escalate ? `${escalate.name} · ${escalate.stats().backend}${escalate.stats().loadMs ? ` · last load ${(escalate.stats().loadMs! / 1000).toFixed(1)} s` : ' · not loaded yet'}` : 'off (low conf → ask user)'}
          <div className="chips" style={{ marginTop: 4 }}>
            <button onClick={() => void c.useEscalation(!escalate)}>{escalate ? 'disarm E4B' : 'arm E4B on demand'}</button>
          </div>
        </span>
        <b>calls</b>
        <span>
          {is.calls} inference ({is.lastMs.toFixed(0)} ms last{is.lastTokensPerSec ? `, ${is.lastTokensPerSec.toFixed(0)} tok/s` : ''}) · {es.calls} embedding ({es.lastMs.toFixed(0)} ms last)
        </span>
        <b>per event</b>
        <span>
          avg {avg.toFixed(1)} ms over last {recent.length} · today {callsToday} local, {escToday} escalated
        </span>
        <b>channel</b>
        <span>
          {ch.size} unattached{ch.clusters.length ? ` · clusters: ${ch.clusters.map((k) => `${k.entity}×${k.n}`).join(', ')}` : ''}
        </span>
        <b>graph</b>
        <span>
          {c.graph.objects.size} objects · {c.graph.edges.size} edges · {c.graph.propositions.size} propositions · {c.graph.corrections.size} corrections · {[...c.plans.values()].reduce((a, p) => a + (p.rationale.conflicts?.length ?? 0), 0)} structure conflicts (fallbacks)
        </span>
        <b>executions</b>
        <span>{c.executions.length ? c.executions.slice(-3).map((e) => `${e.action.intent}: ${e.result.slice(0, 60)}`).join(' · ') : 'none yet'}</span>
      </div>
      <div className="log" style={{ marginTop: 8 }}>
        {c.logs.slice(-8).map((l, i) => (
          <div key={i}>{l.text}</div>
        ))}
      </div>
    </div>
  );
}

export function FeedPanel() {
  const c = useController();
  const d = dict(c.lang);
  const [text, setText] = useState('');
  const [sender, setSender] = useState('');
  const [source, setSource] = useState<EventSource>('message');
  const people = c.graph.objectsOfType('person').map((p) => p.displayName);
  return (
    <div className="panel">
      <h3>{d.feed}</h3>
      <div style={{ display: 'grid', gap: 6 }}>
        <div className="toolbar">
          <select value={source} onChange={(e) => setSource(e.target.value as EventSource)}>
            {(['message', 'notification', 'calendar', 'media', 'world', 'workout', 'manual'] as EventSource[]).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <input list="people" placeholder="sender" value={sender} onChange={(e) => setSender(e.target.value)} style={{ flex: 1 }} />
          <datalist id="people">
            {people.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </div>
        <textarea rows={2} placeholder="type a message…" value={text} onChange={(e) => setText(e.target.value)} />
        <button
          className="primary"
          disabled={c.busy || !text.trim()}
          onClick={() => {
            void c.feed({ text, sender, source });
            setText('');
          }}
        >
          {d.send}
        </button>
      </div>
    </div>
  );
}

/** Move a proposition to another matter (or a new one), then offer to widen the scope. */
export function CorrectionDialog() {
  const c = useController();
  const d = dict(c.lang);
  const pid = c.correcting;
  const prop = pid ? c.graph.propositions.get(pid) : undefined;
  const [mode, setMode] = useState<'pick' | 'new'>('pick');
  const [name, setName] = useState('');
  const [when, setWhen] = useState('');
  const [place, setPlace] = useState('');
  useEffect(() => {
    setMode('pick');
    // Prefill only from what was observed in this message: a place-like entity and a future date it names.
    // The name is the user's to give — the system must not know things it has not seen.
    const ents = (prop?.entities ?? []).filter((e) => e.toLowerCase() !== (prop?.source.sender ?? '').toLowerCase());
    const placeEnt = ents.find((e) => /\b(theatre|theater|gym|park|hall|arena|center|centre|club|stadium)\b/i.test(e));
    setName('');
    setWhen(prop?.dateRef && prop.dateRef.slice(0, 10) > prop.t.slice(0, 10) && prop.kind !== 'request' ? prop.dateRef.slice(0, 16) : '');
    setPlace(placeEnt ?? '');
  }, [pid]);
  if (!prop) return null;
  const current = prop.attributedTo;
  const dom = current ? c.graph.domainOf(current) : undefined;
  const matters = c.graph.matters().filter((m) => m.id !== current && m.worldState !== 'past').sort((a, b) => (c.graph.domainOf(a.id) === dom ? -1 : 0) - (c.graph.domainOf(b.id) === dom ? -1 : 0));
  const others = [...c.graph.objects.values()].filter((o) => (o.type === 'goal' || o.type === 'activity' || o.type === 'commitment') && o.id !== current && !(o.type === 'activity' && o.domain));
  return (
    <div className="dialog" onClick={() => c.closeCorrection()}>
      <div className="box" onClick={(e) => e.stopPropagation()}>
        <h3>{d.moveTo}</h3>
        <div style={{ color: 'var(--muted)', marginBottom: 10 }}>“{prop.text}”</div>
        {mode === 'pick' ? (
          <>
            {matters.map((m) => (
              <button key={m.id} className="opt" onClick={() => c.correct(prop.id, m.id, 'instance')}>
                {m.displayName} <span className="pill">{m.when ? fmtDate(m.when, c.lang) : m.shape}</span>
              </button>
            ))}
            {others.map((o) => (
              <button key={o.id} className="opt" onClick={() => c.correct(prop.id, o.id, 'instance')}>
                {o.displayName} <span className="pill">{d.objectTypes[o.type]}</span>
              </button>
            ))}
            <button className="opt primary" onClick={() => setMode('new')}>
              + {d.newMatter}
            </button>
          </>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            <input placeholder="name" value={name} onChange={(e) => setName(e.target.value)} />
            <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
            <input placeholder="place" value={place} onChange={(e) => setPlace(e.target.value)} />
            <button
              className="primary"
              disabled={!name.trim()}
              onClick={() => {
                const domainAct = dom ? c.graph.domainActivity(dom) : undefined;
                const m = c.createMatter({ displayName: name.trim(), when: when ? `${when}:00${c.now.slice(-6)}` : undefined, place: place || undefined, domainId: domainAct?.id, entities: name.split(/\s+at\s+|\s+@\s+/).map((x) => x.trim()) });
                c.correct(prop.id, m.id, 'instance');
              }}
            >
              create & move
            </button>
          </div>
        )}
        <button className="ghost" style={{ marginTop: 8 }} onClick={() => c.closeCorrection()}>
          cancel
        </button>
      </div>
    </div>
  );
}

/** "From now on, route X's messages to Y?" — the scope prompt after an instance correction. */
export function ScopePrompt() {
  const c = useController();
  const d = dict(c.lang);
  const p = c.pendingScope;
  if (!p) return null;
  const scopes: Scope[] = ['relation'];
  return (
    <div className="sticky-note">
      <span>{d.confirmScope(p.sender ?? '?', c.objectName(p.toObjectId))}</span>
      {scopes.map((s) => (
        <button key={s} className="primary" onClick={() => c.widenScope(s)}>
          {d.yes}
        </button>
      ))}
      <button onClick={() => c.dismissScope()}>{d.onlyThis}</button>
    </div>
  );
}
