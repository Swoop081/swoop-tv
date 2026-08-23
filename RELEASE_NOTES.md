# Swoop TV Release Notes

## v0.2.7 — Dynamic Discovery + Customizable Home — 23 August 2026

- Adds **Top 20 Movies** and **Top 20 TV Shows** as ranked, selectable Home rows sourced from MDBList's current Popular Movies / Popular Shows rankings; Swoop scans the ranking and keeps the first 20 titles available from the connected provider library.
- Adds **Trending Movies** and **Trending TV Shows** using MDBList's JustWatch streaming-chart API and matching the results to playable provider titles.
- Adds a large **Customize Home** screen: enable/disable rows, reorder them with Up/Down controls, reset defaults, and refresh web discovery on demand.
- Home is now fully row-driven rather than hard-coded; Continue Watching, My List, Live Now, New/Recent, Top Rated, genres, all Movies/Shows and web discovery are all selectable.
- Adds many built-in genre/theme rows plus dynamically generated rows for the provider's largest Movie and TV category groups.
- Category rows use a deterministic daily shuffle so repeated Home visits do not permanently show the same titles in the same order.
- Web discovery cache refreshes automatically every **4 hours** to keep Home changing without wasting the MDBList free API allowance.
- Custom MDBList rows now persist their source information and automatically refresh on the same schedule; newly added custom rows are automatically enabled on Home.
- Home-row selections and custom MDBList definitions are preserved across provider reconnects; the rows are simply rematched against the new provider catalog.
- Windows-native mode fetches MDBList data through the local loopback bridge to avoid browser CORS problems.
- Adds ranked Top 20 visual treatment with oversized number badges.
- Keeps the exact known-working v0.2.3/v0.2.6 Windows mpv compatibility profile; no playback flags are changed.
- PWA shell cache / Windows bridge/bootstrap version bumped to v0.2.7.

## v0.2.6 — Streaming Library Experience — 23 August 2026

- Adds full-screen cinematic Movie/Series detail pages with provider metadata, synopsis, backdrop treatment, Play and My List.
- Adds on-demand Xtream movie metadata through `get_vod_info`; the included Connection Helper is bumped to v0.1.3 and allows `vod_id`.
- Adds real Xtream season/episode loading through `get_series_info`, season selectors, episode cards and series episode stream URL playback.
- Adds functional persistent My List plus a dedicated My List page and Home rail.
- Replaces the fake Continue Watching progress row with real recently launched movies/episodes. Exact mpv playback-position synchronisation remains future work.
- Adds a dedicated premium TV Guide with rolling three-hour timeline, NOW marker, progressive Xtream `get_short_epg` loading and M3U XMLTV parsing.
- Adds richer imported provider metadata/backdrop fields when supplied by Xtream.
- Adds stronger hover/focus detail affordances and functional genre/category discovery links.
- Keeps the exact proven v0.2.3 Windows mpv compatibility playback profile; no playback tuning changes in this version.
- Windows bridge/bootstrap version bumped to 0.2.6; PWA shell cache bumped to `swoop-tv-v026-shell`.

## v0.2.5 — Cinematic Streaming UI — 23 August 2026

- Rebuilds the Swoop presentation around a big, bold cinematic streaming-service layout while retaining Swoop's own purple/teal visual identity.
- Home now opens with a full-height featured-content hero using provider artwork when available, oversized title typography, metadata and a prominent Play action.
- Adds a stronger black-first navigation treatment with a larger Swoop wordmark, cleaner text navigation, provider shortcut and profile/settings control.
- Horizontal content rails are substantially larger, denser and more cinematic; poster rows use tall artwork while Live TV uses wide 16:9 tiles.
- Cards now have stronger focus/hover expansion, deep shadowing, simplified overlays and a high-visibility red LIVE badge.
- Adds a connected-library strip with provider name and live/movie/show counts directly beneath the Home hero.
- Movies, TV Shows and Live TV receive dedicated visual landing heroes, category pills and large content grids rather than utility-style list pages.
- Search is redesigned around a large streaming-style search field and visual result grid.
- Settings is rebuilt as large premium cards with provider/library statistics and clearer playback/discovery sections.
- Provider setup/import progress keeps all v0.2.4 behavior but is visually restyled to match the cinematic application shell.
- Responsive rules are refreshed for mobile, desktop and TV-sized layouts.
- No Windows playback tuning changes: v0.2.5 retains the proven v0.2.3 mpv profile and v0.2.1 diagnostics.
- PWA shell cache bumped to `swoop-tv-v025-shell`; Windows bridge/bootstrap version bumped to 0.2.5.

