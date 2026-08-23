# Swoop TV v0.7.4.1 — Native Catalogue Navigation Hotfix

Swoop TV is a content-neutral IPTV player for user-provided, authorised Xtream Codes and M3U sources. v0.7.4.1 is the Windows large-library architecture upgrade: the full IPTV catalogue moves out of the browser UI and into a local SQLite database.

## v0.7.4.1 navigation hotfix

- Adds a permanent **Settings** gear to the desktop top bar.
- Adds **Settings** to the mobile bottom navigation.
- Adds a **Settings** button to the Who’s Watching/profile picker.
- The existing **Native Catalogue Database** status card is now reachable normally under Settings.
- No SQLite, provider, profile, discovery, or mpv playback behavior is otherwise changed.


## Why this build exists

Very large providers can expose 40,000–60,000+ channels, movies and shows. Previous Swoop builds progressively reduced browser work, but the web UI still had to restore and manipulate a large catalogue. v0.7.4.1 changes that model on Windows.

The Windows-native path is now:

`Xtream / M3U → Swoop local bridge → SQLite + FTS5 → small paged query results → Swoop UI`

The browser no longer needs the complete provider dump in memory after the one-time migration.

## Native catalogue database

- Uses a local **SQLite 3.53.4** database stored under `%LOCALAPPDATA%\SwoopTV\swoop-catalog-v1.sqlite3`.
- Downloads the official Windows x64 SQLite tools on first v0.7.4.1 native launch and verifies the pinned SHA-256 before extraction.
- Uses SQLite **FTS5** for indexed title/channel/category search.
- Stores raw provider sources separately while grouping confident logical movie/channel/show identities at query time.
- Supports multiple connected Xtream/M3U providers in the same database.
- Provider refreshes replace only that provider's database rows rather than rebuilding unrelated providers.

## UI query model

- Movies, TV Shows and Live TV use paged native queries instead of loading the whole catalogue.
- Default page window is 120 items; Load More increases the window as needed.
- Search queries SQLite FTS5 and returns only a small ranked result set.
- Category lists are aggregated in SQL rather than rebuilt from the raw catalogue in JavaScript.
- Home rows query only the content needed for that row.
- Top 20 / Trending / MDBList discovery candidates are matched against the local database instead of scanning the whole provider catalogue in the browser.
- My List, Continue Watching, Recent Channels and profile state hydrate only their referenced items.

## One-time migration

If you already have a saved Swoop library, after choosing a profile v0.7.4.1 shows a migration/progress screen while it indexes the existing catalogue into SQLite. This is a one-time operation.

After the native database is confirmed ready, Swoop retires the large browser-side catalogue copy. Future launches query SQLite directly and restore only the small pieces needed for the current screen.

## New/updated Settings information

**Settings → Native Catalogue Database** shows whether SQLite query mode is active, raw provider item count, logical item count, FTS5 search and the normal page window.

The existing **Auto / Recommended** performance mode remains available and still reduces expensive visual work on very large libraries.

## Windows first run

1. Close any older Swoop app window and the black Windows Bridge window.
2. Extract this ZIP completely.
3. Run `START-SWOOP-TV-WINDOWS.cmd`.
4. Keep the black **Swoop TV Windows Bridge** window open.
5. On the first v0.7.4.1 launch, Swoop downloads the official SQLite Windows x64 tools (about 6.25 MiB) and verifies the archive before installation.
6. Choose your profile.
7. If an older browser catalogue exists, allow the one-time **Optimizing your library into Swoop's local SQLite catalogue** step to complete.
8. Open **Settings** and confirm **SQLite query mode is active**.

The existing mpv installation is reused. The proven IPTV playback compatibility/buffering profile is unchanged.

## Important scope

- The SQLite catalogue path is currently **Windows-native only**.
- Hosted/PWA Swoop retains the browser/IndexedDB catalogue architecture and v0.7.3 performance safeguards.
- The Windows build still uses the local PowerShell bridge and separate mpv playback window; a signed packaged Windows app remains a later milestone.
- SQLite stores provider catalogue metadata and stream addresses locally on the device. Treat `%LOCALAPPDATA%\SwoopTV` as private user data.

## Cloudflare

No Cloudflare Worker update is required from v0.7.2/v0.7.3 if your Connection + Metadata Worker is already v0.1.7.

## Verification

- JavaScript syntax checks pass.
- Existing Xtream/M3U/MDBList/TMDb/profile/theme/multi-provider tests pass.
- Native-catalogue tests cover prepared logical identities, SQLite/FTS schema, paged query/search/category/match endpoints, database-level duplicate grouping, 2,000-item native import chunks, browser-catalogue retirement and unchanged mpv playback-profile guards.
- Final ZIP integrity is verified before release.
- The actual SQLite/PowerShell runtime must still be validated on a real Windows machine; this Linux build environment cannot execute Windows PowerShell or mpv.
