/**
 * Lexical hashed embedding (word unigrams + bigrams + char trigrams, signed feature hashing, L2 norm).
 * Dependency-free, runs in Node and the browser. It is the retrieval fallback until EmbeddingGemma 2 is loaded
 * and the embedding used by unit tests. Same interface as the model adapter.
 */
import type { EmbeddingAdapter, InferenceStats } from '@/contract/types';
import { normalize } from '@/core/util';

const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'at', 'for', 'is', 'are', 'it', 'you', 'we', 'i', 'me', 'my', 'your', 'so', 'be', 'this', 'that', 'with', 'can', 'if', 'by']);

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export class HashedEmbedding implements EmbeddingAdapter {
  readonly name = 'hashed-lexical';
  readonly dim: number;
  private calls = 0;
  private totalMs = 0;
  private lastMs = 0;
  constructor(dim = 512) {
    this.dim = dim;
  }
  async ready(): Promise<void> {}
  stats(): InferenceStats {
    return { calls: this.calls, totalMs: this.totalMs, lastMs: this.lastMs, backend: 'cpu-js' };
  }
  async embed(texts: string[], _mode: 'query' | 'document'): Promise<Float32Array[]> {
    const t0 = performance.now();
    const out = texts.map((t) => this.one(t));
    this.calls += 1;
    this.lastMs = performance.now() - t0;
    this.totalMs += this.lastMs;
    return out;
  }
  private add(v: Float32Array, feat: string, w: number): void {
    const h = fnv1a(feat);
    const idx = h % this.dim;
    const sign = (h >>> 31) === 0 ? 1 : -1;
    v[idx] = (v[idx] ?? 0) + sign * w;
  }
  private one(text: string): Float32Array {
    const v = new Float32Array(this.dim);
    const words = normalize(text).split(' ').filter((w) => w.length > 1 && !STOP.has(w));
    for (let i = 0; i < words.length; i++) {
      const w = words[i]!;
      this.add(v, 'w:' + w, 1.0);
      if (i + 1 < words.length) this.add(v, 'b:' + w + '_' + words[i + 1], 0.8);
      const padded = `_${w}_`;
      for (let j = 0; j + 3 <= padded.length; j++) this.add(v, 'c:' + padded.slice(j, j + 3), 0.35);
    }
    let n = 0;
    for (let i = 0; i < v.length; i++) n += (v[i] ?? 0) ** 2;
    n = Math.sqrt(n) || 1;
    for (let i = 0; i < v.length; i++) v[i] = (v[i] ?? 0) / n;
    return v;
  }
}
