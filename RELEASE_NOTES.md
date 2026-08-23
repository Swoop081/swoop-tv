# Swoop TV Release Notes

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
