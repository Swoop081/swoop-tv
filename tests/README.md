# SwoopTV playback regression checks

Run `node --test tests/playback.test.cjs` before publishing changes to the shared application.

These tests inspect the actual shipped JavaScript source, not a separately reimplemented playback function. They do not make provider requests or expose credentials.

Playback is a protected subsystem: preserve provider stream IDs, original container extensions, Xtream username/password, and the VLC URL handoff. Catalogue metadata must never be used to fabricate provider stream IDs.
