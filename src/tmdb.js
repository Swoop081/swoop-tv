const DEFAULT_METADATA_SERVICE = 'https://swoop-tv-connection.justinbelot8.workers.dev';


function cleanMetadataTitle(value='') {
  let s=String(value||'').trim().replace(/^\s*(?:[-–—|:•·]+\s*)+/, '').trim();
  for(let i=0;i<4;i++){
    const m=s.match(/^\s*([^|:\-]{1,24})\s*(?:\||:|\s[-–—]\s)\s*(.+)$/);
    if(!m)break;
    const key=m[1].trim().toLowerCase();
    if(!['amz','amazon','prime','prime video','nf','netflix','en','eng','english','atv','a+','apple tv','apple tv+','appletv+','apl','dsnp','disney','disney+','hmax','max','hbo max','pmtp','paramount','paramount+','top','new','movie','movies','film','films','vod','4k','uhd','fhd','hd','sd','us','uk','au','ca'].includes(key))break;
    s=m[2].trim();
  }
  s=s.replace(/\b(?:4320p|2160p|1080p|1080i|720p|576p|576i|480p|480i|8k|4k|uhd|fhd|hdr10\+?|hdr|hlg|dolby\s*vision|dovi|dv|web[- .]?dl|webrip|bluray|brrip|x26[45]|h26[45]|hevc|av1)\b/gi,' ');
  // Series catalogues frequently suffix both a year and market tag, e.g.
  // `Lioness (2023) (US)`. Remove only those unambiguous trailing tags.
  for(let i=0;i<6;i++){
    const next=s.replace(/\s*[\[(]\s*(?:(?:19|20)\d{2}|US|USA|UK|GB|AU|AUS|CA|CAN|NZ|EN|ENG|ENGLISH)\s*[\])]\s*$/i,'').trim();
    if(next===s.trim())break;
    s=next;
  }
  return s.replace(/\s+/g,' ').trim() || String(value||'').trim();
}


function identityYear(value='') {
  const m=String(value||'').match(/(?:19|20)\d{2}/);
  return m?m[0]:'';
}

function normalizedIdentityTitle(value='') {
  return cleanMetadataTitle(value).normalize('NFKD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
}

export function metadataIdentityMatches(item={}, resolved={}) {
  if(!resolved||typeof resolved!=='object')return false;
  const requestedYear=identityYear(item.year||item.name||''),resolvedYear=identityYear(resolved.year||'');
  if(requestedYear&&(!resolvedYear||requestedYear!==resolvedYear))return false;
  const requestedTitle=normalizedIdentityTitle(item.name||''),resolvedTitle=normalizedIdentityTitle(resolved.title||'');
  const hasTrustedId=Boolean(item.tmdbId||item.imdbId);
  if(!hasTrustedId&&requestedTitle&&resolvedTitle&&requestedTitle!==resolvedTitle)return false;
  return true;
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
    year:item.year || identityYear(item.name || '')
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
    throw new Error(detail || `Swoop TV artwork service returned HTTP ${res.status}.`);
  }
  const data = await res.json();
  const metadata=data?.metadata || null;
  return metadata&&metadataIdentityMatches(item,metadata)?metadata:null;
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
    year:item.year || identityYear(item.name || '')
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
    throw new Error(detail || `Swoop TV IMDb rating service returned HTTP ${res.status}.`);
  }
  const data=await res.json();
  const rating=data?.rating || null;
  if(rating&&metadataIdentityMatches(item,rating))return rating;
  // Older workers did not return resolved title/year on the lightweight route.
  // Fall back to the full metadata path, which can be identity-checked client-side,
  // rather than ever displaying a rating from an ambiguous title match.
  const metadata=await fetchTitleMetadata({settings,item}).catch(()=>null);
  return metadata?{tmdbId:metadata.tmdbId||'',imdbId:metadata.imdbId||'',imdbRating:metadata.imdbRating||'',title:metadata.title||'',year:metadata.year||''}:null;
}

export async function fetchPersonCredits({settings={}, personId='', name=''}) {
  const service = metadataServiceUrl(settings);
  if (!service) return null;
  const body = {
    mode:'person-credits',
    personId:String(personId||''),
    name:String(name||'').trim()
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
    if(res.status===401||/connection helper token/i.test(detail))throw new Error('Cast browsing needs the bundled Swoop TV Worker v0.1.16 to be deployed.');
    throw new Error(detail || `Swoop TV cast service returned HTTP ${res.status}.`);
  }
  const data=await res.json();
  return data?.person || null;
}
