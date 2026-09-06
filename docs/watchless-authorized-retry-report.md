# Exact four-part retry authorization — 2026-09-06

## Deployed and verified

- Primary code: `ae53f1a` (includes grant implementation `e5ca0d8`). Release worktree: `b83a8bc`.
- Production Worker: `d0faa1c7-0473-4e9d-9a45-ac5e930274f3`.
- Existing Container unchanged. OpenNext build passed; 26/26 cache objects uploaded and byte-readback verified.
- Full suite: 88 suites / 762 tests / 1 snapshot passed. Recovery-specific: 33 tests passed, including a nonempty ledger migration with foreign keys enabled. Type check passed.
- Review: issue #18 comment `5556888205`, with independent main-agent security review.

## Migration safety

Migration `0013_watchless_analysis_grants.sql` applied transactionally and registered. All 265 preexisting request rows retained exactly, SHA256 before/after:

`045c08364b80df001efbfa1ed77160d39ad1e6cb04b0ef7502af7bed86193b93`

Foreign-key checks returned no errors, no original index/trigger was lost, and no model-request lease was active during migration. The imported-history maximum of three attempts remains enforced. Exact grants, never public API inputs, permit a specifically authorized next request without resetting history or existing budget counters.

## Four authorized requests: 3 succeeded, 1 failed

One immutable grant per exact run/version, part, and next attempt was recorded atomically, expiring after 24 hours. All four have been consumed exactly once.

| Article | Authorized part | Attempt | Result | Article progress at 12:37 CST |
|---|---|---:|---|---|
| watchless-140ek7gjjoe | scene-01-part-1 | 4 | Succeeded and saved | 4/12, continuing |
| watchless-byv311hdohe | scene_018-part-1 | 3 | Succeeded and saved | 22/31, continuing |
| watchless-krboguz54vw | scene_011-part-1 | 3 | Succeeded and saved | 15/34, continuing |
| watchless-kwhgfwostoq | scene_001-part-1 | 4 | Failed; safely paused | 0/9, no fifth request |

The failed response is 721 characters. Its second point contains only an incomplete Chinese sentence and no English counterpart. Exact validator reason: `WATCHLESS_ANALYSIS_INVALID: section 1 requires nonempty zh/en text in every point`. This is genuinely incomplete content, not the former 12-point limit. Raw response and reason are preserved in the rejected R2 checkpoint. No additional model attempt was authorized or issued for it.

The three restored articles continue their ordinary remaining segments under the previously approved limits. They are **not yet complete**. At the snapshot, there were four grant requests plus fourteen ordinary subsequent requests (including in-flight ones); four grants must not be represented as the total cost of completing all remaining article segments.

## Integrity and billing

- All four original transcript SHA256 values unchanged.
- All 31 existing R2 objects (four articles and 27 successful-part results) byte hashes unchanged.
- Zero new requests on the 27 previously successful parts.
- User credit balances unchanged; ledger count remains 43, no second conversion charge.
- `watchless-mnydevfocze` remains paused at 33/34, no grant, no expanded budget.

Audit artifacts are local ignored files under `output/grant-*.json`, including before/after migration, source/credits, asset hashes, exact grants, request progress, and rejected response. They contain operational data and are not committed.
