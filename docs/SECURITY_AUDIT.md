# Luna security audit

Scope: the React client, PeerJS session layer, Supabase client integration,
Storage migration, browser persistence, and Pages workflow. No production
Supabase database or real user account was accessed during this audit.

## Fixed in this stage

### High — unvalidated WebRTC messages

Previously, any received object with a string `type` was accepted. A peer could
send arbitrary input masks, oversized video/audio buffers, invalid dimensions,
or malformed approval messages. `src/netplay/protocol.ts` now validates every
wire shape, limits input bits and media sizes, and rejects unknown message types.

### High — input before host approval

The host previously forwarded guest input as soon as a data connection existed.
The session now keeps an explicit approval state. Guest input, frames, and audio
are ignored until approval succeeds.

### Medium — data-channel backpressure

Media packets could continue to queue while a connection was congested. The
session now skips packets when the underlying data channel exceeds a bounded
buffer threshold and exposes channel diagnostics.

### Medium — lifecycle duplication

Peer close/error events could call cleanup more than once. Session lifecycle is
now reset per connection and close notification is emitted once.

### Medium — private database access

The migration grants table access only to `authenticated`, revokes table access
from `anon`/`PUBLIC`, enables RLS, and checks `auth.uid()` on every owner policy.
Composite foreign keys bind each session/save row to a game owned by the same
user.

### Multi-seat session authorization

The host now assigns slots 2–4, rejects duplicate session IDs and connections
beyond the selected capacity, and validates control/media messages before
routing them. Guests receive only the stream for their assigned slot. This is
session authorization, not account authentication; room codes and PeerJS IDs
remain discoverable identifiers.

## Remaining risks

1. PeerJS uses public signaling and public STUN servers. No TURN relay is
   configured, so restrictive NATs can still fail. A connected peer is not an
   identity system; room approval is the current authorization boundary.
2. Six-digit room codes are convenient but have limited entropy. They should be
   replaced or supplemented with a short-lived invite token before treating
   rooms as private.
3. Cloud-save revision allocation is client-side. Two devices can race, and a
   storage object can remain orphaned if its metadata insert fails. A server-side
   atomic revision RPC and cleanup job are still needed.
4. The browser WASM bridge exposes save states but not battery SRAM import/export.
   The UI must not claim battery synchronization.
5. Existing custom Supabase policies are additive. Review any policies outside
   the named Luna policies before applying the migration.

## Not demonstrated

User-to-user RLS tests, cross-network WebRTC, TURN relay, Android gameplay,
Kirby gameplay, and battery-save synchronization were not performed.
