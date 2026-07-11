# PodSum Automatic Infographic Design

**Date:** 2026-07-11
**Status:** Approved design, pending implementation plan

## Goal

Automatically generate one source-grounded infographic for every newly completed PodSum analysis, show it in a first-class `Infographic` dashboard tab, and preserve the original YouTube title and link in a deterministic Polaroid-style footer.

The feature must not delay summary availability. Image generation is asynchronous and independently recoverable.

## Validated Product Decisions

- Placement: add `Infographic` beside `Summary`, `Full Text`, and `Mind Map`.
- Trigger: automatically enqueue generation after a new analysis is saved successfully.
- Image model: OpenRouter dedicated Images API with `google/gemini-3-pro-image` (Nano Banana Pro).
- Prompt: use the validated “high-utility visual learner” prompt, called Prompt 1 in the prototype.
- Language: simplified Chinese with important English terms retained on first use.
- Source treatment: the model generates only the infographic body. PodSum adds the original video title and canonical YouTube link after generation.
- Frame: white padding on all four sides, with a larger bottom caption area like a Polaroid.
- Long titles: keep the complete title. Wrap text and automatically increase the bottom border height instead of continuously shrinking text.
- Storage: persist the final composite artifact in the existing `PODSUM_BUCKET` R2 bucket.
- Historical scope: automatically generate for newly completed analyses only. Do not bulk-generate all historical analyses without separate authorization.
- Prototype acceptance article: `What does the next training paradigm look like?`, source video `20p5-kQXF_Q`.

## User Experience

### Navigation

The dashboard view modes become:

```text
Summary | Full Text | Mind Map | Infographic
```

`Infographic` is a peer content artifact, not an inline block inside Summary and not an additional right sidebar.

### Tab States

The tab supports four stable states:

1. `Pending`: analysis is complete and an infographic job is queued.
2. `Generating`: a worker owns the job. Show a fixed-size skeleton and concise status.
3. `Ready`: show the complete framed infographic with zoom, fullscreen, and download controls.
4. `Failed`: show a compact error state. Owners/editors may retry; public viewers only see that the artifact is unavailable.

The page polls the infographic status only while the job is pending or processing. Polling stops after completion or failure and when the page is hidden.

### Ready Viewer

- Center the image on a neutral, unframed viewing surface.
- Fit the full image by default without cropping.
- Provide icon buttons with tooltips for zoom in, zoom out, reset, fullscreen, and download.
- Preserve stable viewer dimensions so loading and image completion do not shift the rest of the page.
- Mobile uses the full available width and keeps controls in a compact toolbar.
- Download exports a PNG of the exact framed composition.

## Generation Pipeline

```text
Analysis saved
  -> enqueue idempotent infographic job
  -> summary becomes available immediately
  -> cron worker claims one due job
  -> build grounded Prompt 1 from saved analysis and podcast metadata
  -> POST OpenRouter /api/v1/images
  -> validate returned base64 image and media type
  -> build deterministic framed SVG composite
  -> upload final SVG to R2 with read-after-write verification
  -> mark job completed with URL, cost, model, and prompt version
  -> dashboard polling resolves to Ready
```

Generation failure never changes the analysis result or marks the podcast unprocessed.

## OpenRouter Contract

Endpoint:

```http
POST https://openrouter.ai/api/v1/images
Authorization: Bearer ${OPENROUTER_API_KEY}
Content-Type: application/json
```

Request:

```json
{
  "model": "google/gemini-3-pro-image",
  "prompt": "<grounded Prompt 1>",
  "resolution": "2K",
  "aspect_ratio": "3:4",
  "n": 1
}
```

The implementation must use only parameters currently supported by the selected OpenRouter image endpoint. It must not send `quality`, `seed`, `background`, `output_format`, or `output_compression` for this model.

Expected response data:

```json
{
  "data": [{ "b64_json": "<base64>", "media_type": "image/png" }],
  "usage": { "cost": 0.13552 }
}
```

Requirements:

- Model is pinned through `OPENROUTER_INFOGRAPHIC_MODEL`, defaulting to `google/gemini-3-pro-image`.
- Do not silently fall back to another image model.
- Use an explicit request timeout suitable for multi-minute image generation.
- Validate HTTP status, JSON shape, base64 size, and supported raster media types.
- Redact API keys and base64 payloads from logs.
- Record actual `usage.cost` when provided.

## Grounded Prompt Contract

The prompt is versioned as `podsum-infographic-v1` and contains two layers:

