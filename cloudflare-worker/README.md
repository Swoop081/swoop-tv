# Swoop TV Cloudflare Connection + Metadata Service v0.1.6

This Worker provides:

1. Authenticated Xtream API/artwork relay for hosted browser builds when providers block direct browser access.
2. Owner-managed TMDb enrichment so Swoop end users do not need a TMDb API key.

## Required secrets

- `SWOOP_PROXY_TOKEN` — long private token for Xtream relay requests.
- `TMDB_API_TOKEN` — TMDb API Read Access Token owned by the Swoop developer/owner.

After deployment, visiting the Worker URL should report:

- `version: "0.1.6"`
- `configured: true`
- `metadataConfigured: true`

## TMDb data returned

The metadata route now returns title/year/plot/rating, posters, ranked full-width backdrops, title logos, genres, runtime, certification, cast/characters, director or TV creators, an official YouTube trailer when available, and compact TMDb recommendations.

The Worker does **not** proxy IPTV video.
