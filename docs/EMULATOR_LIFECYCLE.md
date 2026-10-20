# Luna emulator lifecycle

The web lifecycle is now:

1. `GbaEngine.start(players)` loads the Emscripten factory and WASM using
   `import.meta.env.BASE_URL`, initializes 1 instance for Solo or 2–4 for a
   Host room, and records the WASM/emulator state.
2. `loadRom()` copies the user-selected bytes into WASM memory and calls
   `_mgs_load_rom`. A nonzero return is reported as a failed ROM load.
3. Solo starts immediately after ROM acceptance. Host can start immediately
   after ROM acceptance and does not wait for WebRTC guests; missing guests are
   shown as a room state while the host emulator continues to run.
4. A `requestAnimationFrame` loop advances `_mgs_run_frame()` at GBA frame
   pacing, extracts `_mgs_get_video(player)`, and writes the real RGBA bytes to
   the visible canvas with `putImageData`.
5. Host mode compresses remote player framebuffers only after a guest is
   approved. Guest mode decodes only the stream for its assigned slot.
6. Leaving Solo or a room stops the engine, closes PeerJS, cancels the frame
   loop, and clears references.

The diagnostics panel reports WASM state, emulator state, ROM acceptance,
executed/rendered frame counters, framebuffer dimensions, and the last startup
error. It does not report “running” until ROM acceptance and frame execution
occur.
