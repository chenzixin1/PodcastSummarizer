# Watchless format recovery

The seven format-paused runs were inspected against private rejected outputs. Some complete bilingual results exceeded the 12-point structural limit; others had missing translations or abruptly truncated text. New-workflow format failures had not retained raw responses.

Changes:
- Provider-only normalization joins adjacent complete bilingual pairs until at most 12 remain. All text and order are retained; existing per-field length and language checks still apply. Maximum input is 48 pairs. MCP validation stays strict.
- A format-paused run can resume only if its current part has an already-paid rejected result which now validates. No requests or failure counters are removed. All other pauses retain their existing rules.
- Invalid responses now return through the Workflow's durable step output and are persisted by the storage-only step before the failed-attempt state update. Retrying storage does not call the model. Private raw data is not exposed by the public status response.
- Original transcript, article, model, chunk identity, prompt version, and request budgets are unchanged.

Known limit: previously discarded new-workflow responses cannot be reconstructed. Truly incomplete results still require valid replacement content or separately authorized requests; this change does not claim to complete all seven articles.

Review: bounded normalization, immutable input, missing-field rejection, strict MCP validation, old-cache repair without a request, unchanged attempt history, and storage-only rejection retry are tested. Owner/publication checks and atomic budget triggers remain in force. No database migration or Container change.
