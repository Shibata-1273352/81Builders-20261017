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
- A text model proposes candidate links between claims and image observations. Unknown IDs are dropped, and links never affect a verdict.
- Each model-written explanation is checked by a different model family (`AIAND_CHECK_MODEL`, default `qwen/qwen3.8-27b`) for grounding and Japanese fidelity. Anything not accepted, including a checker outage, falls back to fixed wording.
- Calls run concurrently (at most 8 at a time): every image observation and claim extraction start together, verification starts once claims exist, and each claim runs its own write → check pipeline alongside quote translation. Observations and claims stream to the UI as they finish; Activity shows a timeline of the model calls.
- SQLite in ignored `.runtime/` stores inputs, snapshots, ordered SSE events and idempotency records. Neo4j stores each revision with typed labels (Asset, Region, Observation, Claim, Scope, Source, Passage, Assessment, Explanation, ToolRun) and relationships (HAS_REGION, GROUNDS, LINKED_TO, HAS_SCOPE, EVALUATES, CITES, HAS_PASSAGE, BASED_ON, GENERATED_BY), written in two batched statements. Node keys start with `v2:`.
- `GET /api/analyses/{id}/graph` reads the graph back from Neo4j, falling back to the local snapshot. `GET …/sources/{sid}/impact` traverses Source → Passage ← CITES – Assessment → Claim and Explanation → Assessment. Disabling a source marks those claims as re-evaluating and re-verifies only them; the other claims keep their verified results.
- Sources are registered text, not fetched URLs. Model-selected passage IDs must resolve to saved text; fabricated IDs cannot support a claim. Place/time mismatches and conflicting evidence remain unresolved.
- A single in-process job runs at a time. Model calls time out after 20 seconds with up to one retry (the independent check: 8 seconds); jobs have a 75-second deadline. Failed graph writes remain pending for startup replay. An interrupted job becomes failed and can be retried.
- Revising evidence retains the previous verified display until graph persistence succeeds. Failed revisions never replace it with a successful-looking explanation.
- No image segmentation, public deployment or photo-provenance verification is implemented. VLM boxes are explicitly candidates, and photograph identity claims conservatively remain unresolved.

## Checks

```sh
npm test                  # deterministic constraints/API/graph tests, no paid calls
npm run build             # production build + TypeScript
.venv/bin/python scripts/check_models.py  # live vision/JSON probes and the independent checker; requires credits
.venv/bin/python scripts/smoke.py         # live 2 images → add → disable → graph/impact → SSE replay, with per-step timings
```

Live scripts send the public samples and synthetic caption to ai& and store versioned graph records in your configured Neo4j instance. Results and logs remain local; `smoke.py [label]` saves timings to `.runtime/smoke-timings-<label>.json`. The probe saves the successful vision model ID to `.env`.
