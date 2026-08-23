const ALLOWED_ACTIONS = new Set([
  '',
  'get_live_categories',
  'get_live_streams',
  'get_vod_categories',
  'get_vod_streams',
  'get_vod_info',
  'get_series_categories',
  'get_series',
  'get_series_info',
  'get_short_epg',
  'get_simple_data_table'
]);

const ALLOWED_PARAMS = new Set(['series_id', 'vod_id', 'stream_id', 'epg_limit']);

const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';

function tmdbHeaders(env) {
  const token=String(env.TMDB_API_TOKEN || '').trim();
  if (!token) throw new Error('TMDb metadata is not configured on the Swoop service.');
  return {'Authorization':`Bearer ${token}`,'Accept':'application/json','User-Agent':'SwoopTV-Metadata/0.4.0'};
}

function safeYear(value='') { const m=String(value||'').match(/(?:19|20)\d{2}/); return m?m[0]:''; }
function cleanSearchTitle(value='') {
  let s=String(value||'').trim();
  s=s.replace(/^\s*(?:TOP|NEW|MOVIES?|FILMS?|VOD|EN|ENG|ENGLISH|4K|UHD|FHD|HD)\s*(?:\||:|\s-\s)\s*/i,'');
  s=s.replace(/\s*[\[(](?:19|20)\d{2}[\])]\s*$/,'');
  return s.trim();
}
function tmdbImage(path,size='original'){return path?`${TMDB_IMAGE_BASE}/${size}${path}`:''}

async function tmdbFetch(path, env, params={}) {
  const url=new URL(`${TMDB_BASE}${path}`);
  Object.entries(params).forEach(([k,v])=>{if(v!==undefined&&v!==null&&v!=='')url.searchParams.set(k,String(v))});
  const res=await fetch(url.toString(),{headers:tmdbHeaders(env),cf:{cacheTtl:86400,cacheEverything:true}});
  if(!res.ok)throw new Error(`TMDb returned HTTP ${res.status}.`);
  return res.json();
}

