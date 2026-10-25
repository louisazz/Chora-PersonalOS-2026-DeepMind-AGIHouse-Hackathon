import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defaultPersona } from '../src/synth/persona';
import { generateFixture } from '../src/synth/generate';

const { fixture, stats } = generateFixture(defaultPersona);
const outDir = resolve(import.meta.dirname, '../public/fixtures');
mkdirSync(outDir, { recursive: true });
const out = resolve(outDir, 'persona-default.json');
writeFileSync(out, JSON.stringify(fixture, null, 2));
console.log(`wrote ${out}`);
console.log(JSON.stringify(stats, null, 2));
const pct = (k: string) => (((stats.byCls[k] ?? 0) / stats.total) * 100).toFixed(1) + '%';
console.log(`noise ${pct('noise')} · ambiguous ${pct('ambiguous')} · contradiction ${pct('contradiction')} · signal ${pct('signal')}`);
console.log(`days ${fixture.from.slice(0, 10)} → ${fixture.to.slice(0, 10)}; seed objects ${fixture.seedObjects.length}; seed edges ${fixture.seedEdges.length}; corrections ${fixture.corrections.length}; expectations ${fixture.expectations.length}`);
