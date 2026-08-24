const DEFAULT_METADATA_SERVICE = 'https://swoop-tv-connection.justinbelot8.workers.dev';

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
    title:item.name || '',
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
    title:item.name || '',
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
