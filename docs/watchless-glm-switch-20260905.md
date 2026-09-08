# Watchless GLM-5.3 Flash switch

## Scope and checks

- Only Watchless model traffic switches to Cloudflare `@cf/zai-org/glm-5.3-flash`; ordinary PodSum model selection is unchanged.
- Workers AI Read-only service credential is scoped to the current Cloudflare account and stored as a Worker secret. No credential is included in source or this report.
- Native Workers AI endpoint tested with HTTP 200, including strict JSON-schema translation with stable IDs.
- AI Gateway `default` now uses Unified billing, drawing from the existing prepaid credit balance. A request with `cf-aig-gateway-id: default` returned HTTP 200. No new top-up or automatic top-up was enabled.
- A deliberately tiny 32-token text request did not produce a usable final answer. HTTP success alone is not content validation: application code rejects truncated responses and requires valid JSON and complete IDs.
- 27 targeted Jest tests, 6 Python tests, TypeScript check and OpenNext production build passed. Existing lint warnings remain outside this scope.
- No historical article batch or full video conversion has run in this change.

## Seven-criterion review

1. Security: server-side credentials only, active provider credential only passed to the container; payload logging disabled for gateway requests.
2. Performance: bounded existing batches, timeouts and retry counts retained; explicit completion-token limits passed to the native model endpoint.
3. Architecture: shared TypeScript and Python transport adapters isolate provider-specific requests and response envelopes.
4. Correctness: final text only, truncation and failed envelopes rejected; original ASR text and translation ID validation remain unchanged.
5. Clarity: new jobs display GLM-5.3 Flash / Cloudflare; historical Luna labels remain historical. Existing function names retained to avoid unrelated refactors.
6. Testability: transport, envelope, missing credential, credit gate and translation completeness covered by targeted tests.
7. Standards: no D1 migration, billing bypass, cross-provider automatic fallback, or production secret committed. Worker and container must be deployed together.

## Release status

Build complete; production deployment and live readback pending. Local container runtime is being restored before deployment. Do not interpret the successful model probe as end-to-end video verification.
