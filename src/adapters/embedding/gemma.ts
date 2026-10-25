/**
 * EmbeddingGemma 2 via Transformers.js (ONNX, q4). Browser: WebGPU with WASM fallback; Node: CPU.
 * Model files are served from /models (browser) or read from ./models (Node) so everything works offline.
 * Prefixes follow the model card: query → "task: search result | query: …", document → "title: none | text: …".
 */
import type { EmbeddingAdapter, InferenceStats } from '@/contract/types';

export interface GemmaEmbeddingOptions {
  modelId?: string;
  device?: 'webgpu' | 'wasm' | 'cpu' | 'auto';
  dtype?: 'q4' | 'q8' | 'fp32';
  /** Node: absolute path of the local models dir. Browser: URL prefix (default '/models/'). */
  localPath?: string;
  dim?: 768 | 512 | 256 | 128;
  onProgress?: (msg: string) => void;
}

type Extractor = (texts: string[], opts: { pooling: 'mean'; normalize: boolean }) => Promise<{ dims: number[]; data: Float32Array; tolist(): number[][] }>;

export class GemmaEmbedding implements EmbeddingAdapter {
  readonly name: string;
  readonly dim: number;
  private extractor?: Extractor;
  private loading?: Promise<void>;
  private calls = 0;
  private totalMs = 0;
  private lastMs = 0;
  private loadMs?: number;
  private backend = 'unloaded';
  constructor(private opts: GemmaEmbeddingOptions = {}) {
    this.dim = opts.dim ?? 256;
    this.name = `embeddinggemma-2:${opts.dtype ?? 'q4'}`;
  }
  stats(): InferenceStats {
    return { calls: this.calls, totalMs: this.totalMs, lastMs: this.lastMs, loadMs: this.loadMs, backend: this.backend };
  }
  ready(): Promise<void> {
    if (!this.loading) this.loading = this.load();
    return this.loading;
  }
  private async load(): Promise<void> {
    const t0 = performance.now();
    const tf = await import('@huggingface/transformers');
    const { env, pipeline, AutoConfig } = tf as unknown as {
      env: Record<string, unknown> & { backends: { onnx: { wasm: Record<string, unknown> } } };
      pipeline: (task: string, id: string, o: Record<string, unknown>) => Promise<unknown>;
      AutoConfig: { from_pretrained: (id: string) => Promise<Record<string, unknown>> };
    };
    const id = this.opts.modelId ?? 'onnx-community/embeddinggemma-2-ONNX';
    const isNode = typeof process !== 'undefined' && !!(process as { versions?: { node?: string } }).versions?.node;
    if (this.opts.localPath) {
      env.localModelPath = this.opts.localPath;
      env.allowRemoteModels = false;
    }
    if (!isNode) {
      // Two different URL rules in two libraries:
      //  - onnxruntime-web resolves a relative wasmPaths against its own module URL, so it needs an absolute URL;
      //  - Transformers.js treats an http(s) localModelPath as "remote" and skips local loading, so it needs a path.
      const base = typeof document !== 'undefined' ? document.baseURI : location.href;
      env.allowLocalModels = true;
      if (!this.opts.localPath) env.localModelPath = new URL('models/', base).pathname;
      env.allowRemoteModels = false;
      env.backends.onnx.wasm.wasmPaths = new URL('ort/', base).href;
    }
    const config = await AutoConfig.from_pretrained(id);
    (config as Record<string, unknown>).vision_config = null; // text-only: skip the vision/audio encoders
    (config as Record<string, unknown>).audio_config = null;
    let device = this.opts.device ?? 'auto';
    if (device === 'auto') {
      if (isNode) device = 'cpu';
      else device = typeof navigator !== 'undefined' && 'gpu' in navigator ? 'webgpu' : 'wasm';
    }
    const dtype = this.opts.dtype ?? 'q4';
    this.opts.onProgress?.(`loading ${id} (${dtype}, ${device})`);
    try {
      this.extractor = (await pipeline('feature-extraction', id, { config, device, dtype, progress_callback: (p: { status?: string; file?: string; progress?: number }) => p.file && p.progress && this.opts.onProgress?.(`${p.file} ${p.progress.toFixed(0)}%`) })) as Extractor;
      this.backend = device;
    } catch (e) {
      if (device === 'webgpu') {
        this.opts.onProgress?.(`webgpu failed (${String(e).slice(0, 80)}), falling back to wasm`);
        this.extractor = (await pipeline('feature-extraction', id, { config, device: 'wasm', dtype })) as Extractor;
        this.backend = 'wasm';
      } else throw e;
    }
    this.loadMs = performance.now() - t0;
  }
  async embed(texts: string[], mode: 'query' | 'document'): Promise<Float32Array[]> {
    await this.ready();
    const t0 = performance.now();
    const prefixed = texts.map((t) => (mode === 'query' ? `task: search result | query: ${t.trim()}` : `title: none | text: ${t.trim()}`));
    const out: Float32Array[] = [];
    // Keep batches small: WebGPU dispatch limit (~2.7k tokens per batch) and memory.
    // The pipeline is a self-referencing callable: invoke it bare, never as a method (that would rebind `this`).
    const run = this.extractor!;
    for (let i = 0; i < prefixed.length; i += 8) {
      const batch = prefixed.slice(i, i + 8);
      const res = await run(batch, { pooling: 'mean', normalize: true });
      const rows = res.tolist();
      for (const row of rows) {
        const v = new Float32Array(row.slice(0, this.dim));
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
