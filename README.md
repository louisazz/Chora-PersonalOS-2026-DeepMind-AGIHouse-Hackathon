[Explore the prototype](https://chora-quiet-os.louisazhang22.chatgpt.site)

# Personal Agentic OS

Chora explores how a personal OS can build an editable user model—understanding people's ongoing activities, relationships, preferences and ways of working—and organize information and capabilities around their lives.
It also explores UI/UX-level recursive self-improvement (RSI): using context and interaction feedback to evaluate and refine interfaces over time, while preserving familiar navigation and user control.

An on-device personal OS home screen, built at the Google DeepMind × AGI House Gemma Hackathon.
The phone's home screen is a projection of a life graph: people, activities, matters, preferences and their typed relations.
On-device Gemma models connect incoming messages, calendar entries and listening records to the relevant matters.
Corrections are designed to generalize only to relevant contexts, and users can inspect and edit what the system learns about them.

## What it does

- Keeps one matter across days: new information about the same show lands on the same object.
- Shows the same object in several views; a correction made in one view changes all of them.
- Scoped corrections: a fix applies to this message, to this sender's thread, or as a rule, and is stored as a graph edge.
- Never guesses between two plausible matters: it asks, with the candidates.
- Suggestions under budgets: typed silences, a structure-change budget, interrupt gating.
- Editable user model: delete a learned fact and every suggestion built on it disappears.
- Runs fully offline in Chrome on a Pixel 10 Pro (airplane mode, WebGPU).

## Stack

- TypeScript, React 19, Vite 7. Core (graph, attribution, correction, policy, surface planning) is pure TypeScript with no DOM.
- Home screen UI in vanilla JS (`src/os`), mounted in a shadow root and fed by live snapshots from the core.
- EmbeddingGemma 2 (ONNX, Transformers.js, WebGPU) for attribution retrieval.
- Gemma 4 E2B via LiteRT-LM (WebGPU) for extraction and confirmation; Gemma 4 E4B loaded on demand for escalation.
- Synthetic persona generator and offline eval (`scripts/`), Playwright walkthroughs in real Chrome.

## Run

```sh
pnpm install                     # also copies the wasm runtimes into public/
pnpm models                      # downloads the Gemma model files into models/ (ungated)
pnpm dev                         # http://127.0.0.1:5173/
pnpm build && pnpm preview       # production build on :4173
PORT=4173 sh scripts/phone.sh    # same page in a USB-attached Pixel's Chrome, then airplane mode
```

## Verify

```sh
pnpm test
pnpm eval --infer rules --embed gemma
pnpm policy-eval --embed gemma
CHANNEL=chrome URL='http://127.0.0.1:5173/?ui=classic' pnpm demo
URL=http://127.0.0.1:4173/ pnpm exec tsx scripts/os-smoke.ts
```
