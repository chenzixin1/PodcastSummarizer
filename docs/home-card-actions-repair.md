# Homepage card actions repair

Scope: remove redundant View and inert overflow controls; preserve title navigation and make local favorites discoverable, keyboard-operable and resilient. Existing warm-paper design and local-only favorites remain unchanged. No analysis, credit, model or tag changes.

- [x] Inspect favorite rendering and persistence; remove redundant controls.
- [x] Add accessible, visible favorite feedback and storage-failure handling.
- [x] Run focused interaction tests, including reload and keyboard use.
- [ ] Iterative preview: hand off desktop/mobile verification to the integrating agent.
- [ ] Release registration: integrating agent owns deployment; this subtask does not deploy.

## Findings and implementation

- Overflow had no click handler/menu. View duplicated the title link. Both removed.
- The favorite existed as a small 32px outline icon beside the title; it was not absent. It now uses a 44px-minimum text-and-star button in the action area, with 收藏 / 已收藏, `aria-pressed`, independent native button behavior and visible keyboard focus.
- Cover and title now both link to the same dashboard, with opt-in hover/focus prefetch. Cover has an explicit accessible name. No nested favorite button/link.
- Existing browser-local favorite IDs remain compatible. Read/write failures previously escaped the effects; now in-page state continues with an honest local-storage warning. Failed initial reads cannot overwrite stored favorites. The surrounding AppFrame theme storage also needed exception handling, otherwise it crashed before favorites could recover.
- No account-sync feature is implied or added. Browser-local favorites remain the existing product boundary.

## Validation

`npx jest __tests__/home/HomeWorkspace.test.tsx --runInBand --silent`: 17/17 passed (2026-09-08). Coverage includes cover/title target and prefetch, removed controls, independent favorite action, persistence after remount, removal, Enter/Space activation, blocked storage and intact navigation.

## Seven-criteria review (for integrating issue artifact)

1. Blindspots: FIXED — blocked storage crashed favorites and theme; failed read could overwrite saved data. Exceptions and write guard added.
2. Clarity: PASS — visible 收藏 / 已收藏, empty overflow removed, two clear detail links.
3. Maintainability: PASS — no new dependencies, existing state/key retained, targeted interaction tests.
4. Security: PASS — no API/auth/secret changes; no HTML injection or broader data access.
5. Performance: PASS — cover uses the same on-intent prefetch; no eager dashboard fanout or new request.
6. Documentation: PASS — local-only boundary and verification limitations recorded here.
7. Style: PASS — existing paper/heading color tokens, native links/buttons and focus treatment.

Unaddressed code findings: 0. Desktop/mobile rendered preview and release verification remain the integrating agent's handoff tasks, not claims of this subtask.
