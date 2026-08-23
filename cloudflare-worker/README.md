# Swoop TV Cloudflare Connection + Metadata Service v0.1.7

This Worker provides:

1. Authenticated Xtream API/artwork relay for hosted browser builds when providers block direct browser access.
2. Owner-managed TMDb enrichment so Swoop end users do not need a TMDb API key.
3. Owner-managed Swoop discovery charts. TMDb supplies the baseline daily/weekly/popular/current-release signals; an optional owner MDBList key adds more independent streaming/popularity inputs.

## Secrets

Required for the existing Xtream relay:
- `SWOOP_PROXY_TOKEN` — long private token for Xtream relay requests.

Required for cinematic metadata and built-in web discovery:
- `TMDB_API_TOKEN` — TMDb API Read Access Token owned by the Swoop developer/owner.

Optional but recommended for the full blended discovery ranking:
- `MDBLIST_API_KEY` — one MDBList API key owned by the Swoop developer/owner. End users do not need their own key for built-in Top 20 / Trending rows.

After deployment, visiting the Worker URL should report:
- `version: "0.1.7"`
- `configured: true`
- `metadataConfigured: true`
- `discoveryConfigured: true`
- `mdblistConfigured: true` when `MDBLIST_API_KEY` is present

The Worker does **not** proxy IPTV video.
