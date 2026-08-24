# Swoop TV Cloudflare Connection + Metadata Service v0.1.12

This Worker provides:

1. Authenticated Xtream API/artwork relay for hosted browser builds when providers block direct browser access.
2. Owner-managed TMDb enrichment so Swoop TV end users do not need a TMDb API key.
3. Owner-managed Swoop TV discovery charts. TMDb supplies the baseline daily/weekly/popular/current-release signals; an optional owner MDBList key adds more independent streaming/popularity inputs.
4. Optional IMDb rating enrichment for movie/TV poster badges. TMDb resolves the canonical IMDb title ID; MDBList supplies the IMDb rating when `MDBLIST_API_KEY` is configured.
5. A lightweight `imdb-rating` endpoint for viewport-driven poster badge hydration, so visible cards can fetch ratings without loading full cast/trailer/recommendation metadata.
6. Strict provider-title identity matching: explicit provider years are hard constraints, and title searches never fall back to a different release year.
7. Deeper ranked discovery candidate pools for Top 100 rails, including multi-page TMDb popularity scanning before local-library matching.
8. Cast-member filmography lookup via `person-credits`, returning TMDb movie/TV credits that the Swoop TV client strictly matches against the user's own provider library.

## Secrets

Required for the existing Xtream relay:
- `SWOOP_PROXY_TOKEN` — long private token for Xtream relay requests.

Required for cinematic metadata and built-in web discovery:
- `TMDB_API_TOKEN` — TMDb API Read Access Token owned by the Swoop TV developer/owner.

Optional but recommended for the full blended discovery ranking:
- `MDBLIST_API_KEY` — one MDBList API key owned by the Swoop TV developer/owner. It powers the enhanced discovery signals and IMDb rating badge lookup; end users do not need their own key.

After deployment, visiting the Worker URL should report:
- `version: "0.1.12"`
- `configured: true`
- `metadataConfigured: true`
- `discoveryConfigured: true`
- `mdblistConfigured: true` when `MDBLIST_API_KEY` is present

The Worker does **not** proxy IPTV video.
