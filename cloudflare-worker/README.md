# Swoop TV — Xtream Connection Helper

This tiny Cloudflare Worker fixes the common browser `Failed to fetch` problem caused by Xtream providers that do not send CORS headers or only expose an HTTP API.

It proxies **Xtream metadata/API JSON only**. It does **not** proxy live TV, movie or episode video streams.

## Why it is needed

Native IPTV apps are not subject to browser CORS rules. A valid Xtream account can therefore work in another IPTV app while `player_api.php` is blocked in Chrome/Safari/Edge. The Worker makes that API request server-side and returns the JSON to Swoop TV with browser-safe CORS headers.

## Free deployment with Wrangler

1. Have a free Cloudflare account.
2. Open a terminal in this `cloudflare-worker` folder.
3. Run `npx wrangler login`.
4. Create a long private token, then run:

   `npx wrangler secret put SWOOP_PROXY_TOKEN`

   Paste the private token when prompted. Use at least 16 characters; 32+ random characters is recommended.
5. Deploy with:

   `npx wrangler deploy`

6. Wrangler will return a URL similar to:

   `https://swoop-tv-xtream-relay.<your-subdomain>.workers.dev`

7. In Swoop TV, open **Add TV Provider → Xtream → Browser Connection Helper** and enter:
   - the Worker URL
   - the same private `SWOOP_PROXY_TOKEN`

Then connect the Xtream provider normally.

## Dashboard deployment

You can also create a Worker in the Cloudflare dashboard, paste `worker.js`, add a secret named `SWOOP_PROXY_TOKEN`, deploy it, and copy the resulting `workers.dev` URL into Swoop TV.

## Security

- A token is required before the Worker will proxy a request.
- Only a small allowlist of Xtream `player_api.php` actions is accepted.
- It refuses localhost and common private-network targets.
- It cannot be used by Swoop TV to relay video payloads.
- Keep your Worker token private. Treat it like a password.

If you publish Swoop TV publicly, do not hard-code the Worker token into the source code.
