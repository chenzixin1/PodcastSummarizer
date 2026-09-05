<!-- REVIEW:START -->
## Code review complete; production acceptance remains open

| Property | Value |
|---|---|
| Worker | Codex primary with independent security review |
| Issue | #18 |
| Scope | MAJOR |
| Security-Sensitive | YES |
| Reviewed | 2026-09-06 |

### Criteria results

| # | Criterion | Status | Findings |
|---|---|---|---|
| 1 | Blindspots | FIXED | Canonical inputs, source/scene coverage, transactions, leases, bounded paid attempts, malformed output |
| 2 | Clarity | FIXED | Overview versus full analysis, raw transcript versus derived analysis, language/status affordances |
| 3 | Maintainability | DEFERRED | Existing large dashboard boundaries tracked in #17 |
| 4 | Security | FIXED / DEFERRED | Runtime findings fixed; optional vector rebuild remains disabled under #19 |
| 5 | Performance | FIXED | Lazy QA/reader, three analysis leases, bounded translation batches, homepage asset gate |
| 6 | Documentation | FIXED | Plan, release evidence, source-fidelity and acceptance boundaries |
| 7 | Style | FIXED / DEFERRED | Existing design tokens retained; changed-file lint has no errors; existing warnings in #17 |

### Findings fixed

| # | Severity | Finding | Resolution |
|---|---|---|---|
| 1 | Major | Private artifacts and stale public caching | Current ownership/visibility checks, unknown-key denial, no-store |
| 2 | Major | Client-selected source object | Persisted canonical source, bounded reads and signed ASR input |
| 3 | Major | Overview treated as finished analysis | Explicit provenance/state and independent full-analysis queue |
| 4 | Major | Swapped/truncated Full Text | Complete per-scene language projection with size rejection, not truncation |
| 5 | Major | Missing transcript fell back to article JSON | Canonical transcript extraction and source-consistency checks |
| 6 | Major | Publication/repair races | Source-version/lease guard and atomic D1 commit with immutable backups |
| 7 | Major | Credit retry/cancel races | Atomic reservations/refunds, retry quota and publication guard |
| 8 | Major | Repeated paid analysis after interruptions | Durable attempt reservation, validated checkpoints, bounded corrections, uncertain-outcome stop |
| 9 | Major | QA history privacy and unbounded inference | Per-user history, authenticated no-store routes and 30/hour quota |
| 10 | Major | Model/QA failure paths | Explicit GLM transport, aligned deadlines, no billing fallback, safe final-answer extraction |
| 11 | Moderate | Runtime dependency advisories | Compatible upgrades/removal; npm production and resolved Python audits clean |
| 12 | Moderate | Frame ordering and production sample override | Exact scene references; development-only fixtures |
| 13 | Moderate | Reading and QA interaction defects | Four modes, focus/inert/reduced-motion behavior, lazy QA and history-send guard |
| 14 | Moderate | Mind-map teardown exception | Pure-data node renderer and safe cleanup; real repeated tab-switch check |
| 15 | Moderate | Translation format/alignment failures | Stable IDs, 12-turn/4000-character batches, strict completeness validation |

### Deferred findings with tracking

| # | Severity | Finding | Tracking | Justification |
|---|---|---|---|---|
| 1 | Moderate | LHCI development-only dependency debt | #16 | Forced downgrade would compromise performance gates; excluded from deployed runtime |
| 2 | Minor | Existing dashboard warnings/component size | #17 | Isolated follow-up rather than broad rewrite of unrelated behavior |
| 3 | Moderate | Atomic source-versioned vector index rebuild | #19 | Production vector path disabled; lexical/canonical QA verified |
| 4 | Moderate | PDF lacks scene images | #20 | Existing text export; web reader is illustrated. No claim of format parity |

### Evidence and boundary

- 84 Jest suites / 707 tests / 1 snapshot; TypeScript and changed-file ESLint passed. Six Python unit and five HTTP tests passed in Linux amd64. Production npm and full resolved Python dependency audits have zero reported vulnerabilities.
- Live URL conversion completed: 30 scenes, 38 artifacts, 1000 credits charged once. All four modes and mobile/desktop overflow tested. Real QA response persisted; subsequent readback fixes are included in the final incremental deployment.
- Three repeated mind-map tab-switch cycles had zero page errors. Public/owner-private read and anonymous denial checks were exercised.
- Independent security review found no blocker in source/lease/credit boundaries or paid-checkpoint recovery.
- **This is code-review completion, not full acceptance completion.** Historical language/full-analysis backfill, final corpus sweep, and positive MCP publish/submit acceptance remain tracked in #18. The current MCP token lacks the required scopes; no scope was expanded without user approval.
- Source hashes prove preservation of submitted transcripts, not audio-level ASR correctness or reliable speaker attribution. Historical uncertainties were not silently rewritten.

| Category | Count |
|---|---:|
| Fixed | 15 |
| Deferred with tracking | 4 |
| Unaddressed code-review findings | 0 |

**Review status: COMPLETE. Release acceptance: IN PROGRESS (#18).**
<!-- REVIEW:END -->
