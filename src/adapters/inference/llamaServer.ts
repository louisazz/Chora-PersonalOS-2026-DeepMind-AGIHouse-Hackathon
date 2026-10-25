/**
 * Inference adapter for an OpenAI-compatible localhost server (llama-server) running Gemma 4 with
 * grammar-constrained JSON (`response_format: json_schema`). Local fallback and eval upper bound for the
 * structured-output path. Same prompts as the in-browser LiteRT-LM adapter.
 */
import type { ConfirmRequest, ConfirmResponse, ExtractRequest, ExtractResponse, InferenceAdapter, InferenceStats } from '@/contract/types';
import { CONFIRM_SCHEMA, EXTRACT_SCHEMA, buildConfirmPrompt, buildExtractPrompt, parseConfirm, parseExtract, SYSTEM_CONFIRM, SYSTEM_EXTRACT } from './prompts';

export class LlamaServerInference implements InferenceAdapter {
  readonly name: string;
  readonly kind = 'model' as const;
  private calls = 0;
  private totalMs = 0;
  private lastMs = 0;
  private lastTps?: number;
  private loadMs?: number;
  constructor(
    private url = 'http://127.0.0.1:9931',
    private model = 'gemma-4-e2b',
  ) {
    this.name = `llama-server:${model}`;
  }
  async ready(): Promise<void> {
    const t0 = performance.now();
    const r = await fetch(`${this.url}/health`);
    if (!r.ok) throw new Error(`llama-server not healthy at ${this.url}`);
    this.loadMs = performance.now() - t0;
  }
  stats(): InferenceStats {
    return { calls: this.calls, totalMs: this.totalMs, lastMs: this.lastMs, lastTokensPerSec: this.lastTps, loadMs: this.loadMs, backend: 'localhost-metal' };
  }
  private async chat(system: string, user: string, schema: object, maxTokens: number): Promise<string> {
    const t0 = performance.now();
    const r = await fetch(`${this.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        stream: false,
        temperature: 0.1,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        chat_template_kwargs: { enable_thinking: false },
        response_format: { type: 'json_schema', schema },
      }),
    });
    const j = (await r.json()) as { choices?: { message: { content: string } }[]; usage?: { completion_tokens?: number }; timings?: { predicted_per_second?: number } };
    this.calls += 1;
    this.lastMs = performance.now() - t0;
    this.totalMs += this.lastMs;
    if (j.timings?.predicted_per_second) this.lastTps = j.timings.predicted_per_second;
    return j.choices?.[0]?.message.content ?? '';
  }
  async extract(req: ExtractRequest): Promise<ExtractResponse> {
    const raw = await this.chat(SYSTEM_EXTRACT, buildExtractPrompt(req), EXTRACT_SCHEMA, 320);
    return parseExtract(raw, req);
  }
  async confirm(req: ConfirmRequest): Promise<ConfirmResponse> {
    const raw = await this.chat(SYSTEM_CONFIRM, buildConfirmPrompt(req), CONFIRM_SCHEMA, 200);
    return parseConfirm(raw, req);
  }
}
