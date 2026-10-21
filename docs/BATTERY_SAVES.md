# Luna battery-save implementation

## Native bridge

The source bridge lives in the sibling mGBA source tree at
`mgba-splitscreen/web/mgba_splitscreen_web.c`. It exports:

- `mgs_battery_type(player)` — detected mGBA save technology.
- `mgs_battery_export(player)` and `mgs_battery_ptr()` — a bridge-owned clone
  that JavaScript copies immediately.
- `mgs_battery_import(player, data, size, type)` — a validated restore using
  mGBA's `savedataRestore(..., writeback=true)`.

Native player indexes are zero-based. SRAM (32/64 KiB), Flash (64/128 KiB),
and EEPROM (512 B/8 KiB) use exact sizes; mismatched or ambiguous input is
rejected.

## Rebuilding the web engine

Linux/macOS with Emscripten available on `PATH`:

```sh
cd ../lunaproject/mgba-splitscreen/web
./build.sh
```

Windows uses the pinned/reviewed emsdk and Ninja directories supplied as
arguments:

```bat
cd ..\lunaproject\mgba-splitscreen\web
build-windows.cmd D:\path\to\emsdk D:\path\to\ninja\bin
```

Copy both generated files together into `public/engine/`:

```text
mgba-splitscreen-web.js
mgba-splitscreen-web.wasm
```

Never replace only one artifact. Verify SHA-256 hashes after copying, then run
`npm run check` and `npm run build` in Luna.

## Persistence order

1. Load the ROM and compute its SHA-256.
2. Resolve a stable device-local identity. It does not change while Supabase
   restores a session or when the player signs in or out. Older auth-scoped
   local saves are migrated on first load.
3. Read and checksum-validate the current IndexedDB image, falling back to its
   backup when needed.
4. Optionally download a newer cloud image only when the local image is known
   to be fully synced; otherwise report a conflict and keep local data.
5. Import the selected battery image before the first gameplay frame.
6. Autosave to IndexedDB atomically, then attempt cloud synchronization.

Cloud failure never invalidates a successful local save. The app keeps one
local backup and cloud revisions provide additional history.

## Current multiplayer boundary

Host Player 1 persistence is enabled and maps to native emulator index 0.
Host-streaming guest persistence is disabled because the guest has no local
emulator and there is not yet an authenticated save-transfer protocol.
Distributed-mode persistence is also not wired into the synchronized start
flow yet. No guest access token is sent to a host.
