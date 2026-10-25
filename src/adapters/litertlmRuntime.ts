/** One LiteRT-LM wasm runtime per page, shared by the LLM and embedding adapters (loading it twice is wasteful at best). */
let runtime: Promise<typeof import('@litert-lm/core')> | undefined;

export function litertlmRuntime(wasmPath = './litert-lm-wasm/'): Promise<typeof import('@litert-lm/core')> {
  if (!runtime) {
    runtime = (async () => {
      const mod = await import('@litert-lm/core');
      await mod.loadLiteRtLm(wasmPath);
      return mod;
    })();
    runtime.catch(() => (runtime = undefined));
  }
  return runtime;
}
