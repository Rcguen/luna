# Third-party attribution

## mGBA WebAssembly engine

- **Component:** `public/engine/mgba-splitscreen-web.js` and
  `public/engine/mgba-splitscreen-web.wasm`
- **Origin:** the generated WebAssembly bridge built from the mGBA-based
  `Spuds0588/mgba-splitscreen` project, which tracks `mgba-emu/mgba`.
- **License:** Mozilla Public License 2.0 (MPL-2.0), as provided by mGBA.
- **Use here:** the binary engine is isolated behind `src/engine/wasmAdapter.ts`.
  No upstream frontend, Tauri code, or desktop UI is reused.
- **Source availability:** the source project and bridge source remain available
  in the referenced upstream repository; this application must retain this
  attribution when distributed.

## PeerJS

PeerJS is used under its own open-source license as an npm dependency. Its
license and transitive notices are supplied by the package manager in the
published source tree.
