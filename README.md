# TSUMUGI — Weaving context, beyond translation

A cultural field guide that separates what photographs show from what a caption claims. Upload up to four images, add or disable evidence to see explanations change, and follow every result through an evidence graph stored in Neo4j. Every item is shown in English and Japanese (switch between EN, 日本語 and Both).

## Start locally

Requires Node.js 22+, Python 3.9+, an ai& API key with credits, and a reachable Neo4j database.

```sh
npm install
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt
cp .env.example .env  # only for a new installation; preserve an existing .env
```

Set the ai& and Neo4j variables in `.env`. The backend automatically loads this file. Never put credentials in `NEXT_PUBLIC_*` variables. Start and stop both servers with one command:

```sh
npm run up       # backend + production frontend (no development overlay); waits until both respond
npm run up:dev   # backend + next dev with hot reload
npm run status   # show what is running
npm run logs     # follow .runtime/logs/backend.log and frontend.log
npm run down     # stop both, including this project's servers started by hand
```

### Optional: local SAM3 segmentation

SAM3 (`facebook/sam3`, gated on Hugging Face) turns the VLM's candidate boxes into pixel masks. It runs as a separate local process because it needs Python 3.10+ with PyTorch, while the backend's `.venv` stays as it is:

```sh
uv venv ~/models/sam3/.venv --python 3.12
uv pip install --python ~/models/sam3/.venv/bin/python torch torchvision transformers huggingface_hub pillow
~/models/sam3/.venv/bin/hf download facebook/sam3 --exclude sam3.pt --local-dir ~/models/sam3/facebook-sam3
```

Then set `SAM3_PYTHON=~/models/sam3/.venv/bin/python` and `SAM3_MODEL_DIR=~/models/sam3/facebook-sam3` (absolute paths) in `.env`. `npm run up` starts the sidecar on port 8010 (`SAM3_PORT`), waits for the model to load, and passes `SAM3_URL` to the backend; `npm run status` and `npm run down` include it. Without these variables, or if the sidecar fails to start, the app keeps the VLM boxes as before.

Open http://127.0.0.1:3000. `BACKEND_PORT` and `FRONTEND_PORT` override the default ports 8000 and 3000. `npm run down` only stops processes running from this directory; another app on the same port is left alone. To run the servers separately instead, use `npm run backend` with `npm run dev` (or `npm run demo`) in two terminals; set `TSUMUGI_BACKEND_URL` if the backend is not on port 8000. Both servers bind to loopback. Use one backend process; there is no multi-worker job queue or public authentication.

## 90-second walkthrough

1. Select **Try an example** (two photographs and a caption), then **Explore the context**. Observations and claims appear as each model call finishes.
2. Switch between **Image 1** and **Image 2**. Select a claim: its candidate image regions are highlighted on every image, with a count on each thumbnail.
3. Select **Add evidence → Use the Kyoto tourism excerpt → Add & re-evaluate**.
4. Inspect **What changed**: the July festival claim gains support; both photographs' place and 2026 date remain unresolved. Explanations show **Independent check · qwen**.
5. Open **Graph**, select nodes to see their neighbours, then hover **Disable** on the source to highlight what it affects. Disable it to withdraw its support.

The caption is synthetic. Image 1 is licensed CC BY 2.0 by Ippei Suzuki; image 2 is a public-domain 1905 album photograph by E. G. Stillman (Harvard, via Wikimedia Commons). Credits and source links appear in the UI; their attribution metadata (including the 1905 date) is not submitted as evidence, and the handwritten "GION FESTIVAL IN KIOTO" on the mount is treated as visible content only. The source fixture contains short excerpts from Kyoto City's tourism FAQ.

A Japanese presenter script with timings, talking points and fallbacks is in [docs/DEMO.md](docs/DEMO.md).

## Architecture and behavior

