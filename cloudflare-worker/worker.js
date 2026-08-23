const ALLOWED_ACTIONS = new Set([
  '',
  'get_live_categories',
  'get_live_streams',
  'get_vod_categories',
  'get_vod_streams',
  'get_series_categories',
  'get_series',
  'get_series_info',
  'get_short_epg',
  'get_simple_data_table'
]);

const ALLOWED_PARAMS = new Set(['series_id', 'stream_id', 'epg_limit']);

function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  };
}

function json(request, data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {...corsHeaders(request), 'Content-Type': 'application/json; charset=utf-8'}
  });
}

function isPrivateHostname(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!h || h === 'localhost' || h.endsWith('.local') || h === '::1') return true;
  if (/^127\./.test(h) || /^10\./.test(h) || /^169\.254\./.test(h) || /^192\.168\./.test(h)) return true;
  const m = h.match(/^172\.(\d{1,3})\./);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
  if (/^(0|224|225|226|227|228|229|230|231|232|233|234|235|236|237|238|239|240|241|242|243|244|245|246|247|248|249|250|251|252|253|254|255)\./.test(h)) return true;
  return false;
}

function normalizeServer(input) {
  const raw = String(input || '').trim().replace(/\/+$/, '').replace(/\/(?:player_api\.php|get\.php)$/i, '');
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only HTTP or HTTPS Xtream servers are supported.');
  if (url.username || url.password) throw new Error('Credentials must not be embedded in the server URL.');
  if (isPrivateHostname(url.hostname)) throw new Error('Private/local network targets are not allowed.');
  return url.toString().replace(/\/+$/, '');
}

function bearerToken(request) {
  const header = request.headers.get('Authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7) : '';
}

function authorized(request, env) {
  const expected = String(env.SWOOP_PROXY_TOKEN || '');
  if (expected.length < 16) return false;
  const supplied = bearerToken(request);
  if (supplied.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ supplied.charCodeAt(i);
  return diff === 0;
}

async function handlePost(request, env) {
  if (!String(env.SWOOP_PROXY_TOKEN || '')) {
    return json(request, {error:'Worker is not configured. Set the SWOOP_PROXY_TOKEN secret first.'}, 503);
  }
  if (!authorized(request, env)) return json(request, {error:'Invalid Swoop Connection Helper token.'}, 401);

  let body;
  try { body = await request.json(); }
  catch { return json(request, {error:'Request body must be JSON.'}, 400); }

  const username = String(body?.username || '');
  const password = String(body?.password || '');
  const action = String(body?.action || '');
  if (!username || !password) return json(request, {error:'Xtream username and password are required.'}, 400);
  if (username.length > 256 || password.length > 512) return json(request, {error:'Credentials are too long.'}, 400);
  if (!ALLOWED_ACTIONS.has(action)) return json(request, {error:'That Xtream API action is not allowed by this helper.'}, 400);

  let server;
  try { server = normalizeServer(body?.server); }
  catch (error) { return json(request, {error:error.message || 'Invalid Xtream server URL.'}, 400); }

  const qs = new URLSearchParams({username, password});
  if (action) qs.set('action', action);
  for (const [key, value] of Object.entries(body?.params || {})) {
    if (ALLOWED_PARAMS.has(key) && value !== undefined && value !== null && value !== '') qs.set(key, String(value));
  }

  const target = `${server}/player_api.php?${qs.toString()}`;
  let upstream;
  try {
    upstream = await fetch(target, {
      method:'GET',
      headers:{'Accept':'application/json,text/plain,*/*', 'User-Agent':'SwoopTV-Connection-Helper/0.1.1'},
      redirect:'follow'
    });
  } catch (error) {
    return json(request, {error:`Could not reach the Xtream server from Cloudflare: ${error.message || error}`}, 502);
  }

  const headers = corsHeaders(request);
  headers['Content-Type'] = upstream.headers.get('Content-Type') || 'application/json; charset=utf-8';
  headers['X-Swoop-Upstream-Status'] = String(upstream.status);
  return new Response(upstream.body, {status:upstream.status, headers});
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, {status:204, headers:corsHeaders(request)});
    if (request.method === 'GET') {
      return json(request, {
        ok:true,
        service:'Swoop TV Xtream Connection Helper',
        version:'0.1.1',
        configured:String(env.SWOOP_PROXY_TOKEN || '').length >= 16
      });
    }
    if (request.method !== 'POST') return json(request, {error:'Method not allowed.'}, 405);
    return handlePost(request, env);
  }
};
