# Swoop TV Cloudflare Connection + Metadata Service v0.1.21

This Worker provides:

1. Authenticated Xtream API/artwork relay for hosted browser builds when providers block direct browser access.
2. Owner-managed TMDb enrichment so Swoop TV end users do not need a TMDb API key.
3. Owner-managed Swoop TV discovery charts. With `MDBLIST_API_KEY`, a curated allow-list of Snoak's daily MDBList feeds is the primary ranking layer for Top 100, New & Hot and the curated Home platform/genre rows; TMDb and MDBList official charts remain fallback signals.
4. Optional IMDb rating enrichment for movie/TV poster badges. TMDb resolves the canonical IMDb title ID; MDBList supplies the IMDb rating when `MDBLIST_API_KEY` is configured.
5. A lightweight `imdb-rating` endpoint for viewport-driven poster badge hydration, so visible cards can fetch ratings without loading full cast/trailer/recommendation metadata.
6. Strict provider-title identity matching: explicit provider years are hard constraints, and title searches never fall back to a different release year.
7. Deeper ranked discovery candidate pools for Top 100 rails, including multi-page TMDb popularity scanning before local-library matching.
8. People search via `person-search` for actors/actresses/directors, plus filmography lookup via `person-credits`. Acting identities return cast credits; directing identities return directing credits, and the Swoop TV client strictly matches those credits against the user's own provider library.
9. Allow-listed Snoak list lookup via `snoak-list`, with optional freshness rejection when MDBList exposes an update timestamp older than eight days.

## Secrets

Required for the existing Xtream relay:
- `SWOOP_PROXY_TOKEN` — long private token for Xtream relay requests.

Required for cinematic metadata and built-in web discovery:
- `TMDB_API_TOKEN` — TMDb API Read Access Token owned by the Swoop TV developer/owner.

Recommended for Snoak-backed discovery and IMDb ratings:
- `MDBLIST_API_KEY` — one MDBList API key owned by the Swoop TV developer/owner. It powers the enhanced discovery signals and IMDb rating badge lookup; end users do not need their own key.

After deployment, visiting the Worker URL should report:
- `version: "0.1.21"`
- `configured: true`
- `metadataConfigured: true`
- `discoveryConfigured: true`
- `mdblistConfigured: true` when `MDBLIST_API_KEY` is present

The Worker does **not** proxy IPTV video.
