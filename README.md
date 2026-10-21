# Luna — Your game space

Luna is a browser-based home for your own games: keep a library, pick up where
you left off, and play solo or with friends. The interface is designed to grow
into a multi-system game hub rather than being tied to one title or console.

**What works today:** Game Boy Advance emulation powered by mGBA. Nintendo DS
and PlayStation are future directions shown in the UI as **Planned**; their
emulators and games are **not supported yet**.

| System | Status | What Luna currently offers |
| --- | --- | --- |
| Game Boy Advance | Available | Solo play and 2–4 player rooms for compatible GBA link-cable games |
| Nintendo DS | Planned | No DS emulator or multiplayer support yet |
| PlayStation | Planned | No PS1 emulator or multiplayer support yet |

Luna's library and play screens are intended to accommodate more systems over
time. Each new console will need its own emulator integration, controls, save
handling, and compatibility testing. The planned cards are not playable
features or a release-date promise.

## Play with your own games

- Load a legally obtained GBA ROM from your device. Luna does not bundle ROMs
  or a BIOS.
- Previously loaded ROMs can be cached in the same browser, so you need not
  choose the file on every visit. An account can keep game metadata and cloud
  saves; ROM files remain on your device and do not sync through the account.
- Play solo, or create a room with a six-digit code and invite link. The host
  approves guests before they receive a player slot.
- Use a keyboard on desktop or touch controls on mobile. The game layout
  adapts to portrait and landscape screens.

Luna is not limited to Kirby: any legally obtained GBA title can be tried.
Multiplayer requires that the game itself support a compatible link-cable
mode. A game working in solo mode does not imply its multiplayer mode works.

## Development

```powershell
npm install
npm run dev
```

Open the Vite URL in a browser and load a legal `.gba` ROM for solo play. To
play together, choose 2, 3, or 4 players and create a room. Share the generated
invite link or six-digit code. For host streaming, only the host needs the ROM;
for distributed mode, every player needs the exact same ROM. Guests wait for
host approval before playing.

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

## Current GBA multiplayer modes and limitations

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

## Testing and rights

No ROM, BIOS, save data, or copyrighted game asset is included. Bring your own
legally obtained games. A UI-only or engine smoke test is not evidence that a
particular game's multiplayer mode works, and the planned DS/PS1 systems have
not been implemented or tested.
