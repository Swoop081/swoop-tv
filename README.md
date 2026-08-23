# Swoop TV v0.1 — Foundation + IPTV Import

Swoop TV is a content-neutral IPTV player shell for user-provided, authorised television sources. This first foundation build is dependency-free and can be hosted as static files.

## Included in v0.1

- Cinematic Netflix-inspired responsive Home UI (original Swoop TV styling)
- Home / Live TV / Movies / TV Shows / Search / Settings navigation
- Touch, keyboard and basic TV-remote directional navigation
- M3U import from a local file or URL
- Parsing of `tvg-id`, `tvg-name`, `tvg-logo`, `group-title`, catch-up tags and stream URLs
- Xtream authentication test and catalog import
- Xtream Live, VOD and Series category normalization
- Normalized shared catalog model
- Direct stream URL generation for Xtream live/VOD
- Basic native HTML5 video launch for directly playable streams
- MDBList list connector and matching against imported provider titles/IDs
- Custom MDBList Home rows
- Local device persistence
- Installable PWA manifest and offline shell cache
- Demo catalog when no provider is connected

## Run locally

Because ES modules and the service worker require an HTTP origin, serve this folder rather than double-clicking `index.html`.

With Python 3:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

## Deploy

This folder can be deployed directly to GitHub Pages, Cloudflare Pages, Netlify or any static web host. No build command is required.

## Important browser limitations

Some IPTV providers do not permit browser cross-origin requests (CORS), use HTTP-only endpoints, or serve codecs/containers a browser cannot decode. In those cases a native/platform wrapper or a small metadata/API relay will be needed. Swoop TV should not proxy the video payload itself unless there is a specific, lawful technical reason; direct provider-to-device playback keeps bandwidth and infrastructure costs low.

Xtream credentials are only retained when the user selects **Remember provider credentials on this device**. Browser storage is not encrypted, so the default is not to retain them.

## MDBList

The connector targets the public `https://api.mdblist.com` list endpoints. Supply your own API key from MDBList. Swoop TV fetches a list, then matches list identities against the imported provider catalog using TMDb ID, IMDb ID and title/year fallbacks.

## Next development pass

Recommended v0.2:

1. Integrated playback overlay rather than opening a player tab.
2. HLS.js/Shaka-style adaptive playback layer where platform support permits.
3. XMLTV parser and Xtream short/full EPG ingestion.
4. Full grid TV Guide with now/next and current-time marker.
5. Xtream series-detail/episode lazy loading.
6. Continue Watching persistence based on actual playback progress.
7. Favourites / My List.
8. Provider refresh and catalog-diff handling.
9. Metadata artwork/details enrichment and more robust title matching.
10. Remote focus geometry for Android TV / Fire TV / Tizen / webOS.

## Legal model

Swoop TV contains no channels or media. Users are responsible for adding sources they are authorised to access.
