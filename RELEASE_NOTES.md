# Swoop TV Release Notes

## v0.7.12 — Poster IMDb Rating Overlay

- Removes the release year and generic star-rating metadata line from movie/TV poster cards so the artwork stays clean.
- Adds a compact **gold IMDb rating badge** in the bottom-right corner of movie/TV posters when a trusted IMDb rating is available.
- Resolves the canonical IMDb title ID from TMDb `external_ids`, then fetches the IMDb rating through the existing owner-managed MDBList API integration.
- Never labels TMDb/provider scores as IMDb: if MDBList is not configured, the title has no IMDb ID, or the rating lookup fails, the badge is simply omitted.
- Keeps the full provider/source names in Smart Source Selection and leaves detail/playback/provider behavior unchanged.
- No provider refresh or SQLite rebuild is required.

## v0.7.11 — Expanded Home Rails

- Expands every Home content rail except **Top 20 Movies** and **Top 20 TV Shows** to a maximum of **100 items** when enough matching content is available.
- Top 20 rows remain fixed at exactly **20** items and keep their numbered/ranked treatment.
- Increases native SQLite Home-row queries from 24 to 100 items for provider recents, categories, Live Now, Top Rated and genre/search-driven rows.
- Expands built-in web discovery matching to support up to 100 items for Trending, New & Hot, Popular on Streaming, Most Watched and Box Office rows.
- Recommended For You can now return up to 100 titles, and profile-scoped Continue Watching / Recently Watched / Recent Channels retention is raised to 100 so those rails can grow to the same cap.
- Existing provider data, SQLite catalogue, source stacking, metadata, watched/resume semantics and Windows/mpv playback behavior are unchanged. No provider refresh is required.

## v0.7.10 — Settings Provider Priority

- Moves **TV Providers** to the top of Settings, immediately below the Settings header, so provider status, library counts, **Manage Providers** and **Refresh All** are the first controls available.
- Profile controls now sit directly below TV Providers, followed by Performance.
- No provider, catalogue, discovery, watched/resume, metadata, theme or playback behavior changes. Existing SQLite/provider data is reused and no refresh is required.

## v0.7.9 — Disconnected Demo Artwork Guard

- Fixes misleading artwork appearing on the built-in mock/demo catalogue when no TV provider is connected.
- Demo movie/show names are synthetic UI placeholders and are now excluded from TMDb metadata lookups, preventing title-name collisions from attaching unrelated real posters/backdrops.
- Cached metadata from earlier builds is ignored for demo items, so existing users do not need to clear storage.
- Disconnected demo cards return to intentional Swoop gradient artwork with the demo title/year visible; real provider titles continue to use normal TMDb artwork enrichment.
- No provider, SQLite catalogue, discovery, watched/resume or Windows/mpv playback changes. No provider refresh is required.

## v0.7.8 — Poster Cleanup + Recommendation Trust

- Removes the duplicated movie/TV title-name overlay from poster cards when artwork is available, leaving the poster itself to carry the title treatment.
- Keeps the original full provider/source title untouched inside Smart Source Selection so labels such as `NF - ...`, `EN - ...` and quality/source variants remain available when choosing a stream.
- Stops presenting raw Xtream/provider `rating` values as trustworthy 0–10 star ratings on movie/TV browse cards, Home hero and detail pages. Visible star ratings now come from TMDb metadata and must validate to the 0–10 range.
- Fixes the cold-start **Recommended For You** bug: with no viewing history, the row no longer fills with arbitrary catalogue titles just because they have provider rating values.
- Tightens personalised fallback scoring after viewing starts: non-TMDb fallback recommendations now require actual genre affinity; same media type alone can no longer qualify an unrelated title.
- Existing SQLite catalogue, provider credentials, source stacking, watched/resume data, discovery rows and the proven Windows/mpv playback profile are unchanged. No provider refresh is required.

## v0.7.7 — Home Polish + Watched Controls

- Removes **Because You Watched** completely; **Recommended For You** is the one personalised recommendations row.
- Pins Home ordering to **Continue Watching → Top 20 Movies → Top 20 TV Shows**. Smart ordering only affects rows below those three.
- The three pinned rows are shown as locked priorities in Customize Home and cannot be disabled or moved.
- Adds profile-scoped **Mark as Watched / Mark as Unwatched** on movie/TV detail pages.
- Mark Watched removes the title from Continue Watching; Mark Unwatched resets watched/resume state. Natural playback completion also marks the title watched.
- Adds a subtle **WATCHED** badge to completed movie/show cards.
- Replaces the old abstract profile avatar set with eight playful animals: Lion, Elephant, Monkey, Tiger, Zebra, Giraffe, Rhino and Meerkat; legacy profile avatar IDs migrate automatically.
- Refines Home row spacing, priority-row hierarchy, horizontal scrolling, artwork loading placeholders and avatar presentation while preserving the four profile themes.
- Existing SQLite catalogue, provider credentials, blended discovery, multi-provider logic and the proven Windows/mpv playback profile are unchanged. No provider refresh is required.

