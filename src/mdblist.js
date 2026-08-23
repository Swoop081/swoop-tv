const BASE = 'https://api.mdblist.com';

function authUrl(path, apiKey, params={}) {
  const url = new URL(BASE + path);
  if (apiKey) url.searchParams.set('apikey', apiKey);
  Object.entries(params).forEach(([k,v])=>{ if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v); });
  return url.toString();
}

export async function getMDBListItems({apiKey, listId, username, listName, mediaType=''}) {
  let path;
  if (listId) path = `/lists/${encodeURIComponent(listId)}/items${mediaType ? `/${mediaType}` : ''}`;
  else if (username && listName) path = `/lists/${encodeURIComponent(username)}/${encodeURIComponent(listName)}/items${mediaType ? `/${mediaType}` : ''}`;
  else throw new Error('Enter an MDBList list ID or username + list name.');
  const res = await fetch(authUrl(path, apiKey, {extended:'ids_only'}));
  if (!res.ok) throw new Error(`MDBList request failed (${res.status}).`);
  return res.json();
}

function normalizeTitle(s='') {
  return String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,' ').trim();
}

export function matchMDBListToCatalog(listPayload, catalog=[]) {
  const source = Array.isArray(listPayload) ? listPayload : (listPayload?.items || listPayload?.movies || listPayload?.shows || []);
  const byTmdb = new Map();
  const byImdb = new Map();
  const byTitle = new Map();
  for (const item of catalog.filter(x=>x.kind==='movie'||x.kind==='series')) {
    if (item.tmdbId) byTmdb.set(String(item.tmdbId), item);
    if (item.imdbId) byImdb.set(String(item.imdbId), item);
    const k = `${normalizeTitle(item.name)}|${item.year || ''}`;
    if (!byTitle.has(k)) byTitle.set(k,item);
    if (!byTitle.has(normalizeTitle(item.name))) byTitle.set(normalizeTitle(item.name),item);
  }
  const out=[];
  for (const m of source) {
    const tmdb = m.tmdb || m.tmdb_id || m.ids?.tmdb || m.id;
    const imdb = m.imdb || m.imdb_id || m.ids?.imdb;
    const title = m.title || m.name || '';
    const year = m.year || m.release_year || '';
    const hit = (tmdb && byTmdb.get(String(tmdb))) || (imdb && byImdb.get(String(imdb))) || byTitle.get(`${normalizeTitle(title)}|${year}`) || byTitle.get(normalizeTitle(title));
    if (hit && !out.some(x=>x.id===hit.id)) out.push(hit);
  }
  return out;
}
