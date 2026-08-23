# Swoop TV v0.1.1 — Xtream Browser Connection Hotfix

Swoop TV is a content-neutral IPTV player shell for user-provided, authorised television sources. v0.1.1 keeps the dependency-free static/PWA app from v0.1 and adds an optional Cloudflare Worker connection helper for Xtream providers that fail in browsers because of CORS, HTTPS mixed-content rules, or similar browser networking restrictions.

## What changed in v0.1.1

- Added **Swoop Connection Helper** support to the Xtream provider form.
- Added the deployable `cloudflare-worker/` metadata/API relay.
- Xtream authentication, Live categories/streams, VOD categories/streams and Series categories/list calls can now use the helper.
- The helper is token protected and only permits an allowlist of Xtream `player_api.php` actions.
- The helper rejects localhost/common private-network targets and cannot proxy arbitrary video URLs.
- The UI now explains direct vs helper connection mode and remembers the helper URL.
- Improved direct-browser error reporting for CORS, mixed-content and network failures.
- Updated the PWA cache version and changed the shell to network-first so hotfixes replace stale cached JavaScript more reliably.

## Existing v0.1 foundation

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

## If Xtream says “Failed to fetch”

A working Xtream login can fail in Chrome/Safari/Edge even though it works in a native IPTV app. Native apps are not bound by browser CORS rules, and an HTTPS web app also cannot directly call many HTTP-only providers.

Swoop TV v0.1.1 includes a small Cloudflare Worker to solve the **API/catalog** side of this problem:

1. Open the `cloudflare-worker` folder.
2. Follow `cloudflare-worker/README.md` to deploy it to a free Cloudflare Workers account.
3. In Swoop TV open **Add TV Provider → Xtream → Browser Connection Helper**.
4. Paste your Worker URL and private helper token.
5. Enter the normal Xtream server, username and password and connect again.

The helper requests Xtream `player_api.php` JSON on behalf of the browser. **Video is not sent through the Worker.**

Cloudflare's Workers Free plan currently permits 100,000 Worker requests per day, which is far beyond the normal metadata request volume of a personal Swoop TV installation.

## Important playback limitation

The v0.1.1 helper fixes Xtream **login/catalog CORS and mixed-content problems**, not every browser video limitation. If a provider exposes only HTTP video streams while Swoop TV is hosted over HTTPS, or uses a codec/container the browser cannot decode, that stream may still fail in the web player. The longer-term solution is the planned native/platform wrapper/player layer for Android TV, Fire TV, Apple platforms, Tizen/webOS and other targets rather than proxying all video through Swoop infrastructure.

## Credential storage

Xtream stream URLs commonly contain the provider username and password in the URL path. Because the current v0.1.x catalog is stored in browser local storage so it survives a reload, imported Xtream catalog records can therefore contain credential-bearing stream URLs even when **Remember provider credentials** is not checked. The checkbox controls whether the separate login/helper fields are retained for later refresh/reconnect.

Treat the browser profile/device as trusted and do not use Swoop TV v0.1.x on a shared device with credentials you do not want stored locally. A later security pass should move provider secrets into a dedicated credential store on platforms that support one.

## Deploy the front end

The main Swoop TV folder can be deployed directly to GitHub Pages, Cloudflare Pages, Netlify or another static host. No build command is required.

The optional Xtream Connection Helper is deployed separately from `cloudflare-worker/` and its `workers.dev` URL is entered in the Swoop TV provider form.

## MDBList

Supply your own MDBList API key. Swoop TV fetches a list, then matches list identities against the imported provider catalog using TMDb ID, IMDb ID and title/year fallbacks.

## Next development pass

Recommended v0.2:

1. Integrated playback overlay rather than opening a player tab.
2. HLS/adaptive playback layer where platform support permits.
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
