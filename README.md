# Swoop TV

**Current build: v0.7.21 — Cast Library Browsing**

Cast portraits on movie and TV detail pages are now interactive. Selecting a cast member opens a dedicated Swoop TV filmography page that checks that person's TMDb movie/TV credits against the titles actually available from the user's enabled TV providers, then shows only confident local matches.

The cast route preserves the title-detail screen underneath it, and opening a movie/show from the cast page preserves the cast page as well, so Back works as a proper navigation stack: **title → cast member → another title → cast member → original title**. The bundled Cloudflare Worker advances to **v0.1.12** for person-credit lookup. Redeploy the Worker to enable the new cast browsing service.


## Visible progress for long-running work

- **Provider refresh:** each provider card shows a live percentage, moving bar and current stage such as login verification, provider download, SQLite indexing or saving.
- **Refresh All:** a persistent bottom progress HUD shows the current provider, overall percentage, elapsed time and a clear reassurance that Swoop TV is still running.
- **Provider connection:** the existing step-by-step connection screen now includes a large numeric percentage beside its progress bar.
- **Large-library startup/restore:** the restore screen now shows a numeric percentage as well as item counts.
- **TV Guide:** guide loading shows a channel-by-channel percentage and progress bar while rows continue filling in.
- **SQLite browse/search and series episodes:** unknown-duration waits use animated activity bars plus plain-language “still working” text rather than a spinner alone.
- Active progress bars include a moving highlight so a percentage that pauses during a slow provider response still visibly looks alive.

## Provider recently added rails

- **New & Recent Movies** is renamed **Recently Added Movies** and sorts by the provider's own addition timestamp instead of movie release year.
- **New & Recent TV Shows** is renamed **Recently Added TV Shows** and sorts by the provider's own `added` / `last_modified` timestamp instead of first-air year.
- Xtream imports now retain these provider timestamps on catalogue items. For already-indexed libraries, Swoop TV falls back to numeric provider stream/series sequence so the rails improve immediately; running **Refresh All** once captures the provider timestamps for exact ordering.
- Native Windows/SQLite queries use a dedicated `provider-added` sort and take the newest timestamp across duplicate movie sources without rebuilding the database schema.
- This changes only these two Home rails. **All Movies**, **All TV Shows**, web Trending/New & Hot rows, Top 100 ranked rows, source stacking, metadata, watched/resume state and mpv playback are unchanged.

## Strict title-year metadata matching

- Year-qualified TMDb searches are now strict: if the requested provider year has no valid match, Swoop TV leaves the provider artwork/identity alone instead of retrying the title without a year.
- Search results must match the cleaned normalized provider title and the exact release/first-air year before artwork or metadata is accepted.
- Existing TMDb/IMDb IDs are checked against the provider year before they are trusted, protecting against stale IDs left behind by an earlier incorrect enrichment.
- The browser client performs its own identity check before accepting metadata or IMDb rating results, so an older/misconfigured Worker cannot silently attach a different-year movie.
- The lightweight IMDb rating route now returns its resolved title/year alongside the IDs/rating, allowing the client to verify the same identity before rendering the gold badge.
- Metadata cache schema advances once on upgrade to discard ambiguous pre-v0.7.15 matches. Provider credentials, SQLite catalogue, watched/resume data and playback state are untouched.
- Cloudflare Worker v0.1.10 contains the strict resolver and should be redeployed for full server-side protection.

## Detail navigation + interaction stability

- Detail pages use cleaned presentation titles immediately, so provider prefixes such as `EN -`, `NF -` and `AMZ -` stay in Smart Source Selection but do not flash as the large on-screen title.
- The text title and TMDb title-logo share one stable title slot. The text remains visible until the logo image has actually loaded, then crossfades away instead of disappearing into a blank gap.
- Metadata, native source hydration and Xtream detail results patch the existing detail route in place. Background requests no longer replace the Play, My List, Watched or Back controls underneath an in-progress click.
- Back restores the exact detached browse DOM and scroll position rather than recreating Home from skeleton rows. Already-loaded posters remain loaded and the screen no longer jumps through blank/lazy states.
- Native Home-row priming and web-discovery refreshes patch only mounted rows. They no longer trigger whole-Home rebuilds that could cause visible bouncing while browsing.
- Metadata lookup requests now strip common provider/source prefixes before TMDb matching, improving canonical title/logo resolution without changing the raw source labels used for playback selection.
- Adds immediate press feedback to buttons/cards and keeps the existing proven Windows/mpv playback profile unchanged.


