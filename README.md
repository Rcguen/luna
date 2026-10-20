# Luna — GBA Multiplayer

Luna is a browser-based multiplayer front end for Game Boy Advance games. It
supports 2–4 player rooms for GBA titles that support multiplayer or link-cable
play. The host runs the linked mGBA instances; guests connect from another
device, receive their player's video and audio stream, and send controller
input back to the host.

This means the application is not limited to Kirby. Any legally obtained GBA
game that works with the supported mGBA link-cable setup may be tested, subject
to the game's own multiplayer requirements and compatibility.

## Features

- 2–4 player rooms with six-digit join codes and invite links.
- Host approval before a guest receives a player slot.
- Two online modes: host streaming, or distributed same-ROM deterministic input sync.
- Host-stream WebRTC video/audio routing and controller input transport.
- Distributed mode keeps video and audio local and exchanges only frame-numbered input.
- Desktop keyboard controls and mobile touch controls.
- Local ROM caching so a previously loaded ROM can be selected again on the
  same device.
- Optional account-backed game metadata and cloud save files; ROM files stay
  on the user's device.
- GitHub Pages deployment at `https://rcguen.github.io/luna/`.

## Supported game requirements

The game must be a GBA title with a multiplayer or link-cable mode that is
compatible with the linked mGBA instances. Single-player games can still be
used in solo mode, but they will not gain multiplayer functionality.

For host streaming, the host supplies the legally obtained ROM and runs all
linked emulator instances; guests do not need a copy. For distributed mode,
every participant must load the exact same ROM locally. Luna verifies the
SHA-256 ROM hash before approval and does not upload ROM bytes.
Do not upload or commit ROMs, BIOS files, save data, or other copyrighted game
assets to this repository.

## Development

```powershell
npm install
npm run dev
```

Open the Vite URL in a browser. On the host device, load a legal `.gba` ROM,
choose 2, 3, or 4 players, and create a room. Share the generated invite link
or six-digit room code. Each guest joins, waits for host approval, and uses the
touch controls or keyboard mapping available on their device.

Run the production checks with:

```powershell
npm run check
npm run build
```

## Deployment

The GitHub Pages workflow builds the Vite app and publishes `dist/` at
`https://rcguen.github.io/luna/`. PeerJS provides signaling. The application
currently configures public STUN servers but has no TURN service, so some
restrictive NAT or firewall combinations may not connect until TURN is added.

## Online architectures and limitations

Host streaming remains available: the host runs all linked GBA instances and
streams each player's video/audio to that player's guest. This keeps guests
lightweight, but network quality affects streamed video/audio latency.

Distributed mode is a replicated deterministic session. Each browser runs the
same local mGBA linked-core group and consumes the same ordered input vector
for every emulation tick. The session waits when an input for a tick is late,
instead of running ahead and silently diverging. Audio and video are rendered
locally, so this mode avoids guest video blur and streamed guest audio.

This is not a networked one-core SIO driver: the browser WASM engine still
links the local cores, and the peers synchronize inputs rather than serial
register transfers. It works best for deterministic GBA link games and still
needs real-ROM, two-device verification. Randomness, RTC behavior, emulator
version differences, packet loss, and browser throttling can expose divergence.
Distributed rooms require the same player count and ROM hash on every device.

Real cross-network multiplayer should be tested on two physical devices,
preferably with the guest using a separate mobile network or hotspot. In
distributed mode both devices must load the same legal ROM, choose the same
player count, create/join the distributed room, and wait for approval.

## Testing policy

No ROM, BIOS, save data, or copyrighted game asset is included. Kirby & The
Amazing Mirror, or any other game, must be tested only with a ROM supplied by
the user. A UI-only or engine smoke test is not evidence that a particular
game's multiplayer mode works.