## v0.2.4 — Provider Setup UX + Import Progress — 23 August 2026

- Redesigns Add/Manage Provider into two clean provider choices: **Xtream Codes first**, then **M3U Playlist**.
- Xtream shows only provider name, server URL, username/password, native/helper status where relevant, Remember and Connect.
- M3U shows only provider name, playlist URL or local file, optional XMLTV/EPG URL and Import.
- Removes the confusing mixed M3U/Xtream presentation that could make the active connection type unclear.
- Adds a dedicated **PLEASE WAIT** connection/import screen instead of leaving the user on the form with a small status strip.
- Xtream progress visibly tracks: contacting provider, verifying login, loading Live TV, loading Movies, loading TV Shows and building the Swoop library.
- Section completion reports actual item counts as each provider catalog section returns.
- M3U progress tracks reading playlist, parsing channels and building the library.
- Success and error states are explicit; errors provide a **Back to details** route without clearing the entered form.
- Keeps the exact proven v0.2.3 Windows mpv playback profile; no playback tuning changes in this release.
- PWA shell cache bumped to `swoop-tv-v024-shell`; Windows bridge/bootstrap version bumped to 0.2.4.

## v0.2.3 — Playback Recovery Hotfix — 23 August 2026

- Restores the exact v0.2.1 Windows-native mpv Live TV launch profile after v0.2.2's aggressive fast-start tuning prevented a previously working real Xtream stream from playing.
- Removes the v0.2.2 forced low-latency profile, forced MPEG-TS demuxer, reduced libavformat probing, 2-second cache, 1-second read-ahead and 8-second live network timeout from the default playback path.
- Retains the v0.2.1 diagnostics and persistent mpv window so failures remain visible and debuggable.
- Adds an explicit bridge-console message confirming the compatibility playback profile is active.
- Existing mpv installation, Xtream setup, local bridge architecture and Cloudflare setup remain compatible; no reinstallation or Worker/token change is required.
- PWA/local shell cache bumped to `swoop-tv-v023-shell`; package metadata bumped to 0.2.3.
- Startup optimization is reset to a measured, one-change-at-a-time process from this known-working baseline.

## v0.2.2 — Fast Live Startup Hotfix — 23 August 2026

- Live TV now launches with mpv's built-in `low-latency` profile instead of the conservative file-style startup settings from v0.2/v0.2.1.
- Reduced the live packet cache from 15 seconds to 2 seconds and live demuxer read-ahead from 20 seconds to 1 second.
- Disabled cache-pausing for Live TV so mpv does not wait for a large prebuffer before presenting the channel.
- Reduced libavformat live stream analysis to 1 second with a 256 KiB probe ceiling and `probe-info=nostreams`.
- Xtream/raw `.ts` live endpoints are identified to mpv as MPEG-TS up front, avoiding unnecessary format-detection delay.
- Live network timeout reduced to 8 seconds so dead channels fail promptly instead of appearing to hang.
- VOD/movie playback keeps a larger 10-second cache and 5-second read-ahead for stability and seeking.
- First-run mpv download copy is corrected to roughly 60 MB.
- Windows bridge/bootstrap version and PWA shell cache bumped to v0.2.2.
- Target behavior: single-digit-second channel startup on a healthy provider/network; upstream provider delay can still dominate if the service itself is slow to deliver packets.

## v0.2.1 — Native Player Launch Diagnostics Hotfix — 23 August 2026

