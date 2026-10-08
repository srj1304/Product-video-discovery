# Product Video Discovery Dashboard

A zero-budget, Node.js + React prototype for the AI Automation take-home assignment.

## Product contract

`input -> product intent -> query plan -> source collectors -> relevance + hard constraints -> thumbnail verification -> frame escalation -> dedup/history -> final ranking -> event stream -> React dashboard`

The supplied assignment requires Node.js + React, text/keyword and product-URL inputs, 20 Instagram Reels + 20 Meta Ad Library videos per search, exact-product visual matching, unique results across searches, live progress, background execution, retries/timeouts, caching, security, tests, README/demo/test evidence, and honest reporting of source shortfalls.

## Why SQLite for the MVP

The assignment allows PostgreSQL, MongoDB, Redis and SQLite. SQLite is used for the zero-budget/24-hour take-home because it requires no external service. Product identity stays relational/stable while category-specific attributes are stored as JSON-shaped intent evidence. For a production system we would evaluate MongoDB/document storage because fashion, FMCG and electronics have different evolving attribute sets.

## Security model

- Server-side sessions are stored in SQLite; only a hash of the browser token is persisted.
- Protected APIs require authentication; runtime configuration is ADMIN-only.
- Search/auth/admin routes are rate limited.
- Product URLs are restricted to HTTP/HTTPS and validated after every redirect; DNS resolution rejects localhost/private/internal addresses.
- External webpage/ad/caption text is treated as untrusted data and never as agent instructions.
- AI outputs are JSON-schema validated before entering the decision engine.
- Hard product constraints are enforced in backend code and cannot be overridden by an LLM.
- Uploaded/fetched images are subject to size/type validation before image-processing work.
- Secrets stay in environment variables and are excluded from the repository.

## Free AI strategy

The AI layer is provider-abstracted. Gemini is the primary multimodal implementation when a key is configured; the system falls back to deterministic fixture/uncertain behaviour rather than silently fabricating visual matches when no provider is available. The model performs evidence extraction; backend rules calculate final decisions.

## API keys and live-source credentials

The project uses two separate credential paths:

- `GEMINI_API_KEY` enables product-intent normalization and optional visual verification. It is read only by the backend and can be left empty for the deterministic no-key path.
- A Meta Ad Library API token would be used by a future authorized Graph API collector. The current Playwright browser collector does not consume a Meta token; it accesses public pages and can receive HTTP 403 from Meta.

See [API_KEYS_AND_LIVE_SOURCES.md](./API_KEYS_AND_LIVE_SOURCES.md) for setup, security, free/no-key operation, API limitations, request flow and troubleshooting. Never commit `.env` or place either credential in frontend code.

## Matching strategy

1. Product intent extraction with specificity preservation.
2. Hard-constraint gate.
3. Candidate relevance score from product identity, brand, explicit attributes, query/hashtag evidence, and caption/context.
4. Thumbnail visual verification.
5. Frame escalation only for ambiguous or low-confidence thumbnails when a direct video/media URL is available.
6. Final deterministic score + confidence + explanation.
7. Exact/uncertain/reject classification.

Unspecified product attributes remain unknown. URL/listing/image-derived information is preserved as evidence instead of silently becoming a user constraint. Contradictory user vs listing information pauses the search and asks for clarification.

## Source collection

`SOURCE_MODE=fixture` is the zero-cost deterministic demo mode. `SOURCE_MODE=browser` enables the optional Playwright adapters:

- Instagram: public web discovery of Reel URLs plus best-effort page metadata/thumbnail/media extraction.
- Meta: public Ad Library video-filtered search plus best-effort ad-page metadata/thumbnail/media extraction.

Browser mode can use an installed Chrome/Edge executable through `BROWSER_EXECUTABLE_PATH`. If Google, Meta, or the network blocks automation, the system reports a source shortfall and does not convert blocked pages into candidates.

The collectors are isolated behind interfaces so source changes do not affect ranking, deduplication, AI or UI logic. Each source is queried progressively until it reaches the configured target, exhausts the allowed query/candidate/runtime budget, or reports a shortfall.

## Caching and deduplication

- Product pages are reused by normalized URL where possible.
- Product-image analysis is cached by image key + model/prompt context.
- Visual thumbnail decisions are cached per product-reference/video/stage/model context.
- Video identity uses platform ID or canonical URL as a primary key.
- Perceptual hash is computed from decoded thumbnails to detect near-duplicates/reuploads in the MVP.
- Search history is user-scoped, so a repeat search does not hide a video merely because another user saw it.

## Local run

1. Copy `.env.example` to `.env` and set `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
2. Run `npm test`.
3. Run `npm start`.
4. For the React UI, install frontend dependencies and run `npm run dev` inside `frontend/`.

The complete request path is: input -> product intent -> canonical validation -> compact query plan -> source collectors -> hard-constraint gate -> relevance/visual scoring -> deduplication -> persisted results -> SSE progress events -> React dashboard. Gemini only supplies structured evidence; it does not directly search sources or override backend validation.

The backend uses Node 22's built-in `node:sqlite` for the MVP.

## Fixture validation

`tests/evaluation-fixtures.json` contains five products spanning footwear, electronics, FMCG and fashion. `scripts/run-fixture-evaluation.mjs` generates `tests/fixture-evaluation-report.json`. These are deterministic fixture-mode results and are explicitly not presented as live platform accuracy evidence.

## Submission notes

The original assignment asks for: source code with commit history, README, 3–5 minute demo, evidence on at least five products, optional deployment, and no real API keys or personal credentials in the submission. A live source smoke test and final five-product evaluation should be completed immediately before submission because public platform pages/selectors can change.

## Engineering note
The older prototype and the hardened pass were consolidated into this final working tree. The consolidated version includes persistent job execution with stale-job recovery, adaptive source loops with per-query retries, perceptual hashing, cached visual decisions, thumbnail-first/frame escalation, user-scoped history, conflict UX with durable re-queueing, bounded runtime configuration, visual-keyword query expansion, result platform/score/newest controls, and reproducible fixture validation. The live browser collectors remain best-effort adapters because platform pages/selectors can change or block automation; the source mode reports shortfalls instead of fabricating results.