## v0.7.6 — Interaction Responsiveness + Detail Playback Hotfix

- Fixes **Play / Resume appearing to do nothing from a full-screen title detail page**. The v0.7.5 detail route was hiding the Smart Source chooser and native-player overlay behind the detail route; both now render above title details.
- Detail thumbnails now navigate **immediately**. SQLite source hydration and Xtream detail loading continue after the dedicated title screen is already visible instead of blocking the click.
- Single-source SQLite titles with an existing playable URL skip an unnecessary source lookup round-trip.
- Play/Resume gives immediate **Opening…** feedback while Swoop resolves a source.
- Detail Play uses the already-resolved detail item directly; if a native item alias is missing from memory, Swoop performs a targeted SQLite get instead of silently doing nothing.
- Background discovery and Home-row priming no longer force a Home rerender while a title detail/player interaction is active.
- The native startup cache is reduced further; Movies/Shows/Live continue to page from SQLite on demand.
- Existing SQLite catalogue, provider credentials, profiles, resume data and the proven mpv compatibility profile are preserved. No provider refresh is required.

# Swoop TV v0.7.6 — Detail Navigation + Render Performance

- Movie and TV thumbnails now open a dedicated full-screen detail screen instead of appending detail content to the bottom of Home/Movies/Shows. Back returns to the prior browse position.
- Detail metadata/episode refreshes preserve the title-screen scroll position.
- Fixes the oversized intrinsic row height that could reserve roughly 1200px for off-screen Home sections and appear as huge blank gaps.
- Reuses one artwork IntersectionObserver per render instead of accumulating observers across repeated Home rerenders.
- In large-library mode, artwork starts closer to the viewport and web artwork relay concurrency is reduced. TMDb cards request smaller poster images while cinematic hero/detail backdrops retain large images.
- Native catalogue pages initially mount 72 movies/shows and 96 live channels, then page with Load More, reducing first-paint DOM/image pressure.
- Lean mode reduces expensive hover scaling/shadows and uses visible shimmer/fallback cards while images decode asynchronously, reducing layout/paint jerk.
- SQLite catalogue, provider profiles, themes, resume data, multi-provider logic, discovery and the proven mpv playback profile are unchanged. Existing native catalogue is reused; no provider refresh is required.

# Swoop TV Release Notes

## v0.7.6 — Native Catalogue Playback Continuity Hotfix

- Fixes SQLite-native catalogue thumbnails/details that could fail to launch playback after migration.
- Native logical catalogue rows now expose all underlying source IDs and cache aliases for those IDs.
- Playback always resolves a concrete provider source from SQLite before launching mpv.
- Legacy Continue Watching/My List IDs created before migration map to the new logical SQLite title identity.
- Resume/history updates deduplicate old source IDs and logical stack IDs, preserving saved position across migration and source stacking.
- Existing SQLite database, provider credentials, themes, discovery and mpv compatibility profile are unchanged.

## v0.7.4.1 — Settings Navigation Access Hotfix

- Fixes the v0.7.4 oversight where the Settings page existed but had no normal navigation entry.
- Adds a persistent Settings gear in the desktop top bar.
- Adds Settings to the mobile bottom navigation and Who’s Watching/profile picker.
- Makes the existing **Native Catalogue Database** status card directly accessible for SQLite verification.
- No database schema/query, provider, profile/theme, discovery, or native playback changes.

## v0.7.4.1 — Native Catalogue Database Foundation

### Native large-library architecture
- Moves the full Windows-native IPTV catalogue out of the browser UI and into a local **SQLite 3.53.4** database under `%LOCALAPPDATA%\SwoopTV`.
- First native launch downloads the official Windows x64 SQLite tools (about 6.25 MiB) and validates the pinned SHA-256 before extraction.
- Creates indexed catalogue tables for provider, kind, group, logical identity, TMDb/IMDb identity, cleaned title/year and source score.
- Adds **FTS5** full-text indexing for fast title/channel/category search.
- Uses WAL mode, NORMAL synchronous mode, memory temp storage and a bounded SQLite cache for responsive local reads.