1. Stable visual instructions derived from the validated online high-utility infographic pattern.
2. Per-article facts derived only from the stored PodSum title, Chinese summary, key data, and action items.

The prompt builder must cap input length and prefer these sections in order:

1. title and one-sentence thesis;
2. key numbers and dates;
3. primary causal/process relationship;
4. key mechanisms;
5. unresolved constraints.

It must explicitly instruct the model to:

- create a vertical `3:4` Chinese infographic for a visual learner;
- be information-dense without clutter;
- make every text, icon, arrow, and metaphor serve a learning function;
- use a hand-drawn editorial infographic style;
- use warm white, deep green, gold, and limited brick red;
- retain important English terms after Chinese terms;
- avoid decorative robots, glowing brains, cosmic backgrounds, neon gradients, fake charts, invented numbers, gibberish, and pseudo-text;
- use only supplied facts;
- keep labels concise and readable.

The original YouTube title and URL must not be requested inside the generated body. They are added deterministically after generation.

## Deterministic Polaroid Composition

### Why SVG

Production runs in a Cloudflare Worker. Native image libraries such as `sharp` are not part of the current runtime and should not be introduced solely for raster composition. The server therefore produces a self-contained SVG with:

- the returned PNG/JPEG embedded as a base64 image;
- a white border around all four sides;
- a larger white footer;
- source title and URL rendered as SVG text.

The SVG is the canonical stored artifact. The browser converts the same-origin SVG to PNG on download, preserving the complete composition.

### Layout Rules

All measurements are derived from the generated image width `W`:

- left/right padding: `max(24px, 0.025W)`;
- top padding: `max(24px, 0.025W)`;
- title font: normal sans-serif, initial size approximately `0.032W`;
- URL font: normal sans-serif, approximately `0.018W`;
- title/link gap: approximately `0.014W`;
- footer bottom padding: approximately `0.025W`.

Preferred font stack:

```css
Inter, "Noto Sans SC", "PingFang SC", "Microsoft YaHei", Arial, sans-serif
```

No handwritten or display font is used for the source caption.

### Title Wrapping

- Preserve the complete stored video title.
- Segment Chinese at character boundaries and Latin text at word boundaries.
- Estimate line width with script-aware character weights.
- Target at most three lines at the initial font size.
- Reduce title font size only down to a readable minimum when needed.
- If the complete title still exceeds three lines, allow additional lines and grow the footer; do not truncate.
- Never overlap the URL or generated image.

### Source URL

Normalize YouTube sources to:

```text
https://youtu.be/<video-id>
```

For non-YouTube sources, preserve a sanitized canonical source URL. The URL occupies its own line and may wrap at safe URL boundaries if necessary.

### Artifact Safety

- Escape title and URL before inserting them into SVG XML.
- Reject unsupported raster response types.
- Enforce a maximum decoded image size.
- Store under a versioned key such as:

```text
infographics/<podcast-id>/podsum-infographic-v1.svg
```

## Persistence

Add a D1 migration for `infographic_jobs`:

```sql
CREATE TABLE IF NOT EXISTS infographic_jobs (
  podcast_id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  artifact_url TEXT,
  artifact_media_type TEXT,
  source_title TEXT NOT NULL,
  source_url TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER,
  lease_expires_at INTEGER,
  cost_usd REAL,
  error_code TEXT,
  error_message TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER
);
```

Allowed statuses are `pending`, `processing`, `completed`, and `failed`. Repository code validates status values instead of relying on a database enum.

The row is idempotent by `podcast_id`. Enqueue behavior:

- create `pending` when no row exists;
- leave a matching completed `prompt_version` unchanged;
- do not restart a processing lease that has not expired;
- allow an owner retry to reset a failed row;
- a future prompt-version migration requires an explicit backfill operation.

## Worker Scheduling and Retry

The existing one-minute Cloudflare cron continues to call the internal processing worker route. That route processes the normal podcast job first and then may claim at most one due infographic job, keeping image cost and Worker duration bounded.

Claiming uses a lease so concurrent cron executions cannot generate the same infographic twice.

- maximum attempts: 3;
- retry delays: approximately 1 minute, 5 minutes, then 15 minutes;
- retry transient network, timeout, `429`, and `5xx` failures;
- fail immediately for malformed requests, unsupported response payloads, and content-policy rejection;
- expired processing leases become claimable again;
- persist a redacted error code and concise message.

## API Surface

Add:

