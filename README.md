# Kirby Online

An online-first two-player GBA web application. The host owns two linked mGBA
instances; the guest receives Player 2 audiovisual frames and sends only Player
2 input back to the host.

This is an independent application layer. It reuses only the generated
Emscripten engine pair from the existing mGBA-based project; the React UI,
engine adapter, room protocol, WebRTC session, and deployment workflow are new
code in this repository.

## Development

```powershell
npm install
npm run dev
```

Open the Vite URL in two browser windows. The host selects a legally obtained
ROM, creates a room, and approves the guest. The guest does not need the ROM.

## Deployment

The Pages workflow builds the Vite app and publishes `dist/` at
`https://rcguen.github.io/luna/`. PeerJS provides signaling; the
application currently configures public STUN servers and has no TURN service.
Restrictive NAT pairs may therefore require a future TURN configuration.

## Testing policy

No ROM, BIOS, save data, or copyrighted game asset is included. Kirby gameplay
must be tested with a ROM supplied by the user and must not be claimed from a
UI-only or engine smoke test.
