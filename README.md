# Swoop TV v0.2.5 — Cinematic Streaming UI

Swoop TV v0.2.5 is a presentation-first overhaul built on the proven v0.2.4 provider flow and v0.2.3 Windows-native playback profile. The goal is a big, bold, premium streaming-service experience: full-bleed featured artwork, oversized typography, stronger content rails, larger poster art, cinematic content landing pages and a consistent Swoop visual identity across Home, Live TV, Movies, TV Shows, Search, Settings and provider setup.

Swoop TV is a content-neutral IPTV player for user-provided sources they are authorised to access.

## UI overhaul

- Full-height cinematic Home hero sourced from the connected provider catalog where artwork is available.
- Oversized featured title, metadata and prominent **Play** action.
- New black-first Swoop visual system with purple/teal identity accents rather than a generic dashboard look.
- Larger Netflix-style horizontal rails with stronger poster emphasis and scale-on-focus behavior for mouse, keyboard and TV remotes.
- Live TV uses large landscape tiles rather than small utility rows.
- Movies and TV Shows receive dedicated cinematic landing heroes plus large poster grids.
- Search gets an oversized streaming-style search surface and visual result grid.
- Settings is redesigned as premium cards with large stats and clearer hierarchy.
- Provider setup and import progress retain the v0.2.4 separation/progress behavior but inherit the darker, bolder visual language.
- Responsive mobile/TV layouts remain supported.

## Functionality retained

- Separate Xtream and M3U setup flows with dedicated PLEASE WAIT import progress.
- Windows local bridge for Xtream/M3U transport.
- Proven v0.2.3 mpv playback profile and v0.2.1 launch diagnostics.
- Provider artwork/channel logos and artwork relay support.
- MDBList custom-row foundation.
- Hosted PWA/browser mode remains available for compatible sources.

## Windows test

1. Close any older Swoop TV window and **Swoop TV Windows Bridge** console.
2. Extract this ZIP to a normal folder.
3. Double-click **`START-SWOOP-TV-WINDOWS.cmd`**.
4. Your existing provider/mpv setup can be reused.
5. Check Home, Live TV, Movies, TV Shows, Search and Provider setup presentation.
6. Confirm the same channel that played in v0.2.4 still launches in mpv.

Useful mpv keys: **F** fullscreen, **Space** pause, **Esc/Q** close, **Up/Down** volume.

## Playback architecture

Windows native playback remains:

`Swoop UI → local loopback bridge → mpv → IPTV provider`

v0.2.5 intentionally does **not** retune mpv startup behavior. UI work is isolated from the known-working playback baseline.

## Current limitations

- mpv still opens in a separate native window rather than being visually embedded in Swoop.
- TV-series episode loading, EPG/TV Guide, real Continue Watching and My List remain for later builds.
- The hero currently uses available provider poster/artwork rather than a separate backdrop metadata service.
- Windows distribution remains a portable CMD/PowerShell foundation rather than a signed installer.

## Legal model

Swoop TV includes no television channels, movies or shows. Users are responsible for supplying sources they are authorised to access.
