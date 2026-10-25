/**
 * Shared prompts, schemas (≤4 fields each) and strict parsers for every model adapter.
 * Parsers never throw: a malformed answer degrades to the rules path, which is logged as a fallback.
 */
import type { ConfirmRequest, ConfirmResponse, ExtractRequest, ExtractResponse, ExtractedProposition, RelationType, WorldState } from '@/contract/types';
import { RulesInference } from './rules';
import { classifyKind, detectWorldState, extractEntities, resolveDateRef } from '@/core/triage';

const rules = new RulesInference();

export const SYSTEM_EXTRACT = `You turn ONE observed event from a person's phone into short propositions about the person's life.
Rules:
- Output JSON only, matching the schema. No prose.
- "propositions": 0–2 items. Each: "text" (one sentence, third person, keep names, places and dates as written), "conf" 0–1, "entities" (proper names of people, bands, venues, places, things mentioned — include the sender's name when there is one; never the word "sender"), "kind": "fact" | "habit" | "request" (request = the sender wants the person to do something or to answer).
- "verdict": "keep" is the default. "drop" only when the text is an advertisement, a receipt, or the device talking about itself (battery, updates, sign-ins, reactions). A notice with a code, a time, a place, a delay or a change is "keep" even if an app sent it; so is any message from a person.
- "dateRef": the ISO date-time the event TALKS ABOUT (a show date, a class time, a deadline such as "before the 12th"), resolved with "today"; "none" if the text names no date or time.
- "worldState": "rescheduled" only if something was moved to a new time, "cancelled" only if cancelled/closed/called off; otherwise "none".
Example input: today: 2026-10-27T15:10:00-07:00 / event: {"source":"message","sender":"Marcus (Coach)","text":"Tonight we do pad work — bring your own hand wraps and gloves."}
Example output: {"propositions":[{"text":"Marcus (Coach) asks to bring hand wraps and gloves to tonight's session","conf":0.9,"entities":["Marcus (Coach)","hand wraps","gloves"],"kind":"request"}],"verdict":"keep","dateRef":"2026-10-27T19:00:00-07:00","worldState":"none"}`;

export const EXTRACT_SCHEMA = {
  type: 'object',
  properties: {
    propositions: {
      type: 'array',
      maxItems: 2,
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          conf: { type: 'number' },
          entities: { type: 'array', items: { type: 'string' }, maxItems: 6 },
          kind: { type: 'string', enum: ['fact', 'habit', 'request'] },
        },
        required: ['text', 'conf', 'entities', 'kind'],
      },
    },
    verdict: { type: 'string', enum: ['keep', 'drop'] },
    dateRef: { type: 'string' },
    worldState: { type: 'string', enum: ['none', 'rescheduled', 'cancelled'] },
  },
  required: ['propositions', 'verdict', 'dateRef', 'worldState'],
};

export function buildExtractPrompt(req: ExtractRequest): string {
  const ev = req.event;
  const known = req.knownEntities.slice(0, 40).join('; ');
  return [
    `today: ${req.today}`,
    `event: ${JSON.stringify({ source: ev.source, sender: ev.sender ?? null, app: ev.app ?? null, text: ev.text ?? '', meta: ev.meta ?? null, t: ev.t })}`,
    `known entities on the person's life graph: ${known || '(none)'}`,
  ].join('\n');
}

export const SYSTEM_CONFIRM = `You decide which existing object on a person's life graph a proposition belongs to.
Rules:
- Output JSON only, matching the schema. No prose.
- "objectId": one of the candidate ids exactly as given, or "new" if the proposition is about a dated event/task that no candidate represents, or "none" if it is about none of them.
- A dated instance of a recurring activity that IS a candidate (a class, a session, a run of an activity listed there) belongs to that activity: answer with the activity's id, never "new". Listening/workout habits are never "new".
- "relation": "refers-to" for a message pointing at the object, "evidence-for" for facts/habits supporting it, "part-of" only for components.
- "conf" 0–1. Be honest: when two candidates fit similarly, or the text gives little evidence, answer below 0.45.
- If a constraint is listed, it is a rule the user set: follow it with conf 0.95.
- "newObject": only when objectId is "new": {"type":"matter","displayName":"<short name, e.g. Band at Venue>","when":"<ISO or none>","place":"<venue or none>"}; otherwise {"type":"matter","displayName":"none","when":"none","place":"none"}.`;

