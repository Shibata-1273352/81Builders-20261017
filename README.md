# TSUMUGI — Weaving context, beyond translation

An English cultural field guide that separates what a photograph shows from what a caption claims. Add or disable evidence to see explanations change, with exact excerpts and revision history.

## Start locally

Requires Node.js 22+, Python 3.9+, an ai& API key with credits, and a reachable Neo4j database.

```sh
npm install
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt
cp .env.example .env  # only for a new installation; preserve an existing .env
```

Set the ai& and Neo4j variables in `.env`. The backend automatically loads this file. Never put credentials in `NEXT_PUBLIC_*` variables. Start these in two terminals:

```sh
npm run backend
npm run dev
```

Open http://127.0.0.1:3000. Both servers bind to loopback. Use one backend process; there is no multi-worker job queue or public authentication.

## 90-second walkthrough

1. Select **Try an example**, then **Explore the context**.
2. Inspect a visual observation and its image region. The caption's claims initially remain unresolved.
3. Select **Add evidence → Use the Kyoto tourism excerpt → Add & re-evaluate**.
4. Inspect **What changed**: the recurring July festival claim can gain support; the photograph's location and 2026 date remain unresolved.
5. Open its evidence and inspect the exact quote. **Disable** the source to withdraw its support.

The caption is synthetic. The photograph is real and licensed CC BY 2.0 by Ippei Suzuki. Credits and source links appear in the UI; its attribution metadata is not submitted as evidence. The source fixture contains short excerpts from Kyoto City's tourism FAQ, including its heading to disambiguate the festival.

## Architecture and behavior

- Next.js/TypeScript with locally served fonts, English interface, responsive original/meaning views and evidence panel.
- FastAPI proxies ai& calls; pixels and text are sent only during analysis. Uploaded images are retained locally; a metadata-stripped, resized copy is sent to the model.
- SQLite in ignored `.runtime/` stores inputs, snapshots, ordered SSE events and idempotency records. Neo4j stores versioned assets, regions, observations, claims, scopes, passages, assessments and explanations.
- Sources are registered text, not fetched URLs. Model-selected passage IDs must resolve to saved text; fabricated IDs cannot support a claim. Place/time mismatches and conflicting evidence remain unresolved.
- A single in-process job runs at a time. Model calls time out after 20 seconds with up to one retry; jobs have a 75-second deadline. Failed graph writes remain pending for startup replay. An interrupted job becomes failed and can be retried.
- Revising evidence retains the previous verified display until graph persistence succeeds. Failed revisions never replace it with a successful-looking explanation.
- No output cache, image segmentation, graph detail viewer, public deployment or photo-provenance verification is implemented. VLM boxes are explicitly candidates, and photograph identity claims conservatively remain unresolved.

## Checks

```sh
npm test                  # deterministic constraints/API tests, no paid calls
npm run build             # production build + TypeScript
.venv/bin/python scripts/check_models.py  # small live vision/JSON probes; requires credits
.venv/bin/python scripts/smoke.py         # live analysis → add → disable → SSE replay
```

Live scripts send the public sample and synthetic caption to ai& and store versioned graph records in your configured Neo4j instance. Results and logs remain local. The probe saves the successful vision model ID to `.env`.

The deterministic tests cover evidence absence, scope mismatch, contradiction, conflict, source invalidation, prompt directives without evidence, fabricated citations, Unicode spans, input limits, revision/idempotency, SSE replay, and failed jobs. They do not establish model accuracy for arbitrary cultural claims.
