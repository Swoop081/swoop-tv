# Swoop TV v0.3.2 — Rotating Top 5 Home Hero

This build turns the Home hero into an automatic premium streaming carousel instead of leaving one movie permanently featured.

## What changed

- Home now rotates automatically through **10 featured titles**: the current **Top 5 Movies** and **Top 5 TV Shows**.
- Movie and TV-show positions are interleaved for variety: Movie #1, Show #1, Movie #2, Show #2, and so on.
- The hero advances every **8 seconds** while Home is visible. Rotation pauses while a modal, detail page, player, or hidden browser tab is active.
- Added subtle previous/next controls and position indicators so mouse, keyboard and TV-remote users can move through the hero manually.
- Swoop now refreshes the Top 20 Movie and Top 20 TV feeds even if those rows are hidden, because the Home hero depends on their current Top 5.
- If web discovery is not available yet, the hero fills missing positions from Trending, Top Rated, New & Recent, then the connected provider library so it still rotates.
- The Home hero now uses a TMDb title-logo image when one is available instead of duplicating it with a giant text title.
- Fixed the Home hero media stack so the fallback colour/gradient sits behind real backdrop/poster artwork rather than covering it.
- The first 10 hero candidates are included in metadata enrichment so their TMDb backdrop/title-logo artwork can load progressively.
- Provider persistence, Cloudflare metadata service and the proven Windows/mpv playback profile are unchanged.

## Updating Swoop

No Cloudflare Worker update is required if you already deployed the v0.3.0/v0.3.1 Worker (`version: "0.1.5"`, `metadataConfigured: true`).

1. Close the current Swoop app and the Swoop TV Windows Bridge.
2. Extract this package.
3. Run `START-SWOOP-TV-WINDOWS.cmd`.
4. Open Home and leave it visible; the featured hero should advance every 8 seconds.

For the most accurate Top 5 ranking, keep MDBList discovery configured. The hero can still fall back to the connected provider library while web rankings are unavailable.