## Viewport IMDb rating hydration

- Movie/TV poster cards register with a dedicated IntersectionObserver and request their IMDb rating only when they are on-screen or close to entering the viewport.
- Auto/large-library mode limits rating work to two concurrent requests; Full Cinematic mode allows four.
- Ratings are cached for 30 days, while valid v0.7.12 IMDb scores are preserved and stale blank-rating state is retried once.
- The card's gold badge is inserted directly after enrichment, avoiding a whole-page re-render or a provider refresh.
- Worker v0.1.9 provides a lightweight `imdb-rating` route that resolves the IMDb ID through TMDb and fetches the score from MDBList without loading cast, trailers or recommendations.

## Poster IMDb rating overlay

- Movie and TV poster cards no longer show release year or a generic star score over the artwork.
- When metadata resolves an IMDb title ID and the Swoop TV Worker has `MDBLIST_API_KEY`, Swoop TV requests the IMDb rating through MDBList and renders **IMDb x.x** in a compact gold badge at the bottom-right of the poster.
- Swoop TV never relabels a TMDb/provider rating as IMDb. If the IMDb rating is missing, unavailable or the MDBList key is not configured, no badge is shown.
- IMDb IDs are taken from TMDb `external_ids`, avoiding fuzzy title matching for the rating request.
- Existing cached provider/library data is reused; no provider refresh is required.

## Expanded Home rails

- Every Home content rail, including the two ranked discovery rows, can now expose up to **100 items** when that many matching titles are available.
- This includes New & Recent, Trending, New & Hot, streaming/weekly charts, provider categories, Live Now, My List, Continue Watching, Recently Watched, Recent Channels, Recommended For You and custom MDBList rows.
- **Top 100 Movies** and **Top 100 TV Shows** are capped at **100** and retain the numbered/ranked presentation.
- Native SQLite Home queries and web-discovery matching now request enough results to support the larger rails. Artwork remains viewport-lazy and lower Home rows remain lazy-mounted for large libraries.


## Settings provider priority

- **TV Providers** is now the first card in Settings, directly below the Settings header.
- Profile controls now follow TV Providers, with Performance immediately after the profile card.
- Provider counts, Manage Providers, Refresh All and all provider behavior are unchanged; this is a navigation/hierarchy improvement only.

## Disconnected demo artwork

- Swoop TV's built-in demo movie/show names are fictional UI placeholders and are now **blocked from TMDb metadata/artwork matching**.
- This prevents synthetic names such as `Northbound`, `The Long Way Home` or `The Last Horizon` from accidentally picking up posters/backdrops belonging to unrelated real titles with the same name.
- Any stale demo metadata already cached by an older build is ignored immediately, so upgrading does not require clearing storage.
- While no provider is connected, demo movie/show cards use Swoop TV's intentional gradient placeholders with their demo title/year rather than misleading third-party artwork or ratings.

## Poster cards, ratings and recommendations

- Movie and TV **poster cards no longer repeat the title name over the artwork** when poster art is available. Provider/source names remain untouched in Smart Source Selection.
- Browse-card and hero star ratings now display only **TMDb metadata ratings on a validated 0–10 scale**. Raw Xtream/provider rating values such as `55.0` are no longer shown as 10-point ratings.
- **Recommended For You stays empty until the active profile has viewing history** instead of filling itself from provider ratings. Once history exists, recommendations require TMDb direct recommendations or real genre affinity rather than a same-media-type fallback.
- No provider refresh or SQLite rebuild is required.


## Home priorities

- **Continue Watching** is pinned as the first Home row when it has items.
- **Top 100 Movies** is pinned immediately after Continue Watching.
- **Top 100 TV Shows** is pinned immediately after Top 100 Movies.
- Smart Home ordering only reorders rows below those three.
- **Because You Watched** has been removed completely; **Recommended For You** is now the single personalised recommendation row.

