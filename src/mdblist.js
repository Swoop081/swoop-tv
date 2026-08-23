import {nativeInfo, nativeFetchText} from './native.js';
const BASE = 'https://api.mdblist.com';

function authUrl(path, apiKey, params={}) {
  const url = new URL(BASE + path);
  if (apiKey) url.searchParams.set('apikey', apiKey);
  Object.entries(params).forEach(([k,v])=>{ if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v); });
  return url.toString();
}

async function fetchJson(path, apiKey, params={}) {
  const url=authUrl(path, apiKey, params);
  if (nativeInfo()) {
    const text=await nativeFetchText(url);
    try { return JSON.parse(text); } catch { throw new Error('MDBList did not return valid JSON.'); }
  }
  const res = await fetch(url, {cache:'no-store'});
  if (!res.ok) throw new Error(`MDBList request failed (${res.status}).`);
  return res.json();
}

export async function getMDBListItems({apiKey, listId, username, listName, mediaType=''}) {
  let path;
  if (listId) path = `/lists/${encodeURIComponent(listId)}/items${mediaType ? `/${mediaType}` : ''}`;
  else if (username && listName) path = `/lists/${encodeURIComponent(username)}/${encodeURIComponent(listName)}/items${mediaType ? `/${mediaType}` : ''}`;
  else throw new Error('Enter an MDBList list ID or username + list name.');
  return fetchJson(path, apiKey, {extended:'ids_only'});
}

export async function getMDBListOfficialItems({apiKey, slug}) {
  if (!slug) throw new Error('MDBList official list slug is missing.');
  return fetchJson(`/lists/official/${String(slug).split('/').map(encodeURIComponent).join('/')}/items`, apiKey);
}

export async function getMDBListStreamingChart({apiKey, mediaType}) {
  const type = mediaType === 'series' || mediaType === 'show' || mediaType === 'shows' ? 'show' : 'movie';
  return fetchJson(`/justwatch/streaming-charts/${type}`, apiKey);
}

export async function getMDBListOfficialLists({apiKey}) {
  return fetchJson('/lists/official', apiKey, {append_to_response:'poster'});
}

function normalizeTitle(s='') {
  return String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,' ').trim();
}

function unwrapEntry(entry) {
  if (!entry || typeof entry !== 'object') return entry;
  return entry.movie || entry.show || entry.media || entry.item || entry;
}

function extractSource(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  for (const key of ['items','movies','shows','results','data','list','entries']) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  if (payload.data && typeof payload.data === 'object') {
    for (const key of ['items','movies','shows','results']) if (Array.isArray(payload.data[key])) return payload.data[key];
  }
  return [];
}

export function matchMDBListToCatalog(listPayload, catalog=[], {limit=0, sourceLimit=0}={}) {
  const extracted = extractSource(listPayload).map(unwrapEntry);
  const source = sourceLimit ? extracted.slice(0, sourceLimit) : extracted;
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
  for (const raw of source) {
    const m = unwrapEntry(raw) || {};
    const ids = m.ids || raw?.ids || {};
    const tmdb = m.tmdb ?? m.tmdb_id ?? ids.tmdb ?? raw?.tmdb ?? raw?.tmdb_id ?? raw?.id;
    const imdb = m.imdb ?? m.imdb_id ?? ids.imdb ?? raw?.imdb ?? raw?.imdb_id;
    const title = m.title || m.name || raw?.title || raw?.name || '';
    const year = m.year || m.release_year || raw?.year || raw?.release_year || '';
    const hit = (tmdb && byTmdb.get(String(tmdb))) || (imdb && byImdb.get(String(imdb))) || byTitle.get(`${normalizeTitle(title)}|${year}`) || byTitle.get(normalizeTitle(title));
    if (hit && !out.some(x=>x.id===hit.id)) out.push(hit);
    if (limit && out.length>=limit) break;
  }
  return out;
}

export function mdblistPayloadCount(payload) {
  return extractSource(payload).length;
}
