/**
 * Inference adapter for the Android shell: the same prompts/parsers, executed by the native LiteRT-LM engine
 * through a JavaScript bridge. The bridge contract (both directions) is deliberately tiny:
 * window.PersonOSBridge.generate(requestId: string, system: string, user: string, schemaJson: string, maxTokens: number): void
 */
import type { ConfirmRequest, ConfirmResponse, EmbeddingAdapter, ExtractRequest, ExtractResponse, InferenceAdapter, InferenceStats } from '@/contract/types';
import { CONFIRM_SCHEMA, EXTRACT_SCHEMA, buildConfirmPrompt, buildExtractPrompt, parseConfirm, parseExtract, SYSTEM_CONFIRM, SYSTEM_EXTRACT } from './prompts';

interface NativeBridge {
  generate(requestId: string, system: string, user: string, schemaJson: string, maxTokens: number): void;
  embed?(requestId: string, textsJson: string, mode: string): void;
  execute?(actionJson: string): string;
  stats?(): string;
}

type Pending = { resolve: (text: string) => void; reject: (e: Error) => void; t0: number };
const pending = new Map<string, Pending>();
let seq = 0;

function bridge(): NativeBridge | undefined {
  return (globalThis as { PersonOSBridge?: NativeBridge }).PersonOSBridge;
}

/** Installed once; the native side calls it on the UI thread via evaluateJavascript. */
export function installBridgeCallbacks(): void {
  const g = globalThis as { __personos?: { onResult(id: string, text: string, err: string, ms: number): void } };
  if (g.__personos) return;
  g.__personos = {
    onResult(id, text, err, _ms) {
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      if (err) p.reject(new Error(err));
      else p.resolve(text);
    },
  };
}

export function hasNativeBridge(): boolean {
  return !!bridge();
}

function call(fn: (id: string) => void): Promise<string> {
  installBridgeCallbacks();
  seq += 1;
  const id = `r${seq}`;
  return new Promise<string>((resolve, reject) => {
    pending.set(id, { resolve, reject, t0: performance.now() });
    try {
      fn(id);
    } catch (e) {
      pending.delete(id);
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

export class BridgeInference implements InferenceAdapter {
  readonly name = 'android-bridge:litert-lm';
  readonly kind = 'model' as const;
  private calls = 0;
  private totalMs = 0;
  private lastMs = 0;
  async ready(): Promise<void> {
    if (!bridge()) throw new Error('PersonOSBridge not present (not running inside the Android shell)');
  }
  stats(): InferenceStats {
    const b = bridge();
    if (b?.stats) {
      try {
        return JSON.parse(b.stats()) as InferenceStats;
      } catch {
        /* fall through */
      }
    }
    return { calls: this.calls, totalMs: this.totalMs, lastMs: this.lastMs, backend: 'android-native' };
  }
  private async ask(system: string, user: string, schema: object, maxTokens: number): Promise<string> {
    const t0 = performance.now();
    const text = await call((id) => bridge()!.generate(id, system, user, JSON.stringify(schema), maxTokens));
    this.calls += 1;
    this.lastMs = performance.now() - t0;
    this.totalMs += this.lastMs;
    return text;
  }
  async extract(req: ExtractRequest): Promise<ExtractResponse> {
    return parseExtract(await this.ask(SYSTEM_EXTRACT, buildExtractPrompt(req), EXTRACT_SCHEMA, 320), req);
  }
  async confirm(req: ConfirmRequest): Promise<ConfirmResponse> {
    return parseConfirm(await this.ask(SYSTEM_CONFIRM, buildConfirmPrompt(req), CONFIRM_SCHEMA, 200), req);
  }
}

export class BridgeEmbedding implements EmbeddingAdapter {
  readonly name = 'android-bridge:embeddinggemma-2';
  readonly dim = 256;
  private calls = 0;
  private totalMs = 0;
  private lastMs = 0;
  async ready(): Promise<void> {
    if (!bridge()?.embed) throw new Error('PersonOSBridge.embed not present');
  }
  stats(): InferenceStats {
    return { calls: this.calls, totalMs: this.totalMs, lastMs: this.lastMs, backend: 'android-native' };
  }
  async embed(texts: string[], mode: 'query' | 'document'): Promise<Float32Array[]> {
    const t0 = performance.now();
    const raw = await call((id) => bridge()!.embed!(id, JSON.stringify(texts), mode));
    const rows = JSON.parse(raw) as number[][];
    this.calls += 1;
    this.lastMs = performance.now() - t0;
    this.totalMs += this.lastMs;
    return rows.map((r) => {
      const v = new Float32Array(r.slice(0, this.dim));
      let n = 0;
      for (let i = 0; i < v.length; i++) n += (v[i] ?? 0) ** 2;
      n = Math.sqrt(n) || 1;
      for (let i = 0; i < v.length; i++) v[i] = (v[i] ?? 0) / n;
      return v;
    });
  }
}
