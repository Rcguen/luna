# Supabase setup

The cloud account and save-library features are optional. Guests can still join
rooms without signing in, and the emulator keeps the ROM on the user's device.
The repository contains the schema and client integration, but it does not
contain a Supabase project URL, key, ROM, save file, or service-role secret.

## Create the backend

1. Create a Supabase project.
2. Open the Supabase SQL Editor, delete any old draft SQL, paste the complete
   contents of `supabase/migrations/20261020100000_luna_cloud_saves.sql`, and
   run it once. The script is repeatable for the expected Luna schema and
   preserves existing tables, bucket objects, and rows. It stops instead of
   rewriting data if existing rows violate the new ownership or path checks.
3. Copy `.env.example` to `.env.local` and fill in the project URL and the
   publishable (or legacy `anon`) key:

   ```text
   VITE_SUPABASE_URL=https://<project-ref>.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=<publishable-or-anon-key>
   ```

Never put a `service_role` key in `.env.local`, a Pages variable, source code,
or the browser bundle. The publishable/anon key is safe to expose because the
database and Storage policies enforce per-user access.

## Authentication and Pages

In Supabase Authentication → URL Configuration, add these redirect URLs:

- `http://localhost:5173/luna/`
- `https://rcguen.github.io/luna/`

For a local build, restart Vite after changing `.env.local`.

For GitHub Pages, add `VITE_SUPABASE_URL` and
`VITE_SUPABASE_PUBLISHABLE_KEY` as repository Actions secrets. The existing
`.github/workflows/pages.yml` passes them only to the build step.

## Data and security model

- `games` stores per-user metadata and a SHA-256 ROM identifier; ROM bytes are
  never uploaded by the app.
- `save_files` stores save metadata and revisions.
- Save bytes are kept in the private `luna-saves` bucket under
  `<user-id>/<game-id>/<player-slot>/<save-type>/<revision>-<sha256>.bin`.
- RLS policies restrict rows to `auth.uid()`, and Storage policies restrict
  objects to the authenticated user's UUID prefix and the expected path shape.
- The browser keeps failed uploads in IndexedDB and retries them when the
  browser reports an online transition.

The migration grants table access only to `authenticated`, revokes table
access from `anon`/`PUBLIC`, and recreates only the named Luna policies. Review
any custom policies on these tables before running the script, because
PostgreSQL policies are otherwise additive.

## Current emulator limitation

The current generated WASM bridge exposes save-state export/import, and the
web app includes an adapter for that capability. It does **not** expose mGBA
battery SRAM import/export APIs. Battery-save upload/restore therefore remains
explicitly unavailable until the WASM bridge is rebuilt with a real battery
save API; the UI does not pretend that this is supported.

The library currently provides manual upload/download/delete for supported
save files. Automatic restore and periodic in-game synchronization should be
added only after the emulator's battery API and save semantics are available.
