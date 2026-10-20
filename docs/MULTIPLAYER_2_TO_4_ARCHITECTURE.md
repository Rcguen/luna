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

Luna supports two explicit architectures. Host streaming keeps one host running
all linked GBA instances and sends each guest only the video/audio for its
assigned instance. Distributed mode runs the same linked-core group on every
device and synchronizes the complete per-frame input vector through a host
relay. Both modes use PeerJS/WebRTC for signaling and transport.

The distributed implementation deliberately does not pretend to expose a
network SIO driver: the shipped bridge has a reliable local mGBA lockstep
coordinator, so each browser keeps link timing local and peers wait for the
same inputs before advancing. This removes streamed guest video/audio while
preserving the generic mGBA link behavior for supported GBA games.

| Concern | Decision | Reason |
| --- | --- | --- |
| Correctness | Host-authoritative | Link timing remains local to mGBA. |
| Input latency | One guest-to-host data channel | No guest-to-guest hops. |
| CPU/memory | Host runs 2–4 instances | Required for centralized timing. |
| Bandwidth | One compressed GBA stream per guest | No four-way layout broadcast. |
| Android | Guest runs UI/input/audio only | No full emulator required on guests. |
| NAT traversal | PeerJS signaling plus public STUN | TURN is not configured. |
| Security | Approval, slot binding, bounded messages | Room codes are not auth. |

### Distributed same-ROM mode

- Every participant loads a legal local ROM. The SHA-256 hash must match before
  the host can approve the player.
- Every browser initializes the same 2–4 local mGBA cores, applies the same
  input vector for tick `N`, then advances one local linked frame.
- The host relays guest input messages, but no ROM, video, audio, save state,
  or framebuffer bytes cross the network.
- A ready barrier prevents one device from starting before all approved peers
  have loaded the ROM. A missing input tick pauses advancement rather than
  allowing the local copies to drift.
- This is deterministic replication, not a distributed serial-register
  transport. It requires matching ROM bytes, matching player count, the same
  WASM build, and a browser/network that can keep the ordered data channel
  alive.

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

The distributed mode has passed TypeScript and production-build checks only;
no legal ROM or two-physical-device gameplay test has been run in this
environment.
