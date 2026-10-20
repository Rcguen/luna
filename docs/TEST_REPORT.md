# Luna Task 12 test report

## Passed

- `npm run check` — TypeScript validation passed after netplay/UI changes.
- `npm run build` — Vite production build passed.
- `git diff --check` — no whitespace errors.
- Static protocol/security assertions — wire limits, owner gating, path shape,
  and MIME expectations checked.
- Live browser smoke check of the deployed home page — page rendered and showed
  the expected cloud setup state before Supabase credentials were available.
- Auth redirect source audit — signup, resend, and recovery use the shared
  `/luna/`-aware helper; callback cleanup preserves the current path.
- `/luna/` asset smoke test — HTML, Emscripten JavaScript, and WASM returned
  HTTP 200 under the deployment base; Node successfully compiled the WASM
  binary and reported 33 exports.
- Browser smoke test — Solo control, room capacity selector, and Create room
  controls rendered in the local `/luna/` page.

## Not available or not run

- No PostgreSQL server, Supabase CLI, or Docker runtime was available for a
  fresh/repeat migration test.
- No production SQL was executed.
- No real Supabase User A/User B RLS test was executed.
- No cross-network WebRTC, TURN, Android physical-device, legal Kirby ROM, or
  battery-SRAM test was executed.
- No formal lint/test runner was configured in the project before this stage.
- No real confirmation email, PKCE exchange, password recovery, or Supabase
  dashboard configuration test was executed.
- No legal ROM was available in the accessible workspace, so emulator ROM
  acceptance, frame execution, non-placeholder framebuffer pixels, and input
  state changes were not tested.

## Manual acceptance checklist

1. Create two Supabase test users and verify each can only list, insert, update,
   and delete their own rows.
2. Upload and download a test save as each user; attempt the other user's path
   and confirm Storage rejects it.
3. Join a room from a second network and inspect ICE candidate type, connection
   state, received FPS, and input behavior.
4. Test Chrome Android portrait/landscape with multitouch and screen rotation.
