# Swoop TV Release Notes

## v0.1.1 — Xtream Browser Connection Hotfix — 23 August 2026

Supersedes v0.1 as the current working development baseline.

### Xtream connectivity
- Added an optional **Swoop Connection Helper** path for Xtream providers blocked by browser CORS, HTTPS mixed-content rules or browser networking restrictions.
- Added a deployable Cloudflare Worker under `cloudflare-worker/`.
- Helper requests are token authenticated and restricted to an allowlist of Xtream `player_api.php` metadata actions.
- Helper rejects localhost/common private-network targets and never relays video streams.
- Xtream form now accepts a Helper URL and token and automatically uses the helper when configured.
- Direct connection remains the default when no Helper URL is present.
- Improved connection errors so browser transport failures explicitly direct the user to the helper instead of reporting a generic `Failed to fetch`.

### PWA hotfix delivery
- Bumped the service-worker cache to `swoop-tv-v011-shell`.
- Service worker now removes obsolete shell caches on activation.
- Same-origin app assets now use network-first loading with cache fallback so updated JavaScript is less likely to remain stuck behind an old PWA cache.

### Security / disclosure
- Corrected the credential-storage description: Xtream stream URLs can embed provider credentials and the v0.1.x persistent catalog can therefore contain credential-bearing URLs even when the separate Remember-login option is off.
- The helper token is only persisted when Remember provider credentials is selected.

### Verification
- M3U parsing test passes.
- MDBList-to-catalog matching test passes.
- Xtream API URL construction test passes.
- Xtream Worker transport/auth request test passes.
- Worker CORS response and private-network rejection tests pass.

## v0.1 — Foundation + IPTV Import — 23 August 2026

Initial working development baseline.

### Foundation
- Added the responsive Swoop TV application shell and original cinematic streaming UI.
- Added desktop navigation plus mobile bottom navigation.
- Added basic keyboard / TV-remote directional focus handling.
- Added installable PWA manifest and offline application-shell caching.

### Provider import
- Added local-file and URL M3U import.
- Added M3U metadata parsing and Live/Movie/Series classification.
- Added Xtream login test and catalog ingestion for Live TV, VOD and Series.
- Added normalized internal catalog records shared across provider types.
- Added provider catalog counts, disconnect flow and optional credential retention.

### Discovery
- Added MDBList API-key and list connection UI.
- Added list-item retrieval scaffold using public MDBList list endpoints.
- Added TMDb/IMDb/title matching against the user's imported provider catalog.
- Added custom matched MDBList rows to the Home screen.

### Playback
- Added first-pass direct HTML5 video launch for playable stream URLs.
- Streams remain provider-to-device; Swoop TV does not proxy video data.

### Scope held for v0.2+
- Full adaptive streaming engine.
- Integrated player overlay.
- XMLTV/Xtream EPG and grid guide.
- Series episode detail/lazy loading.
- Real Continue Watching, My List/favourites and richer metadata enrichment.