function imageScore(image={}) {
  const width=Number(image.width||0), height=Number(image.height||0), ratio=Number(image.aspect_ratio||0);
  const vote=Number(image.vote_average||0), votes=Math.min(Number(image.vote_count||0),50);
  const ratioPenalty=Math.abs((ratio||1.7777778)-1.7777778)*12;
  return (width/500)+(height/900)+(vote*1.4)+(votes*.08)-ratioPenalty;
}
function bestBackdropPaths(item) {
  const images=Array.isArray(item?.images?.backdrops)?item.images.backdrops:[];
  const unique=new Map();
  for(const image of images){if(image?.file_path&&!unique.has(image.file_path))unique.set(image.file_path,image)}
  const sorted=[...unique.values()].sort((a,b)=>imageScore(b)-imageScore(a));
  if(item?.backdrop_path&&!unique.has(item.backdrop_path))sorted.push({file_path:item.backdrop_path,width:0,height:0,vote_average:0,vote_count:0,aspect_ratio:1.7777778});
  return sorted.map(x=>x.file_path).filter(Boolean).slice(0,12);
}
function bestTitleLogo(item) {
  const logos=Array.isArray(item?.images?.logos)?item.images.logos:[];
  const ranked=[...logos].filter(x=>x?.file_path).sort((a,b)=>{
    const langA=(a.iso_639_1==='en'?2:a.iso_639_1==null?1:0),langB=(b.iso_639_1==='en'?2:b.iso_639_1==null?1:0);
    return (langB-langA)||(Number(b.vote_average||0)-Number(a.vote_average||0))||(Number(b.width||0)-Number(a.width||0));
  });
  return ranked[0]?.file_path||'';
}
function pickCertification(item,type='movie') {
  const preferred=['AU','US','GB','CA'];
  if(type==='tv'){
    const rows=Array.isArray(item?.content_ratings?.results)?item.content_ratings.results:[];
    for(const code of preferred){const hit=rows.find(x=>x.iso_3166_1===code&&x.rating);if(hit)return hit.rating}
    return rows.find(x=>x.rating)?.rating||'';
  }
  const rows=Array.isArray(item?.release_dates?.results)?item.release_dates.results:[];
  for(const code of preferred){const country=rows.find(x=>x.iso_3166_1===code);const hit=country?.release_dates?.find(x=>x.certification);if(hit)return hit.certification}
  for(const country of rows){const hit=country?.release_dates?.find(x=>x.certification);if(hit)return hit.certification}
  return '';
}
function bestTrailer(item){
  const videos=Array.isArray(item?.videos?.results)?item.videos.results:[];
  const ranked=[...videos].filter(x=>x?.site==='YouTube'&&x?.key).sort((a,b)=>{
    const typeScore=x=>x.type==='Trailer'?5:x.type==='Teaser'?3:1;
    const langScore=x=>x.iso_639_1==='en'?3:x.iso_639_1==null?1:0;
    return (Number(Boolean(b.official))-Number(Boolean(a.official)))||(typeScore(b)-typeScore(a))||(langScore(b)-langScore(a))||(Number(b.size||0)-Number(a.size||0));
  });
  const v=ranked[0];return v?{key:v.key,name:v.name||'Official Trailer',type:v.type||'Trailer'}:null;
}
function simplifiedRecommendations(item,type='movie'){
  const list=Array.isArray(item?.recommendations?.results)?item.recommendations.results:[];
  return list.slice(0,24).map(x=>({tmdbId:x.id?String(x.id):'',title:type==='tv'?(x.name||x.original_name||''):(x.title||x.original_title||''),year:safeYear(type==='tv'?x.first_air_date:x.release_date),poster:tmdbImage(x.poster_path,'w342'),backdrop:tmdbImage(x.backdrop_path,'w780'),rating:x.vote_average?Number(x.vote_average).toFixed(1):''})).filter(x=>x.tmdbId&&x.title);
}
function metadataFromTmdb(item,type='movie') {
  if(!item)return null;
  const title=type==='tv'?(item.name||item.original_name):(item.title||item.original_title);
  const date=type==='tv'?item.first_air_date:item.release_date;
  const backdrops=bestBackdropPaths(item);
  const backdrop=backdrops[0]||item.backdrop_path||'';
  const cast=(Array.isArray(item?.credits?.cast)?item.credits.cast:[]).slice(0,10).map(x=>({name:x.name||'',character:x.character||'',profile:tmdbImage(x.profile_path,'w185')})).filter(x=>x.name);
  const director=type==='movie'?(Array.isArray(item?.credits?.crew)?item.credits.crew:[]).filter(x=>x.job==='Director').slice(0,3).map(x=>x.name).filter(Boolean).join(', '):(Array.isArray(item?.created_by)?item.created_by:[]).map(x=>x.name).filter(Boolean).join(', ');
  const trailer=bestTrailer(item);
  return {
    tmdbId:item.id?String(item.id):'',
    title:title||'',
    year:safeYear(date),
    plot:item.overview||'',
    rating:item.vote_average?Number(item.vote_average).toFixed(1):'',
    poster:tmdbImage(item.poster_path,'w500'),
    backdrop:tmdbImage(backdrop,'original'),
    backdrops:backdrops.map(path=>tmdbImage(path,'original')),
    titleLogo:tmdbImage(bestTitleLogo(item),'w500'),
    genres:(Array.isArray(item.genres)?item.genres:[]).map(x=>x.name).filter(Boolean),
    runtime:type==='movie'?(item.runtime?`${item.runtime} min`:''):(Array.isArray(item.episode_run_time)&&item.episode_run_time[0]?`${item.episode_run_time[0]} min`:''),
    certification:pickCertification(item,type),
    cast,
    director,
    trailerKey:trailer?.key||'',
    trailerName:trailer?.name||'',
    recommendations:simplifiedRecommendations(item,type)
  };
}

async function handleMetadata(request, env, body) {
  if(!String(env.TMDB_API_TOKEN||'').trim()) return json(request,{error:'Swoop cinematic artwork is not configured yet. Add the TMDB_API_TOKEN secret to the Swoop Worker.'},503);
  const type=String(body?.mediaType||'movie')==='tv'?'tv':'movie';
  const tmdbId=String(body?.tmdbId||'').trim(),imdbId=String(body?.imdbId||'').trim();
  const title=cleanSearchTitle(body?.title||''),year=safeYear(body?.year||body?.title||'');
  try{
    let match=null;
    if(tmdbId){ match={id:tmdbId}; }
    else if(imdbId&&/^tt\d+$/i.test(imdbId)){
      const found=await tmdbFetch(`/find/${encodeURIComponent(imdbId)}`,env,{external_source:'imdb_id',language:'en-AU'});
      match=(type==='tv'?found.tv_results:found.movie_results)?.[0]||null;
    }
    if(!match&&title){
      const params={query:title,language:'en-AU',include_adult:'false'};
      if(year)params[type==='tv'?'first_air_date_year':'year']=year;
      let found=await tmdbFetch(`/search/${type}`,env,params);
      if(!found?.results?.length&&year){delete params[type==='tv'?'first_air_date_year':'year'];found=await tmdbFetch(`/search/${type}`,env,params);}
      match=found?.results?.[0]||null;
    }
    if(!match?.id)return json(request,{metadata:null},200);
    // Fetch full details plus TMDb's complete artwork set in one request. Search
    // results alone may omit a backdrop even when the title has many backdrops.
    const item=await tmdbFetch(`/${type}/${encodeURIComponent(match.id)}`,env,{
      language:'en-AU',
      append_to_response:type==='tv'?'images,credits,videos,recommendations,content_ratings':'images,credits,videos,recommendations,release_dates',
      include_image_language:'en,null'
    });
    return new Response(JSON.stringify({metadata:metadataFromTmdb(item,type)}),{status:200,headers:{...corsHeaders(request),'Content-Type':'application/json; charset=utf-8','Cache-Control':'public, max-age=21600'}});
  }catch(error){return json(request,{error:error.message||'Could not load TMDb metadata.'},502)}
}

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

