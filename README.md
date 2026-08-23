# Swoop TV v0.2.7 — Dynamic Discovery + Customizable Home

Swoop TV v0.2.7 adds a live discovery layer on top of the connected IPTV catalog. Home is no longer a fixed set of rails: users can choose which rows appear, change their order, and opt into web-fed Top 20 / Trending rows that refresh automatically.

Swoop TV remains a content-neutral IPTV player. It does not bundle channels, movies or TV shows; web discovery is matched against titles already available from the user's authorised provider.

## New in v0.2.7

- **Top 20 Movies** and **Top 20 TV Shows** are first-class selectable Home rows.
- **Trending Movies** and **Trending TV Shows** are selectable web-fed rows using MDBList/JustWatch discovery data.
- Web discovery is matched against the connected Xtream/M3U catalog, so rows only surface titles Swoop can actually open from that provider.
- Web rows are cached and refresh automatically every **4 hours**, with a manual **Refresh now** control.
- **Customize Home** is available directly from Home and Settings.
- Every Home row can be enabled/disabled and reordered with simple Up/Down controls.
- Large built-in row library includes Continue Watching, My List, Live Now, New & Recent Movies/Shows, Top Rated Movies/Shows, Action, Comedy, Drama, Horror, Thriller, Sci-Fi/Fantasy, Family, Animation, Crime TV, Reality TV, Documentaries and more.
- Swoop also discovers the provider's largest Movie and TV category groups and exposes them as optional Home rows.
- Category rows use a deterministic daily shuffle so the same category does not present the exact same titles in the same order every day.
- **Custom MDBList rows now auto-refresh** instead of remaining a one-time snapshot. New custom rows are automatically enabled on Home and can then be reordered/disabled like any other row.
- Ranked Top 20 rows use oversized streaming-style number treatment.
- Windows-native Swoop fetches MDBList JSON through the loopback bridge, avoiding browser CORS limitations.
- The known-working Windows/mpv playback profile remains unchanged.

## MDBList setup for development

Open **Home → Customize Home** (or **Settings → Home & Web Discovery**) and paste an MDBList API key once. Choose **Save & Refresh**.

The current MDBList free plan documents **1,000 API requests/day**. Swoop's 4-hour cache means the four built-in web rows normally require only a small number of requests per day, plus any custom MDBList rows you enable.

The development build stores the MDBList key locally on this device. A public Swoop release should move this to a Swoop-managed server-side discovery service so ordinary end users do not need their own key.

## Built-in web rows

- **Top 20 Movies** — the 20 highest-ranked titles Swoop can play from the current MDBList Popular Movies ranking.
- **Top 20 TV Shows** — the 20 highest-ranked titles Swoop can play from the current MDBList Popular Shows ranking.
- **Trending Movies** — current JustWatch movie streaming chart through MDBList, matched to the provider library.
- **Trending TV Shows** — current JustWatch show streaming chart through MDBList, matched to the provider library.

If an external ranking contains a title that is not available from the connected IPTV provider, Swoop simply omits that title from the playable row.

## Windows test

1. Close any older Swoop TV window and the **Swoop TV Windows Bridge** console.
2. Extract the ZIP to a normal folder.
3. Double-click **`START-SWOOP-TV-WINDOWS.cmd`**.
4. Reconnect your provider if required.
5. On Home, choose **Customize Home**.
6. Enter your MDBList API key and choose **Save & Refresh**.
7. Confirm **Top 20 Movies**, **Top 20 TV Shows**, **Trending Movies** and **Trending TV Shows** populate with titles available in your IPTV catalog.
8. Toggle several genre/provider-category rows and use ↑ / ↓ to change their Home order.
9. Close and reopen Swoop and confirm the chosen layout persists.
10. Confirm a previously working live channel/movie still launches in mpv.

Useful mpv keys: **F** fullscreen, **Space** pause, **Esc/Q** close, **Up/Down** volume.

## Current limitations

- Web discovery currently needs an MDBList API key stored locally in the development build.
- A web trend can only appear as a playable Swoop card when it can be matched to the provider catalog by TMDb ID, IMDb ID, or title/year.
- Some Xtream providers expose sparse IDs/metadata; those catalogs may match fewer web-ranked titles until Swoop adds a stronger metadata reconciliation layer.
- mpv still opens as a separate native playback window.
- Continue Watching still tracks launches rather than exact mpv elapsed position.

## Legal model

Swoop TV includes no television channels, movies or shows. Users are responsible for supplying sources they are authorised to access.
