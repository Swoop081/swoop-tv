const DEFAULT_METADATA_SERVICE = 'https://swoop-tv-connection.justinbelot8.workers.dev';


function cleanMetadataTitle(value='') {
  let s=String(value||'').trim();
  for(let i=0;i<4;i++){
    const m=s.match(/^\s*([^|:\-]{1,24})\s*(?:\||:|\s-\s)\s*(.+)$/);
    if(!m)break;
    const key=m[1].trim().toLowerCase();
    if(!['amz','amazon','prime','prime video','nf','netflix','en','eng','english','atv','apple tv','apl','dsnp','disney','disney+','hmax','max','hbo max','pmtp','paramount','paramount+','top','new','movie','movies','film','films','vod','4k','uhd','fhd','hd','sd','us','uk','au','ca'].includes(key))break;
    s=m[2].trim();
  }
  return s.replace(/\b(?:4320p|2160p|1080p|1080i|720p|576p|576i|480p|480i|8k|4k|uhd|fhd|hdr10\+?|hdr|hlg|dolby\s*vision|dovi|dv|web[- .]?dl|webrip|bluray|brrip|x26[45]|h26[45]|hevc|av1)\b/gi,' ')
    .replace(/\s*[\[(](?:19|20)\d{2}[\])]\s*$/,' ')
    .replace(/\s+/g,' ').trim() || String(value||'').trim();
}

export function metadataServiceUrl(settings={}) {
  return String(settings?.metadataServiceUrl || DEFAULT_METADATA_SERVICE).trim().replace(/\/+$/, '');
}

export async function fetchTitleMetadata({settings={}, item}) {
  if (!item || !['movie','series'].includes(item.kind)) return null;
  const service = metadataServiceUrl(settings);
  if (!service) return null;
  const body = {
    mode:'metadata',
    mediaType:item.kind === 'series' ? 'tv' : 'movie',
    tmdbId:item.tmdbId || '',
    imdbId:item.imdbId || '',
    title:cleanMetadataTitle(item.name || ''),
    year:item.year || ''
  };
  const res = await fetch(service, {
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify(body),
    cache:'no-store'
  });
  if (!res.ok) {
    let detail='';
    try { detail=(await res.json())?.error || ''; } catch {}
    throw new Error(detail || `Swoop artwork service returned HTTP ${res.status}.`);
  }
  const data = await res.json();
  return data?.metadata || null;
}

export async function fetchTitleImdbRating({settings={}, item}) {
  if (!item || !['movie','series'].includes(item.kind)) return null;
  const service = metadataServiceUrl(settings);
  if (!service) return null;
  const body = {
    mode:'imdb-rating',
    mediaType:item.kind === 'series' ? 'tv' : 'movie',
    tmdbId:item.tmdbId || '',
    imdbId:item.imdbId || '',
    title:cleanMetadataTitle(item.name || ''),
    year:item.year || ''
  };
  const res = await fetch(service, {
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify(body),
    cache:'no-store'
  });
  if (!res.ok) {
    let detail='';
    try { detail=(await res.json())?.error || ''; } catch {}
    throw new Error(detail || `Swoop IMDb rating service returned HTTP ${res.status}.`);
  }
  const data=await res.json();
  return data?.rating || null;
}
