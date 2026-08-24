# Third-Party Notices

## SQLite

Swoop TV v0.7.4 does not bundle SQLite binaries inside this source ZIP. On first Windows-native v0.7.4 launch, the bootstrap downloads the pinned official Windows x64 SQLite tools package for **SQLite 3.53.4** and verifies its SHA-256 before extraction.

SQLite is in the public domain. Swoop TV does not claim ownership of SQLite.

Project/download information: `https://www.sqlite.org/`

## mpv

Swoop TV v0.7.4 does not bundle an mpv binary inside this source ZIP. On first Windows-native launch, the bootstrap downloads the pinned Windows x64 package for **mpv 0.41.0** from the official `mpv-player/mpv` GitHub release and verifies its SHA-256 hash before extraction.

mpv is a separate open-source project. Its licensing and source information are available from the mpv project and within its release materials. Swoop TV does not claim ownership of mpv, FFmpeg, libplacebo or their dependencies.

Source/project: `https://mpv.io/` and `https://github.com/mpv-player/mpv`

## TMDb

Swoop TV can use The Movie Database (TMDb) API for movie and TV metadata, poster images and backdrop images.

**Required attribution notice:** “This product uses the TMDB API but is not endorsed or certified by TMDB.”

TMDb requires its approved logo and attribution to appear in an About/Credits-style surface for applications using its API. A production/public Swoop TV release should add the approved TMDb logo before distribution.

TMDb: `https://www.themoviedb.org/`

## YouTube trailers

When TMDb supplies an official YouTube trailer key, Swoop TV can display that trailer using YouTube's standard embedded player. Swoop TV does not download or redistribute trailer video files.

## MDBList discovery + rating enrichment

Swoop TV can optionally use an owner-managed MDBList API key through the Swoop TV Cloudflare Worker to enrich built-in discovery rankings with streaming/popularity list signals and to retrieve an IMDb rating for a title after TMDb has resolved its canonical IMDb ID. End-user IPTV credentials are not sent to MDBList.

MDBList: `https://mdblist.com/`
