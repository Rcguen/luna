# Luna multiplayer test report

## Automated checks

- `npm run check` — passed after the multi-seat session changes.
- `npm run build` — passed; Vite transformed 110 modules and emitted the
  production bundle.
- `git diff --check` — passed; no whitespace errors.

## Implemented but not verified with real gameplay

- 2-player host/guest session controller.
- 3-player host plus two guests.
- 4-player host plus three guests.
- Capacity rejection and duplicate session-ID rejection.
- Slot assignment, reconnect slot memory, per-slot input routing, and
  per-guest frame routing.

## Not tested in this environment

- A legal Kirby & The Amazing Mirror ROM or an independent WASM link harness.
- Cross-network WebRTC, TURN relay, Android physical devices, or four browsers
  on separate networks.
- CPU, memory, frame pacing, bandwidth, encoder load, or measured input
  latency.
- Supabase cloud-save export/import/reload or conflict handling.

## Required manual acceptance tests

1. Start 2P, approve one guest, load a legal ROM, and confirm P1 input and P2
   video.
2. Repeat with 3P and confirm P2/P3 receive distinct frames and input routes to
   the matching emulator instance.
3. Repeat with 4P and confirm P2/P3/P4 labels, disconnect cleanup, and slot
   reclaim after reconnect.
4. Inspect WebRTC diagnostics. A relay test passes only when the selected ICE
   candidate type is `relay`.
5. Repeat from an Android guest in portrait and landscape.
