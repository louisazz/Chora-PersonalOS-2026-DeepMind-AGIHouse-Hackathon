#!/usr/bin/env bash
# Run the app inside the phone's own Chrome over USB. The computer only serves static files over the cable;
# every model (EmbeddingGemma 2, Gemma 4 E2B via LiteRT-LM JS) runs on the phone's GPU through WebGPU.
# Prereqs: USB debugging on the phone, `brew install --cask android-platform-tools`, `pnpm dev` (5173) or `pnpm preview` (4173, PORT=4173) running.
set -euo pipefail
PORT="${PORT:-5173}"
adb devices
adb reverse "tcp:${PORT}" "tcp:${PORT}"
adb shell am start -a android.intent.action.VIEW -d "http://localhost:${PORT}/?mode=phone" com.android.chrome >/dev/null
echo "Opened http://localhost:${PORT}/ in the phone's Chrome. Now switch the phone to airplane mode (Wi-Fi off): the page keeps working over USB."