- Next.js/TypeScript with locally served fonts, responsive original/meaning/graph views and evidence panel. Japanese text uses system Japanese fonts via `:lang(ja)`.
- FastAPI proxies ai& calls; pixels and text are sent only during analysis. Uploaded images are retained locally; metadata-stripped, resized copies are sent to the model.
- Models return English and Japanese together. Wording decided by code (reason codes, fallbacks) is a fixed EN/JA template. Quotes stay in the original language; `quote_ja` is a labelled reference translation. If Japanese is missing, English is shown and a limitation is recorded.
- With SAM3 enabled, each image is encoded by the local sidecar as soon as the job starts. When the VLM's observations arrive, its short label for each observation (e.g. "paper lanterns") is used as a SAM3 text prompt, and only instances lying mostly inside that observation's candidate box are kept and merged into one mask. Masks are shaded under the boxes and stored as Region properties in Neo4j (`segmenter`, `mask_score`, `instance_count`, `mask_area`). The job waits for masks for at most 25 seconds and never past 60 seconds into its 75-second deadline; a missing or failed sidecar leaves the boxes with an image limitation. Revisions reuse the masks without re-segmenting.
- A text model proposes candidate links between claims and image observations. Unknown IDs are dropped, and links never affect a verdict.
- Each model-written explanation is checked by a different model family (`AIAND_CHECK_MODEL`, default `qwen/qwen3.8-27b`) for grounding and Japanese fidelity. Anything not accepted, including a checker outage, falls back to fixed wording.
- Calls run concurrently (at most 8 at a time): every image observation and claim extraction start together, verification starts once claims exist, and each claim runs its own write → check pipeline alongside quote translation. Observations and claims stream to the UI as they finish; Activity shows a timeline of the model calls.
- SQLite in ignored `.runtime/` stores inputs, snapshots, ordered SSE events and idempotency records. Neo4j stores each revision with typed labels (Asset, Region, Observation, Claim, Scope, Source, Passage, Assessment, Explanation, ToolRun) and relationships (HAS_REGION, GROUNDS, LINKED_TO, HAS_SCOPE, EVALUATES, CITES, HAS_PASSAGE, BASED_ON, GENERATED_BY), written in two batched statements. Node keys start with `v2:`.
- `GET /api/analyses/{id}/graph` reads the graph back from Neo4j, falling back to the local snapshot. `GET …/sources/{sid}/impact` traverses Source → Passage ← CITES – Assessment → Claim and Explanation → Assessment. Disabling a source marks those claims as re-evaluating and re-verifies only them; the other claims keep their verified results.
- Sources are registered text, not fetched URLs. Model-selected passage IDs must resolve to saved text; fabricated IDs cannot support a claim. Place/time mismatches and conflicting evidence remain unresolved.
- A single in-process job runs at a time. Model calls time out after 20 seconds with up to one retry (the independent check: 8 seconds); jobs have a 75-second deadline. Failed graph writes remain pending for startup replay. An interrupted job becomes failed and can be retried.
- Revising evidence retains the previous verified display until graph persistence succeeds. Failed revisions never replace it with a successful-looking explanation.
- No public deployment or photo-provenance verification is implemented. VLM boxes and SAM3 masks are explicitly candidates: SAM3 only refines observations that already have a box, and photograph identity claims conservatively remain unresolved.

## Checks

```sh
npm test                  # deterministic constraints/API/graph tests, no paid calls
npm run build             # production build + TypeScript
.venv/bin/python scripts/check_models.py  # live vision/JSON probes and the independent checker; requires credits
.venv/bin/python scripts/smoke.py         # live 2 images → add → disable → graph/impact → SSE replay, with per-step timings
```

Live scripts send the public samples and synthetic caption to ai& and store versioned graph records in your configured Neo4j instance. Results and logs remain local; `smoke.py [label]` saves timings to `.runtime/smoke-timings-<label>.json`. The probe saves the successful vision model ID to `.env`.
