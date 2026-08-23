function cleanServer(server='') {
  return server.trim().replace(/\/+$/, '');
}

async function getJson(url, timeoutMs=20000) {
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {signal: controller.signal, cache:'no-store'});
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally { clearTimeout(timer); }
}

function apiUrl(server, username, password, action='') {
  const s = cleanServer(server);
  const qs = new URLSearchParams({username, password});
  if (action) qs.set('action', action);
  return `${s}/player_api.php?${qs.toString()}`;
}

export async function testXtream(config) {
  const data = await getJson(apiUrl(config.server, config.username, config.password));
  if (!data?.user_info) throw new Error('This server did not return an Xtream user profile.');
  return data;
}

export async function importXtream(config, providerId='xtream') {
  const server = cleanServer(config.server);
  const {username, password} = config;
  const [liveCats, liveStreams, vodCats, vodStreams, seriesCats, series] = await Promise.all([
    getJson(apiUrl(server, username, password, 'get_live_categories')).catch(()=>[]),
    getJson(apiUrl(server, username, password, 'get_live_streams')).catch(()=>[]),
    getJson(apiUrl(server, username, password, 'get_vod_categories')).catch(()=>[]),
    getJson(apiUrl(server, username, password, 'get_vod_streams')).catch(()=>[]),
    getJson(apiUrl(server, username, password, 'get_series_categories')).catch(()=>[]),
    getJson(apiUrl(server, username, password, 'get_series')).catch(()=>[]),
  ]);
  const catName = (cats,id)=>cats.find(c=>String(c.category_id)===String(id))?.category_name || 'Uncategorised';
  const items = [];
  for (const s of liveStreams || []) items.push({
    id:`${providerId}:live:${s.stream_id}`, providerId, source:'xtream', kind:'live', name:s.name || 'Untitled channel',
    group:catName(liveCats,s.category_id), logo:s.stream_icon || '', tvgId:s.epg_channel_id || '',
    streamUrl:`${server}/live/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${s.stream_id}.${s.container_extension || 'ts'}`,
    streamId:s.stream_id, epgChannelId:s.epg_channel_id || '', raw:s
  });
  for (const s of vodStreams || []) items.push({
    id:`${providerId}:movie:${s.stream_id}`, providerId, source:'xtream', kind:'movie', name:s.name || 'Untitled movie',
    group:catName(vodCats,s.category_id), logo:s.stream_icon || '', year:s.year || '', rating:s.rating || '',
    tmdbId:s.tmdb || s.tmdb_id || '', imdbId:s.imdb_id || '',
    streamUrl:`${server}/movie/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${s.stream_id}.${s.container_extension || 'mp4'}`,
    streamId:s.stream_id, raw:s
  });
  for (const s of series || []) items.push({
    id:`${providerId}:series:${s.series_id}`, providerId, source:'xtream', kind:'series', name:s.name || 'Untitled series',
    group:catName(seriesCats,s.category_id), logo:s.cover || '', year:s.releaseDate || s.year || '', rating:s.rating || '',
    tmdbId:s.tmdb || s.tmdb_id || '', imdbId:s.imdb_id || '', streamUrl:'', seriesId:s.series_id, raw:s
  });
  return {items, categories:{live:liveCats, movie:vodCats, series:seriesCats}};
}

export async function fetchXtreamSeriesInfo(config, seriesId) {
  const url = apiUrl(config.server, config.username, config.password, 'get_series_info') + `&series_id=${encodeURIComponent(seriesId)}`;
  return getJson(url);
}
