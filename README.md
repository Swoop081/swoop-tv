# Swoop TV v0.7.1 — Profile Theme Engine

Swoop TV is a content-neutral IPTV player for user-provided, authorised Xtream Codes and M3U sources. v0.7.1 adds profile-linked full-interface themes while preserving the multi-provider unified library, premium discovery, profiles and Windows-native playback from v0.7.0.

## What changed in v0.7.1

Every household profile can now choose its own complete Swoop presentation. A theme changes much more than an accent colour: Home hero layout, navigation treatment, buttons, cards, rails, badges, focus states, detail/Settings surfaces, provider progress presentation and TV Guide styling all respond to the selected theme.

Four launch themes are included:

- **Chill** — black/red, cinematic and minimal.
- **Prime Time** — clean navy/blue modern streaming presentation.
- **Rewind** — bold blue/yellow nostalgic video-store presentation with shelf-like rails and retro marquee details.
- **Vice** — neon pink/cyan/purple, sunset gradients and Miami-night energy.

The themes are original Swoop designs inspired by broad streaming/video-store/neon visual traditions; they do not include third-party logos, artwork or branding.

## Profile-linked appearance

Theme selection lives inside **Edit Profile** and **Customize Home**. Switching profiles immediately switches the full visual theme while keeping the shared provider library connected.

Each profile continues to retain its own Home row order, Smart Home setting and viewing personalisation. The existing Home background colour control is now an **optional override** on top of the selected theme. Turn the override off to return to that theme's intended base colour.

Existing profiles migrate to **Chill** automatically. If an older profile had a custom non-black Home background, Swoop preserves it as a background override when possible.

## Multi-provider and playback

All v0.7.0 multi-provider features remain intact: Provider Manager, unified Movies/TV/Live library, source stacking, provider priority, provider filters, cross-provider EPG, household profiles, Continue Watching and recommendations.

The proven Windows mpv compatibility/buffering profile has not been changed in v0.7.1.

## Windows native launch

1. Extract the ZIP completely.
2. Run `START-SWOOP-TV-WINDOWS.cmd`.
3. Keep the Swoop TV Windows Bridge window open during development builds.
4. Existing mpv installations under `%LOCALAPPDATA%\SwoopTV` are reused.

## Browser/PWA

The static app remains deployable to Cloudflare Pages or GitHub Pages. The Cloudflare Connection + Metadata Worker remains v0.1.6; no Worker update is required from v0.7.0.

## Privacy

Swoop does not supply IPTV content. Stream/catalog data comes from providers configured by the user. Profile themes and profile personalisation are stored locally on the device in this development build.

## Development status

v0.7.1 remains a development build. The next planned milestone remains native packaging: a proper Windows installer/application shell with the local bridge hidden from end users, followed by Android TV / Google TV / Fire TV adaptation.
