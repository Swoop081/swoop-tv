# Third-Party Notices

## mpv

Swoop TV v0.7.1 does not bundle an mpv binary inside this source ZIP. On first Windows-native launch, the bootstrap downloads the pinned Windows x64 CI package for **mpv 0.41.0** from the official `mpv-player/mpv` GitHub release and verifies its SHA-256 hash before extraction.

mpv is a separate open-source project. Its licensing and source information are available from the mpv project and within its release materials. Swoop TV does not claim ownership of mpv, FFmpeg, libplacebo or their dependencies.

Source/project: `https://mpv.io/` and `https://github.com/mpv-player/mpv`

## TMDb

Swoop TV can use The Movie Database (TMDb) API for movie and TV metadata, poster images and backdrop images.

**Required attribution notice:** “This product uses the TMDB API but is not endorsed or certified by TMDB.”

TMDb requires its approved logo and attribution to appear in an About/Credits-style surface for applications using its API. A production/public Swoop release should add the approved TMDb logo before distribution.

TMDb: `https://www.themoviedb.org/`

## YouTube trailers

When TMDb supplies an official YouTube trailer key, Swoop can display that trailer using YouTube's standard embedded player. Swoop does not download or redistribute trailer video files.
