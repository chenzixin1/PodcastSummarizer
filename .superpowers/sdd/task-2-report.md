Task 2 Report: Refresh Snapshots After Mutations

Status
- DONE

Scope completed
- Added `lib/staticSnapshotHooks.ts` with best-effort mutation hooks for:
  - `refreshSnapshotsForPodcastMutation(podcastId, label?)`
  - `refreshPublicListSnapshotsAfterDelete(label?)`
- Preserved Task 1 best-effort semantics by warning when a snapshot refresh returns either:
  - `success === false`, or
  - `success === true` with a populated `error`
- Wired snapshot refreshes into the owned mutation paths:
  - user podcast PATCH -> `user podcast metadata update`
  - admin podcast PATCH -> `admin podcast metadata update`
  - admin podcast DELETE -> `admin podcast delete`
  - process completion -> `process analysis completion`, only after `saveAnalysisResults(...)` succeeds and inside the same `try` block

Tests added or updated
- Added `__tests__/lib/staticSnapshotHooks.test.ts`
  - verifies successful mutation refresh
  - verifies degraded results like `{ success: true, published: true, error: 'public list snapshot refresh failed: list down' }` are logged and do not throw
  - verifies failed and rejected refreshes are logged and do not throw
  - verifies public list rebuild after delete
- Updated `__tests__/api/podcast-patch.test.ts`
  - verifies user PATCH triggers `refreshSnapshotsForPodcastMutation('pod-1', 'user podcast metadata update')`
- Added `__tests__/api/admin-podcasts.test.ts`
  - verifies admin PATCH triggers `refreshSnapshotsForPodcastMutation('pod-1', 'admin podcast metadata update')`
  - verifies admin DELETE triggers `refreshPublicListSnapshotsAfterDelete('admin podcast delete')`

Additional note from verification
- `npm test -- __tests__/api/process.test.ts --runInBand` initially failed before assertions because `app/api/process/route.ts` imported `lib/qaContextChunks` at module load, which pulled in an ESM-only Cloudflare dependency through `lib/sql.ts`
- Fixed this within owned Task 2 scope by deferring the QA chunk builder to a local dynamic import inside `app/api/process/route.ts`
- This kept the process route tests passing without modifying `__tests__/api/process.test.ts`

Commands run
- `npm test -- __tests__/lib/staticSnapshotHooks.test.ts __tests__/api/podcast-patch.test.ts __tests__/api/admin-podcasts.test.ts --runInBand`
- `npm test -- __tests__/api/process.test.ts --runInBand`

Results
- Focused mutation tests: PASS
- Process route regression tests: PASS

Files changed
- `lib/staticSnapshotHooks.ts`
- `__tests__/lib/staticSnapshotHooks.test.ts`
- `__tests__/api/admin-podcasts.test.ts`
- `__tests__/api/podcast-patch.test.ts`
- `app/api/podcasts/[id]/route.ts`
- `app/api/admin/podcasts/[id]/route.ts`
- `app/api/process/route.ts`

Concerns
- None
