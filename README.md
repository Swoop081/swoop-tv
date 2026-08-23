# Swoop TV v0.2.8 — Cinematic Metadata + Home Appearance

Swoop TV v0.2.8 improves Home discovery matching and adds a proper cinematic artwork layer. Provider artwork remains the immediate fallback, while TMDb can supply true movie/TV backdrops and posters through the owner-managed Swoop Cloudflare service. End users do not need their own TMDb account or key.

## Major changes

- **Cinematic Home artwork:** Home hero now prefers a full-width backdrop. If no backdrop exists yet, the provider poster is expanded into a cinematic background rather than leaving a black hero.
- **TMDb metadata/artwork:** the bundled Cloudflare Worker can retrieve TMDb poster/backdrop metadata using one owner-managed `TMDB_API_TOKEN` secret. The app automatically uses this service; there is no end-user TMDb field.
- **Background colour picker:** Customize Home now includes a live Home preview, colour picker, hex field and Cinema Black / Charcoal / Midnight presets. The selected background is persisted locally.
- **Better Top 20 matching:** provider titles are cleaned before matching (for example `TOP -`, `EN -`, `4K -`, release years and quality tags), with fuzzy title fallback and media-type filtering. Top 20 also falls back to the current streaming chart when the primary popularity source does not produce 20 playable matches.
- **More selectable rows:** adds Romance, Adventure, Fantasy, Mystery, Western, War, Music/Musical, Action & Adventure TV, Sci-Fi & Fantasy TV, Mystery TV, Thriller TV, Animation TV and Family/Kids TV. Provider-supplied Movie and TV category groups remain available automatically.
- **Discovery cache migration:** v0.2.7 web-row matches are invalidated once so the improved matching runs immediately after upgrade.
- **Playback unchanged:** the proven v0.2.3/v0.2.1 Windows mpv compatibility profile remains untouched.

## One-time owner setup for TMDb artwork

1. Create/sign in to a TMDb account and obtain an API Read Access Token from TMDb account settings.
2. In Cloudflare open the existing `swoop-tv-connection` Worker.
3. Replace its code with `cloudflare-worker/worker.js` from this package and deploy it.
4. Open **Settings → Variables and Secrets** for that Worker.
5. Add a new **Secret** named exactly `TMDB_API_TOKEN` and paste the TMDb Read Access Token as its value.
6. Save/deploy the Worker.
7. Visit the Worker URL. Its health JSON should report `version: "0.1.4"` and `metadataConfigured: true`.

The existing `SWOOP_PROXY_TOKEN` stays in place. Do not replace it.

TMDb attribution is required by TMDb for applications using its API/data. Swoop includes the required attribution notice in Third Party Notices; a production About/Credits surface should include the approved TMDb logo before public release.

## Windows use

Close any older Swoop app and Windows Bridge window, extract this package and run:

`START-SWOOP-TV-WINDOWS.cmd`

The existing mpv installation is reused.

## Notes

- TMDb artwork enrichment is intentionally gradual so Home does not issue a huge burst of metadata requests after importing a large IPTV library.
- Metadata is cached locally for seven days and the Worker/CDN response is cacheable.
- Top 20 can only show titles that can be matched to something the connected provider actually contains. v0.2.8 substantially broadens that matching without inventing titles the provider cannot play.
- Swoop TV does not provide or bundle IPTV content. Users must use sources they are authorized to access.
