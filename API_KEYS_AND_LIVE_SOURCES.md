# API Keys and Live Source Setup

This document explains the two different credentials that may be used by Product Video Discovery:

1. The Gemini API key for product understanding and visual verification.
2. The Meta Ad Library API token for an authorized Meta source adapter.

They are independent credentials. A Gemini key does not grant access to Meta, and a Meta token does not provide AI capabilities.

## 1. Gemini API key

The backend reads `GEMINI_API_KEY` in `backend/src/config.mjs`. When it is present, the following paths can call Gemini through `backend/src/ai/gemini.mjs`:

- Product intent normalization in `backend/src/agents/productAgent.mjs`.
- Product-image attribute extraction in `backend/src/agents/visualAttributes.mjs`.
- Thumbnail and optional video-frame verification in `backend/src/agents/visualAgent.mjs`.

The backend sends structured JSON requests and validates the returned object before storing the product intent or visual decision. The model is not allowed to make the final match decision: hard constraints, scoring, deduplication and result acceptance remain backend rules.

### Configure Gemini locally

Copy the example file and set the key only in the ignored local `.env` file:

```powershell
Copy-Item .env.example .env
```

Then set:

```env
GEMINI_API_KEY=your_gemini_key
GEMINI_MODEL=gemini-3.8-flash
```

Do not commit `.env`, paste the key into chat, or place the key in frontend code. The frontend must never receive this key.

### Run without Gemini

Leaving `GEMINI_API_KEY` empty runs the deterministic product-understanding path. Visual AI verification is unavailable without the key, but the application still performs query planning, hard-constraint checks, scoring, deduplication and honest shortfall reporting.

Whether Gemini usage is free depends on the Google account/project quota and current billing terms. The application itself does not require a paid subscription.

## 2. Meta Ad Library API token

The current `SOURCE_MODE=browser` Meta collector opens the public Meta Ad Library using Playwright. It does not currently read a Meta API token. Therefore adding a token to `.env` alone will not remove the current HTTP 403.

The supported long-term path is a separate API-backed Meta collector that calls the Graph API `ads_archive` endpoint. Meta authorization and availability are controlled by Meta. The Ad Library API is not unrestricted access to all commercial ads worldwide; availability depends on the ad category, region and authorization.

### Obtain access

1. Sign in to a Facebook account.
2. Open Meta's Ad Library API onboarding page.
3. Complete any required identity and location confirmation.
4. Create or use a Meta for Developers account.
5. Create an application and request Ad Library API access.
6. Generate an access token after Meta approves the access.

Meta documents the API at [Ad Library API](https://www.facebook.com/ads/library/api/). Its documented endpoint is:

```text
https://graph.facebook.com/{API_VERSION}/ads_archive
```

Typical request parameters include `search_terms`, `ad_active_status`, `ad_type`, `ad_reached_countries`, `media_type`, `publisher_platforms`, `fields`, `limit` and `access_token`.

### Intended local configuration

These names are reserved for the API adapter and should only be enabled once that adapter is implemented:

```env
META_AD_LIBRARY_ACCESS_TOKEN=your_meta_token
META_GRAPH_API_VERSION=vXX.X
META_AD_COUNTRY=IN
META_AD_TYPE=ALL
META_MEDIA_TYPE=VIDEO
```

Do not commit the token. Do not put it in the React frontend. Do not use a personal browser cookie as a substitute for a server-side credential in a shared or deployed environment.

## Current source behavior

| Setting | Behavior | Credential used |
|---|---|---|
| `SOURCE_MODE=fixture` | Deterministic demo data; reliable and free | None |
| `SOURCE_MODE=browser` | Best-effort public Instagram/Meta browser collection | Chrome/Playwright only; no Meta token currently used |
| Future Meta API adapter | Authorized Graph API collection | Meta Ad Library API token |

In browser mode, a Meta HTTP 403 is an external access block, not a query or backend crash. The app records a diagnostic and completes with `COMPLETED_WITH_SHORTFALL`; it does not fabricate candidates.

## End-to-end request flow

```text
User text or product URL
  -> productAgent normalizes brand/model/variant/constraints
  -> canonical validation preserves hard constraints
  -> queryAgent builds compact source queries
  -> source collector searches Instagram and Meta
  -> candidate metadata is normalized
  -> hard constraints and relevance scoring run
  -> thumbnail/frame verification runs when available
  -> exact and perceptual duplicates are removed
  -> results are stored and streamed to the React dashboard
```

The Gemini request only normalizes the product or evaluates visual evidence. It does not directly search Meta or Instagram and does not decide whether a source returned enough candidates.

## Security checklist

- Keep `.env` local and ignored.
- Use separate development and production credentials.
- Rotate any key that was accidentally exposed.
- Never log full access tokens.
- Never send server credentials to the browser.
- Use the smallest Meta permissions and API scope available.
- Treat source captions, pages and ad text as untrusted data.

## Troubleshooting

### `Gemini ... 401`, `403` or `429`

Check the key, project quota, model access and account billing/quota status. The app records the AI failure and uses its deterministic fallback where possible.

### `META_HTTP_ERROR` with HTTP 403

The public browser collector was blocked by Meta. A valid API adapter and approved Meta token are required; changing the product prompt will not fix this.

### `NO_META_AD_URLS`

The fallback search did not expose usable public Ad Library URLs. This is normally a consequence of the Meta block or search-engine filtering.

### No secrets in Git

Before committing, verify that only `.env.example` and documentation are staged. The real `.env` file must remain untracked and ignored.
