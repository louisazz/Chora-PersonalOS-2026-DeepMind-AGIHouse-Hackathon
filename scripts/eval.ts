/**
 * pnpm eval [--infer oracle|rules|llama] [--embed hashed|gemma] [--no-corrections] [--verbose]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Fixture, InferenceAdapter, EmbeddingAdapter } from '../src/contract/types';
import { runEval, summarize } from '../src/core/eval';
import { OracleInference } from '../src/adapters/inference/oracle';
import { RulesInference } from '../src/adapters/inference/rules';
import { HashedEmbedding } from '../src/adapters/embedding/hashed';

const args = process.argv.slice(2);
const flag = (name: string, def: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] ?? def : def;
};
const inferName = flag('infer', 'rules');
const embedName = flag('embed', 'hashed');
const applyCorrections = !args.includes('--no-corrections');
const verbose = args.includes('--verbose');

const fixture = JSON.parse(readFileSync(resolve(import.meta.dirname, '../public/fixtures/persona-default.json'), 'utf8')) as Fixture;

async function main() {
  let infer: InferenceAdapter;
  if (inferName === 'oracle') {
    infer = new OracleInference(fixture, fixture.matterTemplates.map((t) => ({ id: t.id, displayName: t.title, shape: t.shape, when: t.when, place: t.place, type: 'matter' as const })));
  } else if (inferName === 'llama') {
    const { LlamaServerInference } = await import('../src/adapters/inference/llamaServer');
    infer = new LlamaServerInference(flag('url', 'http://127.0.0.1:9931'));
  } else infer = new RulesInference();

  let embed: EmbeddingAdapter;
  if (embedName === 'gemma') {
    const { GemmaEmbedding } = await import('../src/adapters/embedding/gemma');
    embed = new GemmaEmbedding({ device: 'cpu', localPath: resolve(import.meta.dirname, '../models') });
  } else embed = new HashedEmbedding();

  const t0 = Date.now();
  const r = await runEval(fixture, infer, embed, {
    applyCorrections,
    onProgress: (i, n) => {
      if (i % 25 === 0 || i === n) process.stderr.write(`\r${i}/${n}`);
    },
  });
  process.stderr.write('\n');
  console.log(summarize(r));
  console.log(`wall ${(Date.now() - t0) / 1000}s`);
  console.log(`similarity baseline ${r.baseline?.toFixed(3) ?? 'n/a'}`);
  if (verbose) for (const e of r.perEvent) if (!e.ok) console.log(`  ✗ ${e.eventId} [${e.cls}] expected=${e.expected ?? '-'} got=${e.got ?? '-'} outcome=${e.outcome} conf=${e.conf ?? '-'}\n      candidates: ${e.candidates || 'none'}`);
  const outDir = resolve(import.meta.dirname, '../eval-out');
  mkdirSync(outDir, { recursive: true });
  const file = resolve(outDir, `${inferName}-${embedName}${applyCorrections ? '' : '-nocorr'}.json`);
  writeFileSync(file, JSON.stringify(r, null, 2));
  console.log(`wrote ${file}`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