function normalizePublicAsset(input) {
  const url = new URL(String(input || '').trim());
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only HTTP or HTTPS artwork URLs are supported.');
  if (url.username || url.password) throw new Error('Artwork URLs with embedded credentials are not allowed.');
  if (isPrivateHostname(url.hostname)) throw new Error('Private/local artwork targets are not allowed.');
  return url;
}

function inferredImageType(url, upstreamType='') {
  const type = String(upstreamType || '').split(';')[0].trim().toLowerCase();
  if (type.startsWith('image/')) return type;
  const path = String(url?.pathname || '').toLowerCase();
  if (/\.png$/.test(path)) return 'image/png';
  if (/\.jpe?g$/.test(path)) return 'image/jpeg';
  if (/\.webp$/.test(path)) return 'image/webp';
  if (/\.gif$/.test(path)) return 'image/gif';
  if (/\.svg$/.test(path)) return 'image/svg+xml';
  return type === 'application/octet-stream' ? type : '';
}

async function fetchPublicAsset(startUrl) {
  let current = normalizePublicAsset(startUrl);
  for (let hops=0; hops<4; hops++) {
    const res = await fetch(current.toString(), {
      method:'GET',
      headers:{'Accept':'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8','User-Agent':'SwoopTV-Connection-Helper/0.1.2'},
      redirect:'manual'
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('Location');
      if (!location) throw new Error('Artwork redirect did not include a destination.');
      current = normalizePublicAsset(new URL(location, current).toString());
      continue;
    }
    if (!res.ok) throw new Error(`Artwork source returned HTTP ${res.status}.`);
    const contentLength = Number(res.headers.get('Content-Length') || 0);
    if (contentLength > 4_000_000) throw new Error('Artwork is larger than the 4 MB Swoop limit.');
    const bytes = await res.arrayBuffer();
    if (bytes.byteLength > 4_000_000) throw new Error('Artwork is larger than the 4 MB Swoop limit.');
    const type = inferredImageType(current, res.headers.get('Content-Type'));
    if (!type) throw new Error('Artwork source did not return a supported image type.');
    return {bytes, type};
  }
  throw new Error('Artwork redirected too many times.');
}

async function handleAsset(request, body) {
  let asset;
  try { asset = await fetchPublicAsset(body?.url); }
  catch (error) { return json(request, {error:error.message || 'Could not load artwork.'}, 502); }
  return new Response(asset.bytes, {
    status:200,
    headers:{
      ...corsHeaders(request),
      'Content-Type':asset.type,
      'Cache-Control':'public, max-age=86400',
      'X-Swoop-Asset-Relay':'1'
    }
  });
}

async function handlePost(request, env) {
  let body;
  try { body = await request.clone().json(); }
  catch { return json(request, {error:'Request body must be JSON.'}, 400); }

  if (String(body?.mode || '') === 'metadata') return handleMetadata(request, env, body);

  if (!String(env.SWOOP_PROXY_TOKEN || '')) {
    return json(request, {error:'Worker is not configured. Set the SWOOP_PROXY_TOKEN secret first.'}, 503);
  }
  if (!authorized(request, env)) return json(request, {error:'Invalid Swoop Connection Helper token.'}, 401);

  if (String(body?.mode || '') === 'asset') return handleAsset(request, body);

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
        version:'0.1.6',
        configured:String(env.SWOOP_PROXY_TOKEN || '').length >= 16,
        metadataConfigured:Boolean(String(env.TMDB_API_TOKEN || '').trim())
      });
    }
    if (request.method !== 'POST') return json(request, {error:'Method not allowed.'}, 405);
    return handlePost(request, env);
  }
};
