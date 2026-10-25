/**
 * EmbeddingGemma 2 through LiteRT-LM JS (`@litert-lm/core` EmbeddingEngine, WebGPU): the same runtime that serves
 * Gemma 4 E2B, so the whole on-device chain runs on LiteRT. Same prompt prefixes and 256-dim MRL truncation as the
 * ONNX adapter, so the vectors are comparable (not identical: different quantization).
 */
import type { EmbeddingAdapter, InferenceStats } from '@/contract/types';
import { litertlmRuntime } from '../litertlmRuntime';

export interface LiteRtLmEmbeddingOptions {
  modelUrl: string;
  wasmPath?: string;
  dim?: 768 | 512 | 256 | 128;
  backend?: 'gpu' | 'cpu';
  onProgress?: (msg: string) => void;
}

type LiteRtModule = typeof import('@litert-lm/core');

export class LiteRtLmEmbedding implements EmbeddingAdapter {
  readonly name = 'embeddinggemma-2:litert-lm';
  readonly dim: number;
  private mod?: LiteRtModule;
  private engine?: import('@litert-lm/core').EmbeddingEngine;
  private loading?: Promise<void>;
  private calls = 0;
  private totalMs = 0;
  private lastMs = 0;
  private loadMs?: number;
  constructor(private opts: LiteRtLmEmbeddingOptions) {
    this.dim = opts.dim ?? 256;
  }
  stats(): InferenceStats {
    return { calls: this.calls, totalMs: this.totalMs, lastMs: this.lastMs, loadMs: this.loadMs, backend: `litert-lm ${this.opts.backend ?? 'webgpu'}${this.engine ? '' : ' (unloaded)'}` };
  }
  ready(): Promise<void> {
    if (!this.loading) this.loading = this.load();
    return this.loading;
  }
  private async load(): Promise<void> {
    const t0 = performance.now();
    this.opts.onProgress?.('loading LiteRT-LM wasm');
    this.mod = await litertlmRuntime(this.opts.wasmPath);
    this.opts.onProgress?.(`creating embedding engine for ${this.opts.modelUrl}`);
    // Short signatures only: propositions and object summaries are a few hundred tokens at most, and every prepared
    // signature costs load time.
    const settings: Parameters<LiteRtModule['EmbeddingEngine']['create']>[0] = { model: this.opts.modelUrl, maxInputLength: 512, minInputLength: 128 };
    if (this.opts.backend === 'cpu') settings.backend = this.mod.Backend.CPU;
    this.engine = await this.mod.EmbeddingEngine.create(settings);
    this.loadMs = performance.now() - t0;
    this.opts.onProgress?.(`embedding engine ready in ${(this.loadMs / 1000).toFixed(1)} s`);
  }
  async unload(): Promise<void> {
    const e = this.engine;
    this.engine = undefined;
    this.loading = undefined;
    if (e) await e.delete();
  }
  async embed(texts: string[], mode: 'query' | 'document'): Promise<Float32Array[]> {
    await this.ready();
    const t0 = performance.now();
    const prefixed = texts.map((t) => (mode === 'query' ? `task: search result | query: ${t.trim()}` : `title: none | text: ${t.trim()}`));
    const out: Float32Array[] = [];
    for (let i = 0; i < prefixed.length; i += 8) {
      const batch = prefixed.slice(i, i + 8);
      // BOS/EOS as in the model card's tokenizer; without them the vectors drift from the ONNX build's.
      const res = await this.engine!.computeEmbeddingBatch(batch, { normalize: true, outputSize: this.dim, insertSpecialTokens: true });
      for (const r of res) {
        const v = new Float32Array(r.embedding.slice(0, this.dim));
        let n = 0;
        for (let k = 0; k < v.length; k++) n += (v[k] ?? 0) ** 2;
        n = Math.sqrt(n) || 1;
        for (let k = 0; k < v.length; k++) v[k] = (v[k] ?? 0) / n;
        out.push(v);
      }
    }
    this.calls += 1;
    this.lastMs = performance.now() - t0;
    this.totalMs += this.lastMs;
    return out;
  }
}
