# Swoop TV v0.2.6 — Streaming Library Experience

Swoop TV v0.2.6 builds a fuller premium streaming-service experience on top of the proven v0.2.5 cinematic UI and the known-working v0.2.3 Windows/mpv playback profile. This pass focuses on the library experience around playback: rich title details, saved titles, Continue Watching, series episode browsing and a real programme guide shell.

Swoop TV is a content-neutral IPTV player for user-provided sources they are authorised to access.

## New in v0.2.6

- **Full-screen movie and series detail pages** with large backdrop presentation, oversized title treatment, metadata, synopsis, Play and My List actions.
- **Provider backdrops and richer title metadata** are used where Xtream supplies them. Movie detail pages can fetch `get_vod_info` on demand; series pages fetch `get_series_info`.
- **Series seasons and episodes** now load on demand from Xtream. Season selectors, episode artwork/descriptions and native episode playback are implemented.
- **My List** is now functional and persistent on the device, with a dedicated My List screen and Home rail.
- **Continue Watching** is now driven by titles/episodes actually launched by the user instead of the old fake demo progress row. Exact playback-position synchronisation is not yet available because mpv still runs as a separate process.
- **TV Guide** gets its own premium screen with channel rail, rolling three-hour timeline, current-program highlighting and playable programme/channel cells.
- Xtream guide data loads progressively through `get_short_epg`; M3U providers with an XMLTV URL can load matching programme listings on demand.
- **Hover/focus treatment** is expanded for desktop and TV-navigation use, with clearer More Info / Play affordances.
- Category chips and genre tiles now jump into Search rather than being decorative only.
- Home now prioritises Continue Watching and My List when they contain real user activity.

## Playback remains on the proven profile

Windows native playback remains:

`Swoop UI → local loopback bridge → mpv → IPTV provider`

The v0.2.6 UI/data work does **not** retune the mpv playback flags. It keeps the exact compatibility profile restored in v0.2.3.

## Windows test

1. Close any older Swoop TV window and the **Swoop TV Windows Bridge** console.
2. Extract this ZIP to a normal folder.
3. Double-click **`START-SWOOP-TV-WINDOWS.cmd`**.
4. Reuse your existing provider and mpv installation.
5. Open a Movie and check the new detail screen and My List control.
6. Open a TV Show and wait for seasons/episodes to load, then launch an episode.
7. Open **Guide** and allow programme information to populate progressively.
8. Confirm a previously working live channel still launches in mpv.

Useful mpv keys: **F** fullscreen, **Space** pause, **Esc/Q** close, **Up/Down** volume.

## Web / Cloudflare helper note

Windows native mode does not require a Worker update for the new movie/series detail calls. If you also use the hosted browser version through the Swoop Connection Helper, deploy the included **v0.1.3 Worker** so `get_vod_info` is permitted. The existing token can be reused.

## Current limitations

- mpv still opens as a separate native playback window rather than being visually embedded inside Swoop.
- Continue Watching records real launches/recent titles, but exact elapsed-time progress bars are not yet synchronised back from mpv.
- Xtream EPG quality depends on what the provider returns. Very large M3U XMLTV files can still take time to parse the first time Guide is opened.
- Rich artwork is provider-dependent; when no backdrop is supplied, Swoop falls back to the best available cover artwork and its cinematic gradient treatment.
- Windows distribution remains a portable CMD/PowerShell foundation rather than a signed installer.

## Legal model

Swoop TV includes no television channels, movies or shows. Users are responsible for supplying sources they are authorised to access.
