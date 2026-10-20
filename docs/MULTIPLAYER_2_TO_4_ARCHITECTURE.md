# Luna 2–4 player architecture

## Evidence inspected

The shipped web engine in `public/engine/` exports `_mgs_init`,
`_mgs_run_frame`, `_mgs_get_video(player)`, `_mgs_set_keys(player)` and the
corresponding audio/state functions. `GbaEngine.start(players)` clamps the
requested count to 1–4 and passes it to `_mgs_init`. This proves the bridge is
parameterized for four instances; it is not gameplay proof for every title or
link mode. The native mGBA source and a legal test ROM are not part of this
independent web repository.

## Decision

Luna uses a host-authoritative architecture: one host runs all linked GBA
instances and sends each guest only the video/audio for its assigned instance.
Guests send validated input back to the host. PeerJS/WebRTC connections are
one-to-one between host and guest; guests do not form a mesh.

This keeps link timing inside one emulator process. A distributed design would
need to synchronize link transfers and emulator cycles over the network, which
the current browser bridge does not provide.

| Concern | Decision | Reason |
| --- | --- | --- |
| Correctness | Host-authoritative | Link timing remains local to mGBA. |
| Input latency | One guest-to-host data channel | No guest-to-guest hops. |
| CPU/memory | Host runs 2–4 instances | Required for centralized timing. |
| Bandwidth | One compressed GBA stream per guest | No four-way layout broadcast. |
| Android | Guest runs UI/input/audio only | No full emulator required on guests. |
| NAT traversal | PeerJS signaling plus public STUN | TURN is not configured. |
| Security | Approval, slot binding, bounded messages | Room codes are not auth. |

## Implemented session model

- Host capacity is 2, 3, or 4 players.
- Player 1 is the host; guests occupy slots 2–4.
- The host rejects excess participants and duplicate session IDs.
- A `sessionStorage` client ID lets a reconnect reclaim its previous slot while
  the host room remains alive.
- Input routes to `engine.setKeys(slot - 1, keys)`.
- Each guest receives only `engine.frame(slot - 1)`; the current bridge exposes a
  host audio mix, so audio is broadcast to approved guests rather than isolated
  per emulator instance.
- The lobby shows pending/connected/disconnected seats. The host may start the
  local emulator before guests arrive; the lobby makes missing seats explicit
  and approved guests begin receiving their stream once connected.

## Explicit limitations

This repository does not verify Kirby gameplay, title-specific player limits,
cross-network NAT traversal, TURN relay behavior, host benchmarks, Android
physical-device behavior, or battery SRAM synchronization. The current bridge
exposes save states only.

Therefore 2P/3P/4P status is **IMPLEMENTED BUT NOT VERIFIED WITH REAL
GAMEPLAY** until the integration and real-ROM tests in
`docs/MULTIPLAYER_TEST_REPORT.md` pass.
