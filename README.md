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

- 2–4 player host rooms with six-digit join codes and invite links.
- Host approval before a guest receives a player slot.
- WebRTC video, per-player audio routing, and controller input transport.
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

The host supplies the legally obtained ROM and runs the emulator instances.
Guests do not need a copy of the ROM for the current host-streaming design.
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

## Current architecture and limitations

The current online mode is host-authoritative: the host runs all linked GBA
instances and streams each player's video and audio to that player's guest.
This keeps guests lightweight, but it is not two independent emulator
instances. Network quality affects streamed video/audio latency, and the game
must tolerate the link timing produced by the mGBA setup.

Real cross-network multiplayer should be tested on two physical devices,
preferably with the guest using a separate mobile network or hotspot.

## Testing policy

No ROM, BIOS, save data, or copyrighted game asset is included. Kirby & The
Amazing Mirror, or any other game, must be tested only with a ROM supplied by
the user. A UI-only or engine smoke test is not evidence that a particular
game's multiplayer mode works.
