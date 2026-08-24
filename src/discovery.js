import {metadataServiceUrl} from './tmdb.js';

export async function fetchSwoopDiscovery({settings={},mediaType='movie'}={}){
  const service=metadataServiceUrl(settings);
  if(!service)throw new Error('Swoop TV discovery service is not configured.');
  const body={mode:'discovery',mediaType:mediaType==='series'||mediaType==='show'||mediaType==='tv'?'tv':'movie'};
  const res=await fetch(service,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),cache:'no-store'});
  if(!res.ok){let detail='';try{detail=(await res.json())?.error||''}catch{}throw new Error(detail||`Swoop TV discovery service returned HTTP ${res.status}.`)}
  return res.json();
}
