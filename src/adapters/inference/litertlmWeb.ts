/**
 * In-browser inference with LiteRT-LM JS (@litert-lm/core) running Gemma 4 E2B/E4B `-web.litertlm` on WebGPU.
 * No JSON-schema constraint exists in the JS API, so structure comes from the prompt + strict parsing + fallback.
 * The same class serves as the on-demand escalation layer (E4B): `ready()` measures load time, `unload()` frees it.
 */
import type { ConfirmRequest, ConfirmResponse, ExtractRequest, ExtractResponse, InferenceAdapter, InferenceStats } from '@/contract/types';
import { buildConfirmPrompt, buildExtractPrompt, parseConfirm, parseExtract, SYSTEM_CONFIRM, SYSTEM_EXTRACT } from './prompts';
import { litertlmRuntime } from '../litertlmRuntime';

export interface LiteRtLmWebOptions {
  modelUrl: string;
  wasmPath?: string;
  backend?: 'gpu' | 'cpu';
  maxNumTokens?: number;
  label?: string;
  /** Unload the engine after this many ms idle (escalation layer). 0 = keep resident. */
  idleUnloadMs?: number;
  onProgress?: (msg: string) => void;
}

type LiteRtModule = typeof import('@litert-lm/core');
type Conversation = import('@litert-lm/core').Conversation;
type ConversationConfig = NonNullable<Parameters<import('@litert-lm/core').Engine['createConversation']>[0]>;

export class LiteRtLmWebInference implements InferenceAdapter {
  readonly name: string;
  readonly kind = 'model' as const;
  private mod?: LiteRtModule;
  private engine?: import('@litert-lm/core').Engine;
  private loading?: Promise<void>;
  private queue: Promise<unknown> = Promise.resolve();
  private calls = 0;
  private totalMs = 0;
  private lastMs = 0;
  private lastTps?: number;
  private loadMs?: number;
  private idleTimer?: ReturnType<typeof setTimeout>;
  readonly loads: number[] = [];
  /** One conversation per system prompt, prefilled once; every call clones it so the prompt's KV cache is reused. */
  private bases = new Map<string, Conversation>();
  private cloneSupported?: boolean;
  constructor(private opts: LiteRtLmWebOptions) {
    this.name = opts.label ?? `litert-lm-web:${opts.modelUrl.split('/').pop()}`;
  }
  stats(): InferenceStats {
    const cache = this.cloneSupported === true ? ' · prefix cached' : this.cloneSupported === false ? ' · no prefix cache' : '';
    return { calls: this.calls, totalMs: this.totalMs, lastMs: this.lastMs, lastTokensPerSec: this.lastTps, loadMs: this.loadMs, backend: `webgpu:${this.opts.backend ?? 'gpu'}${this.engine ? cache : ' (unloaded)'}` };
  }
  get loaded(): boolean {
    return !!this.engine;
  }
  ready(): Promise<void> {
    if (this.engine) return Promise.resolve();
    if (!this.loading) this.loading = this.load().finally(() => (this.loading = undefined));
    return this.loading;
  }
  private async load(): Promise<void> {
    const t0 = performance.now();
    this.opts.onProgress?.(`loading LiteRT-LM wasm`);
    this.mod = await litertlmRuntime(this.opts.wasmPath);
    this.opts.onProgress?.(`creating engine for ${this.opts.modelUrl}`);
    // The web runtime picks WebGPU itself; passing a Backend enum value is rejected ("Unsupported backend").
    const settings: Parameters<typeof this.mod.Engine.create>[0] = { model: this.opts.modelUrl, mainExecutorSettings: { maxNumTokens: this.opts.maxNumTokens ?? 2048 } };
    if (this.opts.backend === 'cpu') settings.backend = this.mod.Backend.CPU;
    this.engine = await this.mod.Engine.create(settings);
    this.loadMs = performance.now() - t0;
    this.loads.push(this.loadMs);
    this.opts.onProgress?.(`engine ready in ${(this.loadMs / 1000).toFixed(1)} s`);
  }
  async unload(): Promise<void> {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    const bases = [...this.bases.values()];
    this.bases.clear();
    for (const b of bases) await b.delete().catch(() => undefined);
    const e = this.engine;
    this.engine = undefined;
    if (e) await e.delete();
  }
  private touchIdle(): void {
    if (!this.opts.idleUnloadMs) return;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => void this.unload(), this.opts.idleUnloadMs);
  }
  /** Serialize calls: one conversation at a time on one engine. */
  private run<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.queue.then(fn, fn);
    this.queue = p.catch(() => undefined);
    return p;
  }
  private conversationConfig(system: string, maxOutputTokens: number): ConversationConfig {
    const mod = this.mod!;
    return {
      preface: { messages: [{ role: 'system', content: system }], extra_context: { enable_thinking: false } },
      sessionConfig: { maxOutputTokens, samplerParams: { type: mod.SamplerType.TOP_K, k: 1, temperature: 0.1 } },
    };
  }
  /** Prefill the system prompt once per (prompt, budget); clones start from its KV cache instead of re-reading it. */
  private async baseConversation(system: string, maxOutputTokens: number): Promise<Conversation> {
    const key = `${maxOutputTokens}|${system}`;
    const hit = this.bases.get(key);
    if (hit) return hit;
    const base = await this.engine!.createConversation({ ...this.conversationConfig(system, maxOutputTokens), prefillPrefaceOnInit: true });
    this.bases.set(key, base);
    return base;
  }
  private async ask(system: string, user: string, maxOutputTokens: number): Promise<string> {
    return this.run(async () => {
      await this.ready();
      const t0 = performance.now();
      let conv: Conversation | undefined;
      if (this.cloneSupported !== false) {
        try {
          const base = await this.baseConversation(system, maxOutputTokens);
          conv = await base.clone();
          this.cloneSupported = true;
        } catch (e) {
          // The runtime cannot clone: fall back to one conversation per call (system prompt prefilled every time).
          this.cloneSupported = false;
          this.opts.onProgress?.(`prefix cache unavailable (${String(e).slice(0, 60)}); one conversation per call`);
        }
      }
      if (!conv) conv = await this.engine!.createConversation({ ...this.conversationConfig(system, maxOutputTokens), prefillPrefaceOnInit: false });
      try {
        const msg = await conv.sendMessage(user);
        const text = typeof msg.content === 'string' ? msg.content : (msg.content ?? []).map((c) => (c.type === 'text' ? c.text : '')).join('');
        this.calls += 1;
        this.lastMs = performance.now() - t0;
        this.totalMs += this.lastMs;
        this.lastTps = (text.length / 4) / Math.max(0.001, this.lastMs / 1000);
        this.touchIdle();
        return text;
      } finally {
        await conv.delete();
      }
    });
  }
  // Output budgets are tight on purpose: decode speed is the bottleneck on WebGPU, and the schemas are ≤4 fields.
  async extract(req: ExtractRequest): Promise<ExtractResponse> {
    const raw = await this.ask(SYSTEM_EXTRACT, buildExtractPrompt(req), 220);
    return parseExtract(raw, req);
  }
  async confirm(req: ConfirmRequest): Promise<ConfirmResponse> {
    const raw = await this.ask(SYSTEM_CONFIRM, buildConfirmPrompt(req), 120);
    return parseConfirm(raw, req);
  }
}
