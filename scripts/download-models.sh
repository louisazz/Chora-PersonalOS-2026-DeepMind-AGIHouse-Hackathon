#!/bin/bash
# Downloads the on-device models used by the web runtime. All ungated (Apache-2.0). Resumable.
set -u
cd "$(dirname "$0")/../models"
log() { echo "[$(date +%H:%M:%S)] $*"; }
dl() { # url, out
  if [ -f "$2.done" ]; then log "skip $2 (done)"; return 0; fi
  log "downloading $2"
  curl -L --fail --retry 8 --retry-delay 3 -C - --progress-bar -o "$2" "$1" && touch "$2.done" && log "finished $2" || log "FAILED $2"
}
# 1) LiteRT-LM JS web build of Gemma 4 E2B (in-browser WebGPU)
dl "https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it-web.litertlm" "gemma-4-E2B-it-web.litertlm"
# 2) GGUF for llama-server (grammar-constrained JSON; Node eval)
dl "https://huggingface.co/ggml-org/gemma-4-E2B-it-GGUF/resolve/main/gemma-4-E2B-it-Q4_0.gguf" "gemma-4-E2B-it-Q4_0.gguf"
# 3) E4B web build for the escalation layer (optional, large)
dl "https://huggingface.co/litert-community/gemma-4-E4B-it-litert-lm/resolve/main/gemma-4-E4B-it-web.litertlm" "gemma-4-E4B-it-web.litertlm"
log "all done"
