# Swoop TV v0.3.1 — Backdrop Visibility + Title Logo Cleanup

This hotfix fixes the detail-screen rendering bug where TMDb backdrops were already being returned by the metadata service but were hidden behind Swoop's fallback background layer.

## What changed

- Genuine TMDb backdrops now render visibly across movie and TV-show detail heroes.
- The fallback gradient is explicitly kept behind the backdrop instead of covering it.
- Vignette/legibility layers remain above the artwork so text is readable without hiding the image.
- When TMDb provides a proper title-logo image, Swoop now uses the logo as the hero title treatment and removes the duplicate giant text title.
- If no TMDb title logo exists, Swoop still shows the normal text title.
- Title logos are slightly larger for a more premium streaming-service presentation.
- Provider persistence, discovery, TMDb metadata fetching, Cloudflare Worker behavior and the proven Windows/mpv playback profile are unchanged.

## Updating Swoop

No Cloudflare Worker update is required if you already deployed the v0.3.0 Worker (`version: "0.1.5"`, `metadataConfigured: true`).

1. Close the current Swoop app and the Swoop TV Windows Bridge window.
2. Extract this package.
3. Run `START-SWOOP-TV-WINDOWS.cmd`.
4. Open a movie or TV-show detail page that has TMDb artwork.

Because the underlying TMDb metadata is already cached correctly, the backdrop should become visible immediately once this UI fix is running.
