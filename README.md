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
- `META_SOURCE_MODE=api` enables the authorized Graph API collector when `META_AD_LIBRARY_ACCESS_TOKEN` is configured. `META_SOURCE_MODE=browser` keeps the best-effort public-page collector, which can receive HTTP 403 from Meta.

See [API_KEYS_AND_LIVE_SOURCES.md](./API_KEYS_AND_LIVE_SOURCES.md) for setup, security, free/no-key operation, API limitations, request flow and troubleshooting. Never commit `.env` or place either credential in frontend code.

For an interviewer-ready walkthrough of the architecture, model call sites, query logic, scoring formulas, persistence model, worker lifecycle and configuration, see [ARCHITECTURE_AND_INTERVIEW_GUIDE.md](./ARCHITECTURE_AND_INTERVIEW_GUIDE.md).

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

### Prerequisites

- Node.js 22 or newer. The backend uses Node's built-in `node:sqlite` module.
- npm.
- Chrome or Edge is recommended for `SOURCE_MODE=browser`.
- No API key is required for the deterministic fixture demo.

### Install and start

From the repository root:

```powershell
Copy-Item .env.example .env
npm install
npm test
npm start
```

In a second terminal, start the React frontend:

```powershell
Set-Location frontend
npm install
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). The backend health endpoint is [http://127.0.0.1:8787/health](http://127.0.0.1:8787/health).

The default local administrator is controlled by `ADMIN_EMAIL` and `ADMIN_PASSWORD`. Change both values before using the application outside a local demo.

### Complete configuration example

`.env.example` is the safe template. Copy it to `.env` and change only the values needed for the selected mode:

```env
# Server
PORT=8787
HOST=127.0.0.1
NODE_ENV=development
APP_ORIGIN=http://127.0.0.1:5173
COOKIE_SECURE=false
SESSION_TTL_HOURS=12

# Authentication - change these locally
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=change-this-password

# Source mode: fixture or browser
SOURCE_MODE=fixture
MAX_CANDIDATES_PER_SOURCE=100
MAX_QUERIES_PER_SOURCE=8
MAX_SEARCH_RUNTIME_MS=120000

# Gemini is optional. Keep empty for the deterministic no-key path.
AI_PRIMARY_PROVIDER=gemini
AI_FALLBACK_PROVIDER=none
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.8-flash

# Browser-source settings
PLAYWRIGHT_HEADLESS=true
BROWSER_LOCALE=en-US
# BROWSER_EXECUTABLE_PATH=C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe

