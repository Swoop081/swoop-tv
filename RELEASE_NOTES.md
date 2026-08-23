# Swoop TV Release Notes

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
