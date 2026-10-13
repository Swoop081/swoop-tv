# SwoopTV Android test builds

Two APK variants share the production SwoopTV GitHub Pages web application:
- `phoneDebug`: Android phone, touchscreen.
- `tvDebug`: Android TV, Leanback launcher and landscape orientation.

The GitHub Actions workflow builds both unsigned-for-distribution (debug-signed) APKs and uploads them as downloadable workflow artifacts. Install them only on your own test devices. These are early WebView test shells; native player integration, TV remote focus handling, offline UI, and Android TV banner/icon assets remain to be implemented. The wrapper loads https://swoop081.github.io/swoop-tv/ and does not embed IPTV credentials or provider URLs.
