# Swoop TV v0.2.3 — Playback Recovery Hotfix

Swoop TV is a content-neutral IPTV player for user-provided sources they are authorised to access. v0.2.3 restores the **proven Windows-native playback profile from v0.2.1** after the aggressive v0.2.2 fast-start experiment prevented some previously working Xtream Live TV streams from playing.

## What changed

- Reverted the Windows Live TV mpv launch arguments to the exact v0.2.1 profile that successfully played the user's real Xtream stream.
- Removed the v0.2.2 forced `low-latency`, reduced probe, forced MPEG-TS demuxer, 2-second cache and 8-second network-timeout changes from the default path.
- Keeps the v0.2.1 native launch diagnostics: `--force-window=immediate`, `--keep-open=yes`, `%LOCALAPPDATA%\SwoopTV\mpv-latest.log`, exit-code reporting and redacted log tails.
- Keeps native provider-to-device playback through mpv, including HTTP Xtream streams and raw `.ts`.
- Keeps the loopback-only bridge and existing installed mpv 0.41.0; no new mpv download is required.
- PWA/local shell cache bumped to `swoop-tv-v023-shell`.

## Windows test

1. Close every old Swoop TV window and the old **Swoop TV Windows Bridge** console.
2. Extract this ZIP to a normal folder.
3. Double-click **`START-SWOOP-TV-WINDOWS.cmd`**.
4. Reconnect the same Xtream provider if required.
5. Play the same Live TV channel that worked in v0.2.1.
6. Confirm reliable playback first. Do not judge startup optimization from v0.2.3 yet; this release is the recovery baseline.

Useful mpv keys: **F** fullscreen, **Space** pause, **Esc/Q** close, **Up/Down** volume.

## Startup-speed plan

The v0.2.2 experiment changed several demuxer/cache/probe options simultaneously, so it was impossible to know which one caused the compatibility failure. Starting from v0.2.3, startup optimization should be introduced one lever at a time against a known-working stream. The goal remains single-digit-second Live TV startup, but playback reliability is now the hard gate for every tuning change.

## Architecture

Windows native playback remains:

`Swoop UI → local loopback bridge → mpv → IPTV provider`

The actual video stays provider-to-device and is not proxied through Cloudflare. The hosted browser/PWA path remains available for browser-compatible sources.

## Current limitations

- mpv opens in a separate native window rather than being visually embedded in Swoop.
- TV-series episode loading, EPG/TV Guide, real Continue Watching and My List remain for later builds.
- Windows distribution is still a portable CMD/PowerShell foundation rather than a signed installer.

## Legal model

Swoop TV includes no television channels, movies or shows. Users are responsible for supplying sources they are authorised to access.