### Paged / indexed UI queries
- Movies, TV Shows and Live TV use native paged queries rather than keeping the full provider dump in browser memory.
- Adds native category aggregation and FTS5 ranked search.
- Home local/category rows request only the items needed for the row.
- Discovery/MDBList candidate matching runs against indexed SQLite records instead of rescanning the entire raw catalogue in JavaScript.
- My List, Continue Watching, Recent Channels and profile state hydrate only referenced catalogue items.
- Native duplicate/movie/live logical grouping happens in SQL, with source counts retained for source-stack UI.

### Migration / provider refresh
- Existing browser-side v0.7.x catalogues migrate into SQLite once after profile selection with visible progress.
- Provider imports write to SQLite in **2,000-item chunks**.
- Refreshing/removing a provider updates only that provider's database rows.
- After a successful native migration, the large browser catalogue is retired while metadata/discovery caches remain separate.
- Future Windows launches activate SQLite query mode directly and only load small initial windows of Movies, TV Shows and Live TV.

### Settings / compatibility
- Adds **Settings → Native Catalogue Database** status with raw/logical counts, FTS5 status and page-window information.
- v0.7.3 Auto/Recommended large-library visual safeguards remain intact.
- Multi-provider unified library, profiles/themes, dynamic discovery, Smart Sources, premium Live TV, resume/Up Next and EPG remain intact.
- Proven Windows/mpv playback compatibility/buffering profile is unchanged.
- Cloudflare Connection + Metadata Worker remains **v0.1.7**; no Worker update is required.
- PWA shell cache is `swoop-tv-v0741-shell`; Windows bridge/bootstrap reports **v0.7.4.1**.

### Verification
- JavaScript syntax checks pass.
- Full automated test suite passes.
- Added native SQLite/FTS schema, query endpoint, 2,000-item import, browser-catalog retirement and playback-profile regression assertions.
- SQLite Windows tools version/hash pin is validated against the current official 3.53.4 distribution metadata / package verification.
- Final ZIP integrity verified before release.
- Actual Windows PowerShell/SQLite/mpv runtime remains an in-user validation step.

## v0.7.3 — Large Library Performance Pass

- Adds automatic large-library performance mode at 12,000+ enabled catalog items.
- Home eager-renders five rows, then lazy-mounts later rows as they approach the viewport.
- Large-library rows render a smaller initial card set; Top 20 remains a full 20.
- Adds `content-visibility`/containment for off-screen sections.
- Throttles background metadata enrichment and removes repeated whole-Home re-renders from metadata completion.
- Adds cached/debounced unified Search.
- Reduces expensive blur/shadow effects in automatic performance mode while preserving profile theme identity.
- Adds Settings → Performance with Auto / Recommended and Full Cinematic options.
- PWA shell cache is `swoop-tv-v073-shell`.
- Windows bridge/bootstrap reports v0.7.3.
- Playback compatibility profile is unchanged.

## v0.7.2 — Blended Discovery + Startup Stability

### Discovery
- Replaces the single-chart Trending implementation with a **blended Swoop ranking**.
- Adds TMDb daily trending, weekly trending, popular and current-release/airing signals through the owner-managed Swoop metadata service.
- Worker v0.1.7 can optionally use owner secret `MDBLIST_API_KEY` to add MDBList/JustWatch and supported Trakt/IMDb popularity inputs without requiring end-user accounts.
- **Trending Now** weights fast-moving daily, Trakt/streaming and weekly activity rather than mirroring one chart.
- **Top 20** is kept steadier using popular/IMDb/TMDb/streaming inputs.
- Adds selectable **New & Hot Movies**, **New & Hot TV Shows**, **Popular on Streaming — Movies**, **Popular on Streaming — TV**, **Most Watched This Week — Movies**, **Most Watched This Week — TV** and **Box Office Now** rows.
- Fast-moving web rows refresh at roughly 90 minutes; steadier rankings retain longer caching.
- Manual **Refresh discovery now** no longer requires a local MDBList key.
- A local MDBList key is now described only as an optional requirement for custom personal MDBList rows.

### Large-library stability
- Fixes a major profile/startup freeze path. Swoop no longer starts restoring a very large IndexedDB catalog while **Who’s Watching?** is still on screen.
- Library restore begins only after a profile is selected and shows real progress.
- Durable catalog storage is upgraded from one huge IndexedDB value to **2,000-item catalog chunks** with a manifest and separate metadata/discovery records.
- Existing single-record v0.7.1 catalogs migrate through a background Web Worker, with catalog data returned to the UI in smaller chunks.
- Fixes repeated full movie/live duplicate-index rebuilding caused by `activeCatalog()` returning a new filtered array on every call. The active catalog and stack indexes now remain stable until provider/profile context actually changes.
- Metadata and discovery cache writes no longer rewrite the full IPTV catalog on every enrichment/update.

