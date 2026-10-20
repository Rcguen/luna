# Luna UI/UX redesign

## Direction

Luna keeps the dark violet base but uses a restrained token system: warm pink
for the primary action, yellow for room identity, mint for healthy connection
state, and calm lavender for supporting text. The first screen now says Luna,
keeps one clear play action, and explains that ROMs stay local.

## Implemented

- Reusable CSS color/focus tokens.
- Visible keyboard focus rings.
- Reduced-motion preference support.
- Accessible labels for room code, ROM upload, authentication fields, and
  game canvases.
- Live status announcements for connection and action feedback.
- Invite-link generation and copy action for host rooms.
- Guest audio context is initialized from the join gesture instead of being
  dereferenced before initialization.
- Touch buttons have explicit labels, pointer capture, cancellation, and no
  context-menu interruption.
- Diagnostics now show data-channel state and received FPS when measurable.

## Intentionally not changed yet

The production logo and icon assets were not replaced. Three original concept
SVGs are provided separately for approval. The host and guest still use one
large player-specific screen each, preserving the current multiplayer model.
