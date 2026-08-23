# Swoop TV Release Notes

## v0.2.8 — Cinematic Metadata + Home Appearance — 23 August 2026

- Added owner-managed TMDb metadata/artwork integration through the Swoop Cloudflare Worker (`TMDB_API_TOKEN`).
- Added automatic full-width movie/TV backdrops and improved poster fallback for Home/detail presentation.
- Added persistent Home background colour picker, hex input and three presets inside Customize Home.
- Added a large live Home appearance preview inside Customize Home.
- Improved MDBList/provider matching by stripping common IPTV prefixes/quality labels/year suffixes, using media-specific matching and conservative fuzzy fallback.
- Top 20 rows now combine the primary popularity list with the current streaming chart when more playable matches are needed.
- Added Romance, Adventure, Fantasy, Mystery, Western, War, Music/Musical movie rows plus Action/Adventure, Sci-Fi/Fantasy, Mystery, Thriller, Animation and Family/Kids TV rows.
- Existing dynamic provider-category rows remain selectable.
- Invalidates the old v0.2.7 discovery cache once so new matching runs immediately.
- Swoop Connection Helper updated to v0.1.4 with a narrow TMDb metadata route and metadata health status.
- Windows bridge/bootstrap and PWA shell cache bumped to v0.2.8.
- Windows native playback profile is unchanged from the proven compatibility baseline.