```text
GET  /api/infographics/[id]
POST /api/infographics/[id]/retry
```

`GET` returns:

```json
{
  "status": "pending | processing | completed | failed | unavailable",
  "artifactUrl": "https://podsum.cc/api/files/...",
  "mediaType": "image/svg+xml",
  "model": "google/gemini-3-pro-image",
  "promptVersion": "podsum-infographic-v1",
  "updatedAt": 1783758000000,
  "canRetry": true
}
```

Authorization follows the existing podcast visibility contract:

- public analyses expose completed artifacts and non-sensitive status;
- private analyses require the owner;
- retry requires edit permission;
- never return cost, prompt body, raw model response, or internal error details publicly.

## Existing and New Analyses

- Newly completed analyses enqueue automatically after `saveAnalysisResults()` succeeds.
- The current acceptance article may be explicitly seeded during rollout using the already validated Google Prompt 1 prototype, after applying the final footer composition.
- No general historical backfill runs during migration or deploy.
- A future backfill script must default to dry-run, require an explicit maximum count, and report estimated cost before making API calls.

## Error Handling

- Missing `OPENROUTER_API_KEY`: mark the attempt failed with a configuration error; do not retry indefinitely.
- Empty or malformed image response: fail with a payload error.
- R2 write-read verification failure: retry as storage failure and do not mark completed.
- Footer composition failure: keep the job retryable and do not upload a partial artifact.
- Client PNG export failure: keep the SVG visible and offer direct SVG download as fallback.
- Deleting a podcast must delete its infographic job and best-effort delete the R2 artifact.

## Observability

Structured logs include:

- podcast ID;
- job status transition;
- attempt count;
- model and prompt version;
- request duration;
- decoded image bytes;
- final artifact bytes;
- cost when available;
- redacted failure category.

Logs must not include API keys, full base64 images, raw transcript bodies, or the complete model response.

## Testing

### Unit Tests

- prompt builder includes grounded article facts and excludes source-caption instructions;
- title wrapping handles Chinese, English, mixed text, punctuation, and a 100-character YouTube title;
- footer height grows when title line count increases;
- XML escaping protects title and URL;
- YouTube URL normalization removes timestamps and tracking parameters;
- SVG composition embeds both raster media types and returns valid dimensions;
- repository claim, lease expiry, retry, completion, and idempotency behavior;
- OpenRouter client validates status, timeout, response media type, and base64 limits.

### API Tests

- public/private visibility;
- owner-only retry;
- completed response returns the artifact URL;
- public response redacts cost and internal errors.

### Dashboard Tests

- fourth tab renders without shifting navigation;
- each of the four states renders correctly;
- polling stops on completion/failure and when hidden;
- viewer controls remain stable on desktop and mobile;
- PNG download uses the framed SVG and falls back safely.

### Production Verification

1. Apply the additive D1 migration.
2. Deploy the Worker with `OPENROUTER_INFOGRAPHIC_MODEL=google/gemini-3-pro-image`.
3. Process one controlled YouTube article.
4. Verify Summary becomes available before the infographic.
5. Verify one and only one infographic job is created.
6. Verify the final R2 artifact is readable through `/api/files/...`.
7. Verify the title is complete, long-title footer height grows, and the canonical YouTube link is present.
8. Verify zoom, fullscreen, SVG fallback download, and PNG download.
9. Verify `podsum.cc` and `www.podsum.cc` serve the same deployment and artifact.

## Rollout and Cost Guardrails

- Process at most one infographic job per cron invocation initially.
- No model fallback.
- No automatic regeneration of completed rows.
- No historical bulk generation.
- A retry ceiling prevents unbounded spend.
- Record actual cost for later budgeting without exposing it to end users.

## Out of Scope

- Multiple infographic styles per article.
- User-authored custom prompts.
- Editing generated infographic content.
- Generating both Chinese and English images.
- Automatic historical backfill.
- Social sharing links or a public infographic gallery.
- Replacing the existing Mind Map.

## Source References

- NotebookLM infographic controls and asynchronous behavior: <https://support.google.com/notebooklm/answer/16758265?hl=en-GB>
- Community high-utility infographic prompt pattern: <https://www.reddit.com/r/notebooklm/comments/1qkt49v/a_highutility_infographic_system_prompt_for/>
- OpenRouter dedicated Images API: <https://openrouter.ai/docs/guides/overview/multimodal/image-generation>
- Selected Google model: <https://openrouter.ai/google/gemini-3-pro-image>
