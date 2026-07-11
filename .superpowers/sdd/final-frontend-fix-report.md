# Final Frontend Review Fixes

## Scope

- `components/dashboard/InfographicPanel.tsx`
- `app/dashboard/[id]/page.tsx`
- `app/globals.css`
- Direct dashboard regression tests

## Fixes

- Route changes clear dashboard data and remount the infographic panel by podcast ID.
- The panel aborts and invalidates stale status requests before loading a new podcast.
- Generate/retry command failures are shown inline without replacing the actionable prior state.
- Fullscreen artwork is constrained to the actual available viewport instead of the normal 72vh cap.
- Summary language and vocabulary controls are hidden while the infographic tab is active.

## Verification

- `npx jest __tests__/dashboard/InfographicPanel.test.tsx __tests__/dashboard/DashboardPage.test.tsx --runInBand --testPathIgnorePatterns='/.worktrees/'`
- `npm run type-check`
- Focused ESLint on changed dashboard files and tests
