/**
 * Policy eval: replay the fixture to each annotated expectation point and check what surfaced / stayed silent.
 *   pnpm policy-eval [--embed hashed|gemma]
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Fixture, EmbeddingAdapter } from '../src/contract/types';
import { Graph } from '../src/core/graph';
import { Attributor } from '../src/core/attribution';
import { ReplayEngine } from '../src/core/replay';
import { evaluateSuggestions, inferContext, DEFAULT_POLICY } from '../src/core/policy';
import { RulesInference } from '../src/adapters/inference/rules';
import { HashedEmbedding } from '../src/adapters/embedding/hashed';
import { localISO } from '../src/core/util';

const args = process.argv.slice(2);
const embedName = args[args.indexOf('--embed') + 1] ?? 'hashed';
const fixture = JSON.parse(readFileSync(resolve(import.meta.dirname, '../public/fixtures/persona-default.json'), 'utf8')) as Fixture;

let embed: EmbeddingAdapter;
if (embedName === 'gemma') {
  const { GemmaEmbedding } = await import('../src/adapters/embedding/gemma');
  embed = new GemmaEmbedding({ device: 'cpu', localPath: resolve(import.meta.dirname, '../models') });
} else embed = new HashedEmbedding();
await embed.ready();

const graph = new Graph();
const attributor = new Attributor(graph, embed, new RulesInference());
const replay = new ReplayEngine(fixture, graph, attributor);
replay.seed();

// Template ids (matters the story expects to be created) resolve to whichever matter carries the template's distinctive entity.
const resolveExpected = (id: string): string => {
  if (graph.obj(id)) return id;
  const t = fixture.matterTemplates.find((x) => x.id === id);
  if (!t) return id;
  const others = fixture.matterTemplates.filter((x) => x.id !== t.id);
  const distinct = t.entities.filter((e) => e.length >= 5 && !others.some((o) => o.entities.some((x) => x.toLowerCase() === e.toLowerCase())));
  const m = graph.matters().find((mm) => distinct.some((e) => mm.displayName.toLowerCase().includes(e.toLowerCase()) || (mm.place ?? '').toLowerCase().includes(e.toLowerCase())));
  return m?.id ?? id;
};
// Ancestor-tolerant membership: a session matter counts for its activity.
const matchesObj = (got: string, expectedRaw: string): boolean => {
  const expected = resolveExpected(expectedRaw);
  if (got === expected) return true;
  let frontier = [got];
  for (let hop = 0; hop < 2; hop++) {
    const next: string[] = [];
    for (const id of frontier) for (const e of graph.outEdges(id, 'part-of')) next.push(e.to);
    if (next.includes(expected)) return true;
    frontier = next;
  }
  return false;
};

let pass = 0;
let fail = 0;
const expectations = [...fixture.expectations].sort((a, b) => a.date.localeCompare(b.date));
for (const ex of expectations) {
  const t = localISO(fixture.persona.timezone, Number(ex.date.slice(0, 4)), Number(ex.date.slice(5, 7)), Number(ex.date.slice(8, 10)), Number(ex.date.slice(11, 13)), Number(ex.date.slice(14, 16)));
  await replay.stepToTime(t, true);
  const ctx = inferContext(t, ex.context);
  const ev = evaluateSuggestions(graph, t, ctx, DEFAULT_POLICY);
  for (const want of ex.shouldSurface) {
    const hit = ev.shown.find((s) => matchesObj(s.objectId, want.objectId));
    const ok = !!hit;
    ok ? pass++ : fail++;
    console.log(`${ok ? '✓' : '✗'} ${ex.date} [${ex.context}] should surface ${want.objectId} (${want.why})${hit ? ` → "${hit.title}"` : ` → shown: ${ev.shown.map((s) => s.title).join(' | ') || 'nothing'}; silent: ${ev.silent.map((s) => `${s.title} (${s.silenceReason})`).join(' | ') || 'nothing'}`}`);
  }
  for (const want of ex.shouldStaySilent) {
    const shown = ev.shown.find((s) => matchesObj(s.objectId, want.objectId));
    const silent = ev.silent.find((s) => matchesObj(s.objectId, want.objectId));
    const ok = !shown && (!!silent ? silent.silenceReason === want.reason : true);
    ok ? pass++ : fail++;
    console.log(`${ok ? '✓' : '✗'} ${ex.date} [${ex.context}] should stay silent ${want.objectId} (${want.reason})${shown ? ` → but shown "${shown.title}"` : silent ? ` → silent (${silent.silenceReason})` : ' → nothing drafted'}`);
  }
}
console.log(`\npolicy: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