# Meta source selection when SOURCE_MODE=browser
# browser = public-page Playwright collector
# api = Graph API collector using META_AD_LIBRARY_ACCESS_TOKEN
META_SOURCE_MODE=browser
META_AD_LIBRARY_ACCESS_TOKEN=
META_GRAPH_API_VERSION=v24.0
META_AD_COUNTRY=IN
META_AD_TYPE=ALL
META_MEDIA_TYPE=VIDEO
```

### Configuration modes

#### Fixture mode: reliable, no keys

```env
SOURCE_MODE=fixture
```

Fixture mode returns deterministic candidates for evaluation and demos. It exercises the pipeline, scoring, visual-decision simulation, deduplication, history and UI without depending on external platforms.

#### Browser mode: live, best effort

```env
SOURCE_MODE=browser
META_SOURCE_MODE=browser
```

This starts Playwright collectors. Instagram uses public web discovery and Meta opens the public Ad Library. Public pages can return anti-bot challenges, HTTP 403, empty results or changed markup. Those conditions are surfaced as diagnostics and `COMPLETED_WITH_SHORTFALL`; blocked pages are never treated as candidates.

If Chrome is installed, set its executable path when the bundled browser is unavailable:

```env
BROWSER_EXECUTABLE_PATH=C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe
```

#### Meta Graph API mode: authorized API access

```env
SOURCE_MODE=browser
META_SOURCE_MODE=api
META_AD_LIBRARY_ACCESS_TOKEN=your_approved_meta_token
META_GRAPH_API_VERSION=v24.0
META_AD_COUNTRY=IN
META_AD_TYPE=ALL
META_MEDIA_TYPE=VIDEO
```

The API collector calls:

```text
https://graph.facebook.com/{META_GRAPH_API_VERSION}/ads_archive
```

It sends `search_terms`, `ad_active_status`, `ad_type`, `ad_reached_countries`, `media_type`, `publisher_platforms`, `fields`, `limit` and the server-side access token. The token is never sent to the React frontend.

Meta authorization is separate from Gemini authorization. Meta controls which regions, ad categories and time ranges a token can search. A valid token does not guarantee unrestricted commercial-ad access. If the API returns no creative image/video URL, the candidate may be discovered but remain uncertain during visual verification.

#### Gemini configuration

Set:

```env
GEMINI_API_KEY=your_gemini_key
GEMINI_MODEL=gemini-3.8-flash
```

Gemini is called by the backend for product-intent normalization, optional reference-image attributes, thumbnail verification and optional video-frame verification. The model returns structured evidence; backend hard constraints, scores and acceptance rules make the final decision.

Leaving `GEMINI_API_KEY` empty uses deterministic product normalization. The app still supports query planning, hard constraints, candidate scoring, deduplication and honest shortfall reporting, but AI visual verification is unavailable.

### Runtime configuration in the UI

An administrator can edit bounded runtime values from the dashboard. These values are stored as versioned SQLite configuration and affect future searches:

- Candidate and visual score thresholds.
- Candidate/visual score weights; weights must sum to 1.
- Maximum queries and candidates per source.
- AI verification and frame budgets.
- `runtime.source_mode` (`fixture` or `browser`).

Environment variables control credentials and source-adapter settings. Restart the backend after changing `.env`; save UI runtime configuration through the admin panel for pipeline tuning.

### Product URL behavior and safety

When Product URL mode is selected, `backend/src/urlResolver.mjs` fetches the page server-side. It:

- Allows only HTTP and HTTPS URLs.
- Revalidates every redirect.
- Rejects localhost, private-network and internal addresses to prevent SSRF.
- Enforces response size and content-type limits.
- Extracts Open Graph, description and JSON-LD product metadata.
- Stores fetch status, redirect count and content hash for reuse.

The page content is treated as untrusted product data. It cannot change agent instructions or backend rules.

### Troubleshooting startup

`GEMINI_API_KEY` errors: verify the key and account quota, or clear the key to use the deterministic path.

`META_API_NOT_CONFIGURED`: `META_SOURCE_MODE=api` was selected without `META_AD_LIBRARY_ACCESS_TOKEN`.

Meta HTTP 401/403: the token is invalid, unapproved, expired or does not have access to the requested Ad Library data. Browser mode can also be blocked by Meta even when the public page opens interactively.

`COMPLETED_WITH_SHORTFALL`: the pipeline completed, but one or both sources returned fewer than the target number of accepted high-confidence results. This is an honest source result, not a backend crash.

Port conflict: change `PORT` for the backend or the Vite port for the frontend, then update `APP_ORIGIN` if necessary.

Never commit `.env`, API keys, Meta tokens, browser profiles or SQLite runtime data containing personal information.

The complete request path is: input -> product intent -> canonical validation -> compact query plan -> source collectors -> hard-constraint gate -> relevance/visual scoring -> deduplication -> persisted results -> SSE progress events -> React dashboard. Gemini only supplies structured evidence; it does not directly search sources or override backend validation.

The backend uses Node 22's built-in `node:sqlite` for the MVP.

## Fixture validation

`tests/evaluation-fixtures.json` contains five products spanning footwear, electronics, FMCG and fashion. `scripts/run-fixture-evaluation.mjs` generates `tests/fixture-evaluation-report.json`. These are deterministic fixture-mode results and are explicitly not presented as live platform accuracy evidence.


## Engineering note
The older prototype and the hardened pass were consolidated into this final working tree. The consolidated version includes persistent job execution with stale-job recovery, adaptive source loops with per-query retries, perceptual hashing, cached visual decisions, thumbnail-first/frame escalation, user-scoped history, conflict UX with durable re-queueing, bounded runtime configuration, visual-keyword query expansion, result platform/score/newest controls, and reproducible fixture validation. The live browser collectors remain best-effort adapters because platform pages/selectors can change or block automation; the source mode reports shortfalls instead of fabricating results.