## Watched controls

- Movie and TV detail pages now include **Mark as Watched / Mark as Unwatched**.
- Marking a title watched removes it from Continue Watching and records it as completed for that profile.
- Marking it unwatched clears the watched state and resets any resume entry for the title.
- Watched titles receive a subtle **WATCHED** badge on cards.
- Titles that naturally reach completion in mpv are also marked watched.

## Profile avatars

Profiles now use eight playful animal choices: **Lion, Elephant, Monkey, Tiger, Zebra, Giraffe, Rhino and Meerkat**. Existing abstract avatar IDs migrate automatically to an animal equivalent.

## Home presentation polish

- Stronger hierarchy and spacing for the three priority rows.
- More consistent poster/landscape sizing and smoother horizontal rails.
- Visible card shimmer/fallback treatment while artwork loads, without reserving giant empty gaps.
- Theme-specific Home presentation remains intact, with animal profiles and watched badges styled consistently across themes.

## Upgrade

Close Swoop TV and the black Windows Bridge window, extract this build and run `START-SWOOP-TV-WINDOWS.cmd`. Your existing SQLite catalogue, provider credentials, profiles and resume data are reused.

---

# Swoop TV v0.7.4.1 — Native Catalogue Navigation Hotfix

Swoop TV is a content-neutral IPTV player for user-provided, authorised Xtream Codes and M3U sources. v0.7.4.1 is the Windows large-library architecture upgrade: the full IPTV catalogue moves out of the browser UI and into a local SQLite database.

## v0.7.4.1 navigation hotfix

- Adds a permanent **Settings** gear to the desktop top bar.
- Adds **Settings** to the mobile bottom navigation.
- Adds a **Settings** button to the Who’s Watching/profile picker.
- The existing **Native Catalogue Database** status card is now reachable normally under Settings.
- No SQLite, provider, profile, discovery, or mpv playback behavior is otherwise changed.


## Why this build exists

Very large providers can expose 40,000–60,000+ channels, movies and shows. Previous Swoop TV builds progressively reduced browser work, but the web UI still had to restore and manipulate a large catalogue. v0.7.4.1 changes that model on Windows.

The Windows-native path is now:

`Xtream / M3U → Swoop TV local bridge → SQLite + FTS5 → small paged query results → Swoop TV UI`

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
- Top 100 / Trending / MDBList discovery candidates are matched against the local database instead of scanning the whole provider catalogue in the browser.
- My List, Continue Watching, Recent Channels and profile state hydrate only their referenced items.

## One-time migration

If you already have a saved Swoop TV library, after choosing a profile v0.7.4.1 shows a migration/progress screen while it indexes the existing catalogue into SQLite. This is a one-time operation.

After the native database is confirmed ready, Swoop TV retires the large browser-side catalogue copy. Future launches query SQLite directly and restore only the small pieces needed for the current screen.

## New/updated Settings information

**Settings → Native Catalogue Database** shows whether SQLite query mode is active, raw provider item count, logical item count, FTS5 search and the normal page window.

The existing **Auto / Recommended** performance mode remains available and still reduces expensive visual work on very large libraries.

## Windows first run

1. Close any older Swoop TV app window and the black Windows Bridge window.
2. Extract this ZIP completely.
3. Run `START-SWOOP-TV-WINDOWS.cmd`.
4. Keep the black **Swoop TV Windows Bridge** window open.
5. On the first v0.7.4.1 launch, Swoop TV downloads the official SQLite Windows x64 tools (about 6.25 MiB) and verifies the archive before installation.
6. Choose your profile.
7. If an older browser catalogue exists, allow the one-time **Optimizing your library into Swoop TV's local SQLite catalogue** step to complete.
8. Open **Settings** and confirm **SQLite query mode is active**.

The existing mpv installation is reused. The proven IPTV playback compatibility/buffering profile is unchanged.

## Important scope

- The SQLite catalogue path is currently **Windows-native only**.
- Hosted/PWA Swoop TV retains the browser/IndexedDB catalogue architecture and v0.7.3 performance safeguards.
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
