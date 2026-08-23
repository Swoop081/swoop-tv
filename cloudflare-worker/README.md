# Swoop TV Cloudflare Connection + Metadata Service v0.1.5

This Worker has two jobs:

1. Authenticated Xtream API/artwork relay for browser builds when providers block direct browser access.
2. Owner-managed cinematic metadata/artwork lookup through TMDb so end users do not need a TMDb API key.

## Required secrets

Keep the existing secret:

- `SWOOP_PROXY_TOKEN` — long private token used for Xtream relay requests.

Add:

- `TMDB_API_TOKEN` — TMDb API Read Access Token from the Swoop owner/developer TMDb account.

After deployment, visiting the Worker URL should return JSON containing:

- `version: "0.1.5"`
- `configured: true` when `SWOOP_PROXY_TOKEN` is set
- `metadataConfigured: true` when `TMDB_API_TOKEN` is set

The TMDb route accepts only movie/TV metadata lookup inputs and returns a compact Swoop metadata object with title, year, plot, rating, poster, ranked wide backdrops and title-logo URLs. The Worker requests full TMDb details with the appended image set so titles can use the same backdrops visible on TMDb title pages. It does not proxy IPTV video.
