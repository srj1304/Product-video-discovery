# Implementation Status

## Assignment constraints re-checked
The implementation is aligned to the supplied take-home requirements: Node.js backend, React frontend, text/keyword + product URL inputs, optional product image, 20 Instagram + 20 Meta target results, exact-product matching, unique results across searches, source-specific failure handling, background execution, live progress, caching, SSRF protection, tests, five-product evidence, README/demo artifacts, and honest shortfall reporting.

## Implemented / hardened
- Node.js backend with SQLite MVP schema; stable core fields + JSON-ready product metadata for future MongoDB migration.
- Server-side session authentication with hashed session token, HttpOnly cookie, role-aware admin access.
- Persistent SQLite-backed job worker with retry scheduling, stale-job recovery, and clarification searches re-enqueued through the durable worker.
- Event log + in-process event bus + SSE search progress.
- Text and URL search inputs.
- Product URL resolver with redirect re-validation, DNS/private-address checks, content-size/type limits, and URL fetch logging.
- Product intent normalization with specificity levels, explicit hard constraints, inferred evidence, provenance and versioning.
- Conflict detection and clarification/restart flow.
- Product-page caching and image-analysis caching.
- Adaptive source query execution that continues query-by-query until 20 accepted high-confidence results, source limits are reached, or the configured runtime/query budget is exhausted; retries are applied per source query.
- Pluggable Instagram and Meta browser collectors with public-page metadata extraction, thumbnail/page screenshot fallback, retry/backoff, and optional media URL discovery.
- Deterministic ₹0 fixture collectors for repeatable demos/tests.
- Candidate relevance scoring with directional term coverage, plus hard-constraint gate.
- Thumbnail-first visual verification with configurable escalation to sampled video frames when direct media URLs are available.
- Gemini multimodal provider with structured-output validation, retry/backoff, AI-run telemetry, and corrected supported thinking level.
- Perceptual hashing for decoded thumbnails and near-duplicate filtering, alongside exact platform-ID/URL dedupe.
- User-scoped seen-history filtering.
- Versioned runtime configuration with bounded admin validation.
- Search-result evaluation records with score, confidence, evidence, verification stage and frame count.
- React dashboard with login, text/URL search, live progress, product reference image, conflict notification, source tabs, match score, confidence, verification level, history, admin configuration, platform tabs, minimum-score filtering, and score/newest sorting.
- Fixture evaluation set covering five different product categories.
- Reproducible fixture repeat-search smoke path now returns 20+20 unseen results for the same user; Show previously seen bypasses that filter.

## Current live-source caveat
Live Instagram/Meta browser selectors and public pages can change or block automation. The collectors now surface per-source failures and shortfalls rather than fabricating results, but live source access still needs an environment-specific smoke test before submission.

## Explicit future scope
- Embedding generation + KNN/vector retrieval for scalable candidate recall.
- Stronger scene/key-frame selection and direct platform media extraction where permitted.
- Optional third source such as TikTok behind a feature toggle.
- PostgreSQL/MongoDB deployment for multi-instance production workloads.
- Dockerized deployment and production hosting.

## Verification snapshot
- Backend syntax check: passed for all `.mjs` source files.
- Node test suite: 7/7 passed.
- Fresh fixture-mode E2E smoke test: 20 Instagram + 20 Meta results for a text search.
- Repeat-search smoke test: second search returned a new 40-result set for the same user.
- Perceptual-hash duplicate test: passed.
- Frontend dependency install/build was not verified in this environment because Node/npm are unavailable on the current PATH; versions are pinned in frontend/package.json for reproducibility and the standard Vite/React project should be installed/built in the submission environment.
- Live Playwright collectors were not smoke-tested here because browser tooling is intentionally an optional install for SOURCE_MODE=browser; fixture mode remains the deterministic zero-cost demo path.