### Infrastructure
- Cloudflare Connection + Metadata Worker upgraded to **v0.1.7**.
- New optional owner secret: `MDBLIST_API_KEY`.
- Worker health response now exposes `discoveryConfigured` and `mdblistConfigured`.
- PWA shell cache is `swoop-tv-v072-shell`.
- Windows bridge/bootstrap reports **v0.7.2**.
- Proven Windows/mpv playback compatibility profile is unchanged.

### Verification
- JavaScript syntax checks pass.
- Full automated test suite passes.
- Added blended discovery Worker source tests.
- Added chunked-storage / background-migration / deferred-profile-restore structural assertions.

## v0.7.1 — Profile Theme Engine

### New
- Added a **profile-linked full Theme Engine**. Theme choice is saved independently for every household profile and changes immediately when profiles switch.
- Added four launch themes: **Chill**, **Prime Time**, **Rewind** and **Vice**.
- Theme selection is available from both **Edit Profile** and **Customize Home**.
- Added theme previews and theme labels to profile management / Who's Watching surfaces.
- Themes now alter Home hero composition, navigation, card/rail geometry, buttons, badges, progress states, focus states, detail/settings surfaces, provider progress screens and TV Guide presentation.
- Existing background colour is now an optional **per-profile override** on top of a theme rather than the only appearance control.
- Added a one-click **Use theme default** action to restore the selected theme's intended background.

### Theme direction
- **Chill** — cinematic black/red presentation.
- **Prime Time** — navy/blue modern streaming presentation with rounded cards and cleaner hierarchy.
- **Rewind** — blue/yellow nostalgic video-store treatment with retro marquee and shelf-style rows.
- **Vice** — neon pink/cyan/purple Miami-night treatment with sunset/glow styling.
- All themes are original Swoop implementations and do not include third-party logos or copied branded artwork.

### Migration / persistence
- Existing profiles default to **Chill**.
- Theme ID, background override state and custom background colour are stored as profile settings.
- Older custom non-black profile backgrounds are preserved as an override where possible.

### Preserved
- v0.7.0 Multi-Provider + Unified Library behavior.
- Per-profile Continue Watching, My List, viewing history, recommendations, Live favourites and Home rows.
- Smart Sources, Premium Live TV, source stacking, EPG, TMDb/MDBList discovery and rotating Home hero.
- Proven Windows/mpv compatibility/buffering profile remains unchanged.

### Infrastructure
- Windows bridge/bootstrap reports **v0.7.1**.
- PWA cache is `swoop-tv-v071-shell`.
- Cloudflare Connection + Metadata Worker remains **v0.1.6**; no Worker update is required.

### Verification
- JavaScript syntax checks pass.
- Existing automated Xtream/M3U/MDBList/TMDb/profile/playback/multi-provider tests pass.
- Added theme catalog, palette and profile-theme persistence assertions.
- Final ZIP integrity is verified before release.

## v0.7.0 — Multi-Provider + Unified Library

### New
- Added a full **Provider Manager**. Swoop can keep multiple Xtream Codes and M3U providers connected at the same time.
- Adding a new provider extends the library instead of replacing the existing catalog.
- Providers can be **enabled/disabled, refreshed, reordered by priority, edited/reconnected, or removed** independently.
- Added **Refresh All Providers** and per-provider health / last-refresh information.
- Added provider-level counts for Live TV, Movies and TV Shows.
- Added **provider filters** on Movies, TV Shows and Live TV so a user can view the combined library or one provider at a time.
- Movie duplicate stacks work across providers and provider priority is used as a tie-breaker after quality/HDR/codec ranking.
- Added conservative **Live TV source stacking** using matching EPG/tvg ID, or exact cleaned channel name + group.
- Xtream EPG, VOD details and series/episode requests use the credentials belonging to the specific provider that owns the selected item.
- TV Guide can combine EPG data from multiple enabled Xtream/XMLTV providers.
- Provider credentials are stored as multiple durable provider profiles.

### Preserved
- Profiles and per-profile Continue Watching, My List, viewing history, recommendations, Live favourites, Home rows and appearance.
- Smart movie source selection and automatic immediate-failure fallback.
- Premium Live TV controls, in-process Windows channel switching and native mpv playback.
- TMDb/MDBList discovery, Top 20/Trending rows, rotating Top 5 hero, title detail pages, episode browsing and Up Next.
