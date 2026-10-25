/**
 * Rules inference adapter: a realistic, imperfect stand-in with the same contract as the model adapters.
 * General English heuristics only (dates, proper nouns, request/fact cues). It errs the way a small model errs:
 * when the text carries little evidence it picks the best-scoring candidate with modest confidence.
 */
import type { ConfirmRequest, ConfirmResponse, ExtractRequest, ExtractResponse, InferenceAdapter, InferenceStats, ExtractedProposition } from '@/contract/types';
import { classifyKind, detectWorldState, extractEntities, resolveDateRef, structuredExtract, triage } from '@/core/triage';
import { clamp } from '@/core/util';

const VENUE = /\b(theatre|theater|gym|park|hall|arena|center|centre|club|stadium|fillmore|warfield|chapel|independent|bart)\b/i;

export class RulesInference implements InferenceAdapter {
  readonly name = 'rules';
  readonly kind = 'rules' as const;
  private calls = 0;
  private totalMs = 0;
  private lastMs = 0;
  async ready(): Promise<void> {}
  stats(): InferenceStats {
    return { calls: this.calls, totalMs: this.totalMs, lastMs: this.lastMs, backend: 'cpu-js' };
  }
  private tick(t0: number): void {
    this.calls += 1;
    this.lastMs = performance.now() - t0;
    this.totalMs += this.lastMs;
  }

  async extract(req: ExtractRequest): Promise<ExtractResponse> {
    const t0 = performance.now();
    const ev = req.event;
    const text = (ev.text ?? '').trim();
    if (triage(ev) === 'drop' || !text) {
      this.tick(t0);
      return { propositions: [], verdict: 'drop' };
    }
    // Structured records (media, workout, calendar) are mapped, not inferred — shared with every adapter through core.
    const structured = structuredExtract(ev, req.knownEntities);
    if (structured) {
      this.tick(t0);
      return structured;
    }
    const props: ExtractedProposition[] = [];
    const dateRef = resolveDateRef(text, ev.t);
    const entities = extractEntities(text, req.knownEntities);
    if (ev.sender) entities.unshift(ev.sender);
    const kind = classifyKind(text, ev.source);
    const appPrefix = ev.app && !text.toLowerCase().startsWith(ev.app.toLowerCase()) ? `${ev.app}: ` : '';
    const prefix = ev.sender ? `${ev.sender}: ` : ev.source === 'calendar' ? 'Calendar: ' : appPrefix;
    const body = text.length > 180 ? text.slice(0, 177) + '…' : text;
    props.push({ text: `${prefix}${body}`, conf: ev.source === 'calendar' || ev.source === 'world' ? 0.9 : 0.75, entities: [...new Set(entities)], kind });
    const worldState = detectWorldState(text);
    this.tick(t0);
    const res: ExtractResponse = { propositions: props, verdict: 'keep' };
    if (dateRef) res.dateRef = dateRef;
    if (worldState) res.worldState = worldState;
    return res;
  }

  async confirm(req: ConfirmRequest): Promise<ConfirmResponse> {
    const t0 = performance.now();
    const p = req.proposition;
    const relation = p.source === 'message' ? 'refers-to' : 'evidence-for';
    const hard = req.constraints.find((c) => c.scope !== 'instance');
    if (hard) {
      this.tick(t0);
      return { objectId: hard.toObj, relation, conf: 0.95 };
    }
    const [top, second] = req.candidates;
    const dateRef = resolveDateRef(p.text, p.t);
    // Dated things are matters. A message/announcement about a specific future date with no matter candidate
    // on that date is a new matter, even when a preference or activity candidate matches by name.
    if (dateRef && (p.source === 'message' || p.source === 'world' || p.source === 'calendar') && dateRef.slice(0, 10) > p.t.slice(0, 10)) {
      const sameDate = req.candidates.find((c) => c.type === 'matter' && c.when && Math.abs(new Date(c.when).getTime() - new Date(dateRef).getTime()) < 36 * 3600 * 1000);
      const anyMatter = req.candidates.find((c) => c.type === 'matter');
      const ents = p.entities.filter((e) => e.toLowerCase() !== (p.sender ?? '').toLowerCase());
      const place = ents.find((e) => VENUE.test(e));
      if (!sameDate && (place || !anyMatter) && ents.length) {
        const subject = ents.find((e) => e !== place) ?? ents[0]!;
        this.tick(t0);
        return { objectId: 'new', relation, conf: 0.65, newObject: { type: 'matter', displayName: place ? `${subject} at ${place}` : subject, shape: 'approaching-event', when: dateRef, place } };
      }
    }
    if (!top) {
      // A dated message/world/calendar item with a named place or entity is a new matter; otherwise unattached.
      const ents = p.entities.filter((e) => e.toLowerCase() !== (p.sender ?? '').toLowerCase());
      if (dateRef && (p.source === 'message' || p.source === 'world' || p.source === 'calendar') && ents.length) {
        const place = ents.find((e) => VENUE.test(e));
        const subject = ents.find((e) => e !== place) ?? ents[0]!;
        this.tick(t0);
        return { objectId: 'new', relation, conf: 0.6, newObject: { type: 'matter', displayName: place ? `${subject} at ${place}` : subject, shape: 'approaching-event', when: dateRef, place } };
      }
      this.tick(t0);
      return { objectId: 'none', relation, conf: 0.8 };
    }
    const gap = second ? top.score - second.score : 1;
    // Confidence tracks the retrieval score; a lone weak candidate stays below the attribution threshold.
    let conf = clamp(0.9 * clamp(top.score) + (second ? 0.15 * clamp(gap * 4) : 0.05), 0, 0.92);
    // Without lexical or structural evidence a match is the embedding's opinion alone: keep it in the channel
    // (a model confirmer may still accept it; this adapter does not).
    const sig = top.signals;
    if (sig && sig.lexical === 0 && sig.structural === 0) conf = Math.min(conf, 0.4);
    this.tick(t0);
    return { objectId: top.objectId, relation, conf: Number(conf.toFixed(2)) };
  }
}
