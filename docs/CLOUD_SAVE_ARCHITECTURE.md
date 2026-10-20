# Luna cloud-save architecture

## Trust boundaries

ROM bytes remain in the browser. Supabase stores only per-user game metadata
and user-owned save files in the private `luna-saves` bucket. Browser code uses
only the project URL and publishable key.

## Ownership model

`games` owns a ROM hash per user. `play_sessions` and `save_files` include both
`user_id` and `game_id`, with composite foreign keys to `games(user_id, id)`.
RLS and table grants restrict access to the authenticated owner.

## Storage path

The client writes:

`<user-id>/<game-id>/<player-slot>/<save-type>/<revision>-<sha256>.bin`

The database check constraint and Storage policies validate the user prefix and
path shape. Upload uses `application/octet-stream`, `upsert: false`, and a
64 MiB limit. Downloads require Storage SELECT; deletes require DELETE.

## Reliability limits

The IndexedDB queue retries failed uploads after an online transition. Revision
selection is currently client-side and is not an atomic cross-device operation.
The next safe improvement is a Postgres RPC that reserves a revision and writes
metadata in one transaction, with orphan-object cleanup after failed inserts.

The current WASM bridge supports save states only. Battery SRAM synchronization,
automatic restore, and multiplayer snapshot coordination remain unsupported.
