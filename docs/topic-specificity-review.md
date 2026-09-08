<!-- REVIEW:START -->
## Code Review Complete

| Property | Value |
|----------|-------|
| Worker | Codex root + independent security_review + homepage_card_actions |
| Issue | #18 |
| Scope | MAJOR |
| Security-Sensitive | YES |
| Reviewed | 2026-09-08 |

### Criteria Results

| # | Criterion | Status | Findings |
|---|-----------|--------|----------|
| 1 | Blindspots | FIXED | 2 |
| 2 | Clarity | FIXED | 1 |
| 3 | Maintainability | FIXED | 1 |
| 4 | Security | FIXED | 1 |
| 5 | Performance | PASS | 0 |
| 6 | Documentation | PASS | 0 |
| 7 | Style | PASS | 0 |

### Findings Fixed in This PR

| # | Severity | Finding | Resolution |
|---|----------|---------|------------|
| 1 | Major | Re-import could overwrite curated/live tags | Initialize empty tags only; historical repair requires fingerprint and backup |
| 2 | Major | Blocked browser storage crashed favorites/theme | Catch read/write failures; retain in-page behavior and explain persistence failure |
| 3 | Minor | View duplicates title; overflow inert; cover inert | Remove View/overflow; cover and title real links; visible 44px favorite control |
| 4 | Major | Watchless bypassed taxonomy and persisted four generic categories | Shared controlled extraction and transactional label/relation writes on URL/MCP/full analysis |
| 5 | Major | Sensitive backup could fall back to public Blob | Require private R2 before write; missing R2 fails before D1 changes |

### Findings Deferred (With Tracking Issues)

None within this change. Existing local-only favorites remain local-only; account synchronization is not implied.

### Summary

| Category | Count |
|----------|-------|
| Fixed in PR | 5 |
| Deferred (with tracking) | 0 |
| Unaddressed | 0 |

Verification: 91 suites / 786 tests pass; TypeScript and changed-file ESLint pass. SQLite tests exercise stale sources, rollback, import preservation, and protected endpoint behavior. Independent security review rechecked both findings and ran 14 targeted tests. No model calls, credits, or analysis scheduling in repair. Exact production results will be recorded after rollout.

Operational usage: `PROCESS_WORKER_SECRET` in environment; `node scripts/topics/repair-watchless-tags.mjs --ids=<explicit comma-separated ids>` previews only. Review its JSON before `--apply=<preview-file>`. Applies stop at the first failure. Old tags/relations are backed up under the private `watchless-runs/topic-repairs/` prefix; source and old tags are compared in each guarded statement within one D1 transaction. If the source changes, re-preview rather than force. Restore a backup only after a new review; never rerun video or full analysis to repair tags.

Extraction uses the existing controlled taxonomy: English aliases with ASCII token boundaries, title/lead/section evidence, frequency, facet caps, no empty quota padding, and umbrella categories ranked behind specifics. Historical Watchless rows use the stored complete summary, or original full text when the analysis is only an overview. Existing curated ordinary podcasts are not bulk replaced.

**Review Status:** COMPLETE
<!-- REVIEW:END -->
