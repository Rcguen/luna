# Luna Task 12 test report

## Passed

- `npm run check` — TypeScript validation passed after netplay/UI changes.
- `npm run build` — Vite production build passed.
- `git diff --check` — no whitespace errors.
- Static protocol/security assertions — wire limits, owner gating, path shape,
  and MIME expectations checked.
- Live browser smoke check of the deployed home page — page rendered and showed
  the expected cloud setup state before Supabase credentials were available.

## Not available or not run

- No PostgreSQL server, Supabase CLI, or Docker runtime was available for a
  fresh/repeat migration test.
- No production SQL was executed.
- No real Supabase User A/User B RLS test was executed.
- No cross-network WebRTC, TURN, Android physical-device, legal Kirby ROM, or
  battery-SRAM test was executed.
- No formal lint/test runner was configured in the project before this stage.

## Manual acceptance checklist

1. Create two Supabase test users and verify each can only list, insert, update,
   and delete their own rows.
2. Upload and download a test save as each user; attempt the other user's path
   and confirm Storage rejects it.
3. Join a room from a second network and inspect ICE candidate type, connection
   state, received FPS, and input behavior.
4. Test Chrome Android portrait/landscape with multitouch and screen rotation.
