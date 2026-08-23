# Swoop TV Release Notes

## v0.3.1 — Backdrop Visibility + Title Logo Cleanup — 23 August 2026

- Fixes a detail-screen stacking bug where the local fallback background was rendered after, and therefore on top of, a valid TMDb backdrop. TMDb backdrops were being fetched but visually hidden behind the fallback layer.
- The detail media stack now explicitly keeps the fallback at the bottom, cinematic backdrop above it, then vignette/legibility layers above the artwork.
- When TMDb supplies a proper title-logo image, Swoop now uses that as the title treatment and removes the duplicate large text movie/show name from the hero.
- Text title remains as the fallback for titles without a TMDb logo.
- Slightly increases title-logo sizing for a more premium streaming-service presentation.
- No provider, persistence, discovery, Cloudflare metadata, or Windows/mpv playback behavior changes.

## v0.3.0 — True TMDb Backdrops + Cinematic Detail — 23 August 2026

- Fixed title-detail heroes that remained mostly black while only showing a vertical poster even when TMDb had wide backdrops.
- TMDb metadata service now fetches full title details with `append_to_response=images`.
- Added ranked TMDb backdrop selection and cached backdrop galleries.
- Added TMDb title-logo support.
- Movie/TV detail pages now prefer full-bleed cinematic backdrops and only use the large vertical poster as a fallback when no real backdrop exists.
- Rebalanced title-detail gradients/vignettes so backdrop artwork is clearly visible.
- Metadata artwork schema bumped so old cached metadata is refreshed once.
- Swoop Connection + Metadata Worker updated to v0.1.5.
- Provider persistence and Windows/mpv playback are unchanged.

## v0.2.9 — Durable Provider Persistence — 23 August 2026

- Fixed provider/Xtream credentials disappearing after refresh on large IPTV libraries.
- Root cause: the app stored the complete catalog and provider settings in one `localStorage` payload; large providers can exceed localStorage quota and make the entire save fail.
- Added separate durable provider-profile storage.
- Added IndexedDB storage for the large catalog and other bulk caches.
- Xtream **Keep me signed in on this device** is enabled by default for a new provider.
- M3U now has a separate **Remember this playlist on this device** option and restores URL/EPG fields.
- Added a **Restoring Swoop** startup state while the saved catalog is loaded.
- Provider setup waits for durable catalog persistence before reporting success.
- Existing v0.2.8 data migrates automatically when readable.
- Disconnect clears the saved provider profile.
- Windows native playback behavior is unchanged.

## v0.2.8 — Cinematic Metadata + Home Appearance — 23 August 2026

- Added TMDb metadata/backdrop enrichment through the owner-managed Swoop metadata service.
- Added Home background colour controls.
- Improved discovery title matching and expanded selectable Home categories.
