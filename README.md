# Swoop TV v0.3.0 — True TMDb Backdrops + Cinematic Detail

This build fixes the title-detail presentation shown in v0.2.9 where a vertical provider/TMDb poster could be visible on the right while the rest of the hero remained mostly black even though TMDb had proper wide backdrops for the title.

## What changed

- Swoop now fetches **full TMDb title details + the complete image set** in one request using TMDb `append_to_response=images`.
- Movie and TV image results include **backdrops, posters and title logos**.
- Swoop ranks available backdrops for wide cinematic presentation and stores a small backdrop gallery for each enriched title.
- The best TMDb backdrop becomes the primary full-width artwork for:
  - movie detail heroes
  - TV-show detail heroes
  - Home/collection hero presentation when that title is featured
- When a real wide backdrop exists, the large vertical poster is no longer shown as the dominant right-side detail artwork.
- If TMDb has no usable backdrop, Swoop still falls back to provider artwork/poster presentation.
- TMDb title logos are retained where available and can appear in the detail hero.
- The detail-page vignette was rebalanced so the artwork remains visible while the left-side text stays readable.
- Old v0.2.8/v0.2.9 metadata cache entries are invalidated once so titles are re-enriched with the new artwork schema.
- Provider persistence and the proven Windows/mpv playback profile are unchanged.

## One-time Cloudflare update required

The Swoop metadata Worker has changed from v0.1.4 to **v0.1.5**.

1. Open `cloudflare-worker/worker.js` from this package.
2. In Cloudflare, open the existing `swoop-tv-connection` Worker and choose **Edit code**.
3. Replace the existing Worker code with the new file and deploy it.
4. Keep both existing secrets:
   - `SWOOP_PROXY_TOKEN`
   - `TMDB_API_TOKEN`
5. Visit the Worker URL and confirm it reports `version: "0.1.5"` and `metadataConfigured: true`.

No end user needs a TMDb account or API key.

## Updating Swoop

Close the current Swoop app and Windows Bridge, extract this package, then run `START-SWOOP-TV-WINDOWS.cmd`.

The first time a title is opened or selected for a hero, Swoop will refresh its TMDb metadata and cache the new cinematic artwork locally.
