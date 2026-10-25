#!/bin/sh
# Copy the WebAssembly runtimes the app serves from ./public: onnxruntime-web (EmbeddingGemma 2) and LiteRT-LM (Gemma 4).
set -e
cd "$(dirname "$0")/.."
ORT=$(ls -d node_modules/.pnpm/onnxruntime-web@*/node_modules/onnxruntime-web/dist 2>/dev/null | head -1)
LRT=node_modules/@litert-lm/core/wasm
mkdir -p public/ort public/litert-lm-wasm
[ -n "$ORT" ] && cp "$ORT"/ort-wasm-simd-threaded*.wasm "$ORT"/ort-wasm-simd-threaded*.mjs public/ort/
[ -d "$LRT" ] && cp "$LRT"/*.wasm "$LRT"/*.js public/litert-lm-wasm/
echo "wasm runtimes copied into public/"
