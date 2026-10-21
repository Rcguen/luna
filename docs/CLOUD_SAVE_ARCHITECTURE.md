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

## Local-first battery saves

Battery progress is saved independently of Supabase in the
`luna-local-battery` IndexedDB database. The key combines the ROM SHA-256,
player identity, battery-save kind, and format version. Each atomic write keeps
the previous checksum-verified image as a recovery backup. Luna restores the
save before the first emulated frame and autosaves every 5 seconds, when the
page is hidden, and on an explicit game/session exit. Local writes never wait
for cloud availability.

The WASM bridge uses mGBA's `savedataClone` and `savedataRestore` APIs and
preserves the real SRAM, Flash, or EEPROM size. Save states are a separate
format and are intentionally not presented as battery saves.

## Cloud synchronization and reliability limits

Authenticated Player 1 battery saves are uploaded only after the local
IndexedDB commit succeeds. SHA-256 is calculated before every cloud decision;
unchanged content is deduplicated against the latest synchronized revision.
Cloud uploads are throttled to at most one normal upload per 30 seconds, while
local autosave remains frequent and exit/visibility events flush pending work.
Downloads are rejected unless their byte length and SHA-256 match `save_files`.
A metadata-insert failure triggers best-effort deletion of the newly uploaded
object. Retryable failures are deduplicated in the IndexedDB queue and retried
after an online transition.

After a successful new upload, retention verifies candidate objects and keeps
the newest 10 backups. Manually pinned backups are retained in addition to
those 10. The first successful upload after this feature ships is the point at
which older unpinned rows become eligible; installing the client alone does not
remove existing rows. Cleanup failures leave the row for retry.

Revision selection is still client-side and therefore not an atomic
cross-device operation. The client checks an expected revision and refuses to
overwrite a newer revision, but two simultaneous first writers can still race.
The production-grade follow-up is a Postgres RPC that atomically reserves the
next revision before object upload.

Host-streaming guests do not own a local emulator. Their battery saves remain
explicitly disabled until an authenticated transfer protocol can bind each
guest identity to its host-side native player index without sharing Supabase
tokens. Player 1 maps to native index 0; the bridge itself correctly maps UI
slots 1–4 to native indexes 0–3.