export const CONFIRM_SCHEMA = {
  type: 'object',
  properties: {
    objectId: { type: 'string' },
    relation: { type: 'string', enum: ['refers-to', 'evidence-for', 'part-of'] },
    conf: { type: 'number' },
    newObject: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['matter', 'preference', 'commitment'] },
        displayName: { type: 'string' },
        when: { type: 'string' },
        place: { type: 'string' },
      },
      required: ['type', 'displayName', 'when', 'place'],
    },
  },
  required: ['objectId', 'relation', 'conf', 'newObject'],
};

export function buildConfirmPrompt(req: ConfirmRequest): string {
  const p = req.proposition;
  return [
    `today: ${req.today}`,
    `proposition: ${JSON.stringify({ text: p.text, sender: p.sender ?? null, source: p.source, t: p.t, entities: p.entities, kind: p.kind })}`,
    `candidates: ${JSON.stringify(req.candidates.map((c) => ({ id: c.objectId, type: c.type, name: c.displayName, summary: c.summary.slice(0, 200), retrievalScore: c.score })))}`,
    `constraints: ${JSON.stringify(req.constraints.map((c) => ({ scope: c.scope, toObjectId: c.toObj, because: c.evidence })))}`,
  ].join('\n');
}

function extractJson(raw: string): unknown {
  const s = raw.trim();
  try {
    return JSON.parse(s);
  } catch {
    const m = s.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}

export interface ParseStats {
  fallbacks: number;
}
export const parseStats: ParseStats = { fallbacks: 0 };

export function parseExtract(raw: string, req: ExtractRequest): ExtractResponse {
  const j = extractJson(raw) as Partial<ExtractResponse> & { worldState?: WorldState | null; dateRef?: string | null } | undefined;
  if (!j || !Array.isArray(j.propositions)) {
    parseStats.fallbacks += 1;
    return rulesExtract(req);
  }
  const props: ExtractedProposition[] = [];
  for (const p of j.propositions.slice(0, 2)) {
    if (!p || typeof p.text !== 'string' || !p.text.trim()) continue;
    const entities = Array.isArray(p.entities) ? p.entities.filter((e): e is string => typeof e === 'string' && e.trim().length > 0 && !/^(sender|none|null)$/i.test(e.trim())).slice(0, 6) : [];
    if (req.event.sender && !entities.some((e) => e.toLowerCase() === req.event.sender!.toLowerCase())) entities.unshift(req.event.sender);
    const kind = p.kind === 'fact' || p.kind === 'habit' || p.kind === 'request' ? p.kind : classifyKind(p.text, req.event.source);
    props.push({ text: p.text.trim().slice(0, 240), conf: clamp01(Number(p.conf)), entities: [...new Set(entities)], kind });
  }
  const verdict = j.verdict === 'drop' || props.length === 0 ? 'drop' : 'keep';
  const res: ExtractResponse = { propositions: verdict === 'drop' ? [] : props, verdict };
  const dateRef = typeof j.dateRef === 'string' && /^\d{4}-\d{2}-\d{2}/.test(j.dateRef) && j.dateRef.slice(0, 16) !== req.event.t.slice(0, 16) ? normalizeIso(j.dateRef, req.event.t) : undefined;
  const fallbackDate = req.event.text ? resolveDateRef(req.event.text, req.event.t) : undefined;
  if (dateRef) res.dateRef = dateRef;
  else if (fallbackDate) res.dateRef = fallbackDate;
  const ws = j.worldState === 'rescheduled' || j.worldState === 'cancelled' ? j.worldState : req.event.text ? detectWorldState(req.event.text) : undefined;
  if (ws) res.worldState = ws;
  return res;
}

export async function parseConfirm(raw: string, req: ConfirmRequest): Promise<ConfirmResponse> {
  const j = extractJson(raw) as Partial<ConfirmResponse> | undefined;
  const relationDefault: RelationType = req.proposition.source === 'message' ? 'refers-to' : 'evidence-for';
  if (!j || typeof j.objectId !== 'string') {
    parseStats.fallbacks += 1;
    return rules.confirm(req);
  }
  const relation: RelationType = j.relation === 'refers-to' || j.relation === 'evidence-for' || j.relation === 'part-of' ? j.relation : relationDefault;
  const conf = clamp01(Number(j.conf));
  const id = j.objectId.trim();
  if (id === 'new') {
    const n = j.newObject;
    if (!n || typeof n.displayName !== 'string' || /^none$/i.test(n.displayName)) {
      parseStats.fallbacks += 1;
      return rules.confirm(req);
    }
    const when = typeof n.when === 'string' && /^\d{4}-\d{2}-\d{2}/.test(n.when) ? normalizeIso(n.when, req.proposition.t) : resolveDateRef(req.proposition.text, req.proposition.t);
    const type = n.type === 'preference' || n.type === 'commitment' ? n.type : 'matter';
    // Ontology guard, enforced in code rather than trusted to the model: only dated things are matters, and a habit
    // (listening, workouts) never creates an object by itself — repeated evidence promotes it from the channel.
    if (req.proposition.kind === 'habit' || (type === 'matter' && !when)) return { objectId: 'none', relation, conf: Math.min(conf, 0.6) };
    return { objectId: 'new', relation, conf, newObject: { type, displayName: n.displayName.slice(0, 80), shape: 'approaching-event', when, place: typeof n.place === 'string' && !/^none$/i.test(n.place) ? n.place : undefined } };
  }
  if (id === 'none') return { objectId: 'none', relation, conf };
  const chosen = req.candidates.find((c) => c.objectId === id);
  if (chosen) {
    // Small models report near-constant confidence; blend it with the retrieval evidence so that a pick with neither
    // lexical nor structural support cannot clear the attribution threshold on the model's say-so alone.
    const evidence = chosen.signals ? Math.max(chosen.signals.lexical, chosen.signals.structural) : 1;
    const blended = evidence > 0 ? 0.6 * conf + 0.4 * Math.min(1, chosen.score) : Math.min(conf, 0.4);
    return { objectId: id, relation, conf: Number(blended.toFixed(2)) };
  }
  if (!req.candidates.some((c) => c.objectId === id)) {
    // Model invented an id: map by name if possible, otherwise fall back.
    const byName = req.candidates.find((c) => c.displayName.toLowerCase() === id.toLowerCase());
    if (byName) return { objectId: byName.objectId, relation, conf };
    parseStats.fallbacks += 1;
    return rules.confirm(req);
  }
  return { objectId: id, relation, conf };
}

function rulesExtract(req: ExtractRequest): ExtractResponse {
  // Synchronous mirror of RulesInference.extract for fallback (keeps parsers non-async).
  const ev = req.event;
  const text = (ev.text ?? '').trim();
  if (!text) return { propositions: [], verdict: 'drop' };
  const entities = extractEntities(text, req.knownEntities);
  if (ev.sender) entities.unshift(ev.sender);
  const res: ExtractResponse = { propositions: [{ text: `${ev.sender ? ev.sender + ': ' : ''}${text.slice(0, 180)}`, conf: 0.6, entities: [...new Set(entities)], kind: classifyKind(text, ev.source) }], verdict: 'keep' };
  const d = resolveDateRef(text, ev.t);
  if (d) res.dateRef = d;
  const ws = detectWorldState(text);
  if (ws) res.worldState = ws;
  return res;
}

function clamp01(x: number): number {
  return Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0.5;
}

/** Accept "2026-11-08", "2026-11-08T20:00", or full ISO; attach the event's offset when missing. */
function normalizeIso(s: string, ref: string): string {
  const off = ref.slice(-6);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T00:00:00${off}`;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) return `${s}:00${off}`;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(s)) return `${s}${off}`;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:\d{2})$/.test(s)) return s.replace(/Z$/, off);
  return `${s.slice(0, 10)}T00:00:00${off}`;
}