- Added `--force-window=immediate` and `--keep-open=yes` so native player failures no longer disappear silently.
- Added `%LOCALAPPDATA%\SwoopTV\mpv-latest.log` and authenticated launch diagnostics.
- Swoop now detects immediate mpv exit and surfaces a redacted log tail/exit code rather than falsely reporting playback success.
- Windows Bridge console now reports channel title and mpv PID or immediate exit code.
- Existing native mpv installation is reused; no Cloudflare Worker/token change required.

## v0.2 — Windows Native Playback Foundation — 23 August 2026

- Added a Windows-native Swoop launch path while preserving the existing hosted web/PWA build.
- Added `START-SWOOP-TV-WINDOWS.cmd` and a loopback-only PowerShell bridge at `127.0.0.1:38673`.
- Windows Xtream API/catalog requests now go through the local bridge instead of browser CORS or the Cloudflare helper.
- Windows M3U URL imports can be fetched through the native bridge, avoiding browser CORS restrictions.
- Added native Live TV and movie playback through mpv using the provider's original HTTP/HTTPS stream URL; raw `.ts` transport streams no longer need to be coerced into browser HLS.
- First run automatically downloads the official mpv 0.41.0 Windows x64 CI ZIP from the pinned mpv-player GitHub release, verifies SHA-256 `4e197f729f5071c6772f35fffd96e0f36e3e8a044bd9479b136bb09b7c6a80ff`, and installs it under `%LOCALAPPDATA%\SwoopTV`.
- Native bridge binds only to loopback and protects provider/playback endpoints with a fresh per-run random session token injected into the locally served Swoop page.
- Native mode hides the Cloudflare Helper fields because the Windows bridge handles Xtream transport directly.
- Added Windows-native playback status/settings presentation and player launch/stop controls.
- Browser/PWA playback safeguards from v0.1.3 remain unchanged when Swoop is opened from Cloudflare Pages/GitHub Pages.
- Added `buildXtreamSeriesStreamUrl()` foundation for the upcoming series episode pass.
- PWA cache bumped to `swoop-tv-v020-shell`.
- Verification: JavaScript syntax checks and v0.2 automated parser/MDBList/Xtream/Worker/series-URL tests pass. PowerShell runtime must be validated on Windows because this build environment is not Windows.

### Current v0.2 boundary

- mpv is a separate native playback window in this foundation build; visually embedded Swoop player chrome is a later Windows shell pass.
- Series episode loading, EPG/TV Guide, real Continue Watching and My List remain tabled for subsequent builds.

## v0.1.3 — Browser Playback Stability Hotfix — 23 August 2026

- Replaced the raw new-tab `<video>` playback proof-of-concept that could hang Chrome on Xtream transport streams.
- Added an in-app full-screen player shell with close/back handling and readable playback errors.
- Xtream Live playback now derives an HLS `.m3u8` candidate instead of feeding `.ts` directly to Chrome.
- Added native HLS support where available and hls.js 1.6.16 for MediaSource-capable browsers.
- HTTPS Swoop refuses HTTP mixed-content video instead of attempting it.
- Large catalog pages are batched (Live 180 initially; Movies/Series 120 initially) with Load More.
- Artwork relay concurrency limited to six requests.
- Removed duplicated `raw` Xtream/M3U payloads from normalized catalog items to reduce memory/storage load.
- PWA shell cache bumped to `swoop-tv-v013-shell`.
- Existing v0.1.2 Connection Helper remains compatible; no Worker/token change is required for this frontend hotfix.

## v0.1.2 — Provider Artwork + Channel Logos

- Live TV channel cards now render the provider's `stream_icon` artwork instead of always showing generated initials.
- Movie and series artwork now uses real image elements with graceful fallback rather than CSS-only remote backgrounds.
- Xtream relative artwork paths are normalized against the provider server.
- The Swoop Connection Helper can now relay small public artwork images (max 4 MB) through authenticated POST requests, fixing common HTTPS-page / HTTP-provider mixed-content failures without proxying video.
- Artwork relay revalidates redirect targets, blocks local/private addresses, and only returns supported image responses.
- Artwork is lazy-loaded and cached in-session to avoid flooding the provider/Worker while browsing large catalogs.
- Shell cache bumped to `swoop-tv-v012-shell`.

## v0.1.2 — Xtream Browser Connection Hotfix — 23 August 2026

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