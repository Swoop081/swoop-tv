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

const ALLOWED_PARAMS = new Set(['series_id', 'vod_id', 'stream_id', 'limit', 'epg_limit']);

const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';
const MDBLIST_BASE = 'https://api.mdblist.com';

function tmdbHeaders(env) {
  const token=String(env.TMDB_API_TOKEN || '').trim();
  if (!token) throw new Error('TMDb metadata is not configured on the Swoop TV service.');
  return {'Authorization':`Bearer ${token}`,'Accept':'application/json','User-Agent':'SwoopTV-Metadata/0.4.5'};
}

function safeYear(value='') { const m=String(value||'').match(/(?:19|20)\d{2}/); return m?m[0]:''; }
function cleanSearchTitle(value='') {
  let s=String(value||'').trim().replace(/^\s*(?:[-–—|:•·]+\s*)+/, '').trim();
  for(let i=0;i<4;i++){
    const m=s.match(/^\s*([^|:\-]{1,24})\s*(?:\||:|\s[-–—]\s)\s*(.+)$/);
    if(!m)break;
    const key=m[1].trim().toLowerCase();
    if(!['amz','amazon','prime','prime video','nf','netflix','en','eng','english','atv','a+','apple tv','apple tv+','appletv+','apl','dsnp','disney','disney+','hmax','max','hbo max','pmtp','paramount','paramount+','top','new','movie','movies','film','films','vod','4k','uhd','fhd','hd','sd','us','uk','au','ca'].includes(key))break;
    s=m[2].trim();
  }
  for(let i=0;i<6;i++){
    const next=s.replace(/\s*[\[(]\s*(?:(?:19|20)\d{2}|US|USA|UK|GB|AU|AUS|CA|CAN|NZ|EN|ENG|ENGLISH)\s*[\])]\s*$/i,'').trim();
    if(next===s.trim())break;
    s=next;
  }
  return s.trim();
}
function normalizedIdentityTitle(value='') {
  return cleanSearchTitle(value).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
}
function tmdbMediaTitle(item,type='movie'){return type==='tv'?(item?.name||item?.original_name||''):(item?.title||item?.original_title||'')}
function tmdbMediaYear(item,type='movie'){return safeYear(type==='tv'?item?.first_air_date:item?.release_date)}
function exactTitleMatch(requested='',candidate=''){const a=normalizedIdentityTitle(requested),b=normalizedIdentityTitle(candidate);return Boolean(a&&b&&a===b)}
function exactYearMatch(requested='',candidate=''){const a=safeYear(requested),b=safeYear(candidate);return !a||Boolean(b&&a===b)}
function strictSearchMatch(results=[],type='movie',title='',year=''){
  const candidates=Array.isArray(results)?results:[];
  return candidates.find(item=>exactTitleMatch(title,tmdbMediaTitle(item,type))&&exactYearMatch(year,tmdbMediaYear(item,type)))||null;
}
async function resolveTmdbIdentity(env,{type='movie',tmdbId='',imdbId='',title='',year=''}){
  const requestedYear=safeYear(year),requestedTitle=cleanSearchTitle(title);
  if(tmdbId){
    try{const item=await tmdbFetch(`/${type}/${encodeURIComponent(tmdbId)}`,env,{language:'en-AU'});if(item?.id&&exactYearMatch(requestedYear,tmdbMediaYear(item,type)))return {id:String(item.id),item,source:'tmdb-id'}}catch{}
  }
  if(imdbId&&/^tt\d+$/i.test(imdbId)){
    try{const found=await tmdbFetch(`/find/${encodeURIComponent(imdbId)}`,env,{external_source:'imdb_id',language:'en-AU'});const match=(type==='tv'?found.tv_results:found.movie_results)?.find(item=>exactYearMatch(requestedYear,tmdbMediaYear(item,type)))||null;if(match?.id)return {id:String(match.id),item:match,source:'imdb-id'}}catch{}
  }
  if(!requestedTitle)return null;
  const params={query:requestedTitle,language:'en-AU',include_adult:'false'};
  if(requestedYear)params[type==='tv'?'first_air_date_year':'year']=requestedYear;
  const found=await tmdbFetch(`/search/${type}`,env,params);
  const match=strictSearchMatch(found?.results,type,requestedTitle,requestedYear);
  return match?.id?{id:String(match.id),item:match,source:'title-year'}:null;
}
function tmdbImage(path,size='original'){return path?`${TMDB_IMAGE_BASE}/${size}${path}`:''}

async function tmdbFetch(path, env, params={}) {
  const url=new URL(`${TMDB_BASE}${path}`);
  Object.entries(params).forEach(([k,v])=>{if(v!==undefined&&v!==null&&v!=='')url.searchParams.set(k,String(v))});
  const res=await fetch(url.toString(),{headers:tmdbHeaders(env),cf:{cacheTtl:86400,cacheEverything:true}});
  if(!res.ok)throw new Error(`TMDb returned HTTP ${res.status}.`);
  return res.json();
}
async function tmdbFetchPages(path,env,params={},pages=1){
  const count=Math.max(1,Math.min(20,Number(pages||1))),payloads=await Promise.all(Array.from({length:count},(_,i)=>tmdbFetch(path,env,{...params,page:i+1})));
  return {results:payloads.flatMap(x=>Array.isArray(x?.results)?x.results:[])};
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
function metadataFromTmdb(item,type='movie',imdbRating='') {
  if(!item)return null;
  const title=type==='tv'?(item.name||item.original_name):(item.title||item.original_title);
  const date=type==='tv'?item.first_air_date:item.release_date;
  const backdrops=bestBackdropPaths(item);
  const backdrop=backdrops[0]||item.backdrop_path||'';
  const cast=(Array.isArray(item?.credits?.cast)?item.credits.cast:[]).slice(0,10).map(x=>({id:x.id?String(x.id):'',name:x.name||'',character:x.character||'',profile:tmdbImage(x.profile_path,'w185')})).filter(x=>x.name);
  const director=type==='movie'?(Array.isArray(item?.credits?.crew)?item.credits.crew:[]).filter(x=>x.job==='Director').slice(0,3).map(x=>x.name).filter(Boolean).join(', '):(Array.isArray(item?.created_by)?item.created_by:[]).map(x=>x.name).filter(Boolean).join(', ');
  const trailer=bestTrailer(item);
  return {
    tmdbId:item.id?String(item.id):'',
    imdbId:String(item?.external_ids?.imdb_id||''),
    imdbRating:imdbRating||'',
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

async function fetchMdbImdbRating(env,imdbId,type='movie') {
  const key=String(env.MDBLIST_API_KEY||'').trim();
  if(!key||!/^tt\d+$/i.test(String(imdbId||'')))return'';
  const mediaType=type==='tv'?'show':'movie';
  const url=new URL(`${MDBLIST_BASE}/rating/${mediaType}/imdb`);
  url.searchParams.set('apikey',key);
  const res=await fetch(url.toString(),{
    method:'POST',
    headers:{'Accept':'application/json','Content-Type':'application/json','User-Agent':'SwoopTV-Metadata/0.4.5'},
    body:JSON.stringify({ids:[String(imdbId)],provider:'imdb'})
  });
  if(!res.ok)return'';
  const payload=await res.json();
  const value=Number(payload?.ratings?.[0]?.rating);
  return Number.isFinite(value)&&value>0&&value<=10?value.toFixed(1):'';
}

async function handleImdbRating(request, env, body) {
  if(!String(env.TMDB_API_TOKEN||'').trim()) return json(request,{error:'Swoop TV IMDb matching is not configured. Add the TMDB_API_TOKEN secret to the Swoop TV Worker.'},503);
  if(!String(env.MDBLIST_API_KEY||'').trim()) return json(request,{error:'Swoop TV IMDb ratings are not configured. Add the MDBLIST_API_KEY secret to the Swoop TV Worker.'},503);
  const type=String(body?.mediaType||'movie')==='tv'?'tv':'movie';
  const suppliedTmdbId=String(body?.tmdbId||'').trim(),suppliedImdbId=String(body?.imdbId||'').trim();
  const title=cleanSearchTitle(body?.title||''),year=safeYear(body?.year||body?.title||'');
  try{
    const resolved=await resolveTmdbIdentity(env,{type,tmdbId:suppliedTmdbId,imdbId:suppliedImdbId,title,year});
    if(!resolved?.id)return json(request,{rating:{tmdbId:'',imdbId:'',imdbRating:'',title,year}},200);
    const tmdbId=String(resolved.id);
    let imdbId=suppliedImdbId;
    if(!imdbId){
      const external=await tmdbFetch(`/${type}/${encodeURIComponent(tmdbId)}/external_ids`,env,{language:'en-AU'});
      imdbId=String(external?.imdb_id||'');
    }
    const imdbRating=imdbId?await fetchMdbImdbRating(env,imdbId,type):'';
    const resolvedTitle=tmdbMediaTitle(resolved.item,type)||title;
    const resolvedYear=tmdbMediaYear(resolved.item,type)||year;
    return new Response(JSON.stringify({rating:{tmdbId,imdbId,imdbRating,title:resolvedTitle,year:resolvedYear}}),{status:200,headers:{...corsHeaders(request),'Content-Type':'application/json; charset=utf-8','Cache-Control':'public, max-age=86400'}});
  }catch(error){return json(request,{error:error.message||'Could not load IMDb rating.'},502)}
}

async function handleMetadata(request, env, body) {
  if(!String(env.TMDB_API_TOKEN||'').trim()) return json(request,{error:'Swoop TV cinematic artwork is not configured yet. Add the TMDB_API_TOKEN secret to the Swoop TV Worker.'},503);
  const type=String(body?.mediaType||'movie')==='tv'?'tv':'movie';
  const tmdbId=String(body?.tmdbId||'').trim(),imdbId=String(body?.imdbId||'').trim();
  const title=cleanSearchTitle(body?.title||''),year=safeYear(body?.year||body?.title||'');
  try{
    const resolved=await resolveTmdbIdentity(env,{type,tmdbId,imdbId,title,year});
    if(!resolved?.id)return json(request,{metadata:null},200);
    const item=await tmdbFetch(`/${type}/${encodeURIComponent(resolved.id)}`,env,{
      language:'en-AU',
      append_to_response:type==='tv'?'images,credits,videos,recommendations,content_ratings,external_ids':'images,credits,videos,recommendations,release_dates,external_ids',
      include_image_language:'en,null'
    });
    if(!exactYearMatch(year,tmdbMediaYear(item,type)))return json(request,{metadata:null},200);
    if(resolved.source==='title-year'&&!exactTitleMatch(title,tmdbMediaTitle(item,type)))return json(request,{metadata:null},200);
    const resolvedImdbId=String(item?.external_ids?.imdb_id||imdbId||'');
    let imdbRating='';
    if(resolvedImdbId&&String(env.MDBLIST_API_KEY||'').trim()){try{imdbRating=await fetchMdbImdbRating(env,resolvedImdbId,type)}catch{}}
    return new Response(JSON.stringify({metadata:metadataFromTmdb(item,type,imdbRating)}),{status:200,headers:{...corsHeaders(request),'Content-Type':'application/json; charset=utf-8','Cache-Control':'public, max-age=21600'}});
  }catch(error){return json(request,{error:error.message||'Could not load TMDb metadata.'},502)}
}


function compactPersonCredit(x={}){
  const type=x.media_type==='tv'?'tv':x.media_type==='movie'?'movie':'';
  if(!type||!x.id)return null;
  const title=type==='tv'?(x.name||x.original_name||''):(x.title||x.original_title||'');
  if(!title)return null;
  return {
    tmdb:String(x.id),
    title,
    year:safeYear(type==='tv'?x.first_air_date:x.release_date),
    media_type:type,
    character:x.character||'',
    poster:tmdbImage(x.poster_path,'w342'),
    popularity:Number(x.popularity||0)
  };
}
function dedupePersonCredits(list=[]){
  const seen=new Set(),out=[];
  for(const raw of list){const credit=compactPersonCredit(raw);if(!credit)continue;const key=`${credit.media_type}:${credit.tmdb}`;if(seen.has(key))continue;seen.add(key);out.push(credit)}
  return out.sort((a,b)=>(Number(b.year||0)-Number(a.year||0))||(Number(b.popularity||0)-Number(a.popularity||0))||a.title.localeCompare(b.title));
}
async function handlePersonCredits(request,env,body){
  if(!String(env.TMDB_API_TOKEN||'').trim())return json(request,{error:'Swoop TV cast browsing is not configured. Add the TMDB_API_TOKEN secret to the Swoop TV Worker.'},503);
  const suppliedId=String(body?.personId||'').trim(),requestedName=String(body?.name||'').trim();
  try{
    let personId=suppliedId;
    if(!personId&&requestedName){
      const found=await tmdbFetch('/search/person',env,{query:requestedName,language:'en-AU',include_adult:'false'}),normalized=normalizedIdentityTitle(requestedName);
      const exact=(Array.isArray(found?.results)?found.results:[]).find(x=>normalizedIdentityTitle(x?.name||'')===normalized)||null;
      personId=exact?.id?String(exact.id):'';
    }
    if(!/^\d+$/.test(personId))return json(request,{person:null},200);
    const person=await tmdbFetch(`/person/${encodeURIComponent(personId)}`,env,{language:'en-AU',append_to_response:'combined_credits,external_ids'});
    const credits=dedupePersonCredits(Array.isArray(person?.combined_credits?.cast)?person.combined_credits.cast:[]).slice(0,800);
    return new Response(JSON.stringify({person:{
      id:String(person.id||personId),name:person.name||requestedName||'',profile:tmdbImage(person.profile_path,'w500'),
      knownForDepartment:person.known_for_department||'',biography:person.biography||'',birthday:person.birthday||'',placeOfBirth:person.place_of_birth||'',
      credits
    }}),{status:200,headers:{...corsHeaders(request),'Content-Type':'application/json; charset=utf-8','Cache-Control':'public, max-age=86400'}});
  }catch(error){return json(request,{error:error.message||'Could not load cast credits.'},502)}
}


function compactDiscoveryTmdb(payload,type='movie') {
  const list=Array.isArray(payload?.results)?payload.results:[];
  return list.slice(0,500).map((x,index)=>({
    tmdb:x?.id?String(x.id):'',
    title:type==='tv'?(x?.name||x?.original_name||''):(x?.title||x?.original_title||''),
    year:safeYear(type==='tv'?x?.first_air_date:x?.release_date),
    popularity:Number(x?.popularity||0),
    rating:Number(x?.vote_average||0),
    rank:index+1
  })).filter(x=>x.tmdb&&x.title);
}
function extractMdbList(payload){
  if(Array.isArray(payload))return payload;
  if(!payload||typeof payload!=='object')return[];
  for(const key of ['items','movies','shows','results','data','list','entries'])if(Array.isArray(payload[key]))return payload[key];
  if(payload.data&&typeof payload.data==='object')for(const key of ['items','movies','shows','results'])if(Array.isArray(payload.data[key]))return payload.data[key];
  return[];
}
function compactDiscoveryMdb(payload){
  const list=extractMdbList(payload);
  return list.slice(0,800).map((raw,index)=>{
    const x=raw?.movie||raw?.show||raw?.media||raw?.item||raw||{},ids=x.ids||raw?.ids||{};
    return {
      tmdb:String(x.tmdb??x.tmdb_id??ids.tmdb??raw?.tmdb??raw?.tmdb_id??''),
      imdb:String(x.imdb??x.imdb_id??ids.imdb??raw?.imdb??raw?.imdb_id??''),
      title:x.title||x.name||raw?.title||raw?.name||'',
      year:safeYear(x.year||x.release_year||raw?.year||raw?.release_year||''),
      rank:index+1
    };
  }).filter(x=>x.title);
}
const SNOAK_LISTS = Object.freeze({
  // Daily / near-daily core discovery signals.
  'movies-tvstats':{slug:'todays-most-popular-movies-on-television-stats',mediaType:'movie'},
  'shows-tvstats':{slug:'todays-most-popular-shows-on-television-stats',mediaType:'tv'},
  'movies-justwatch':{slug:'todays-most-popular-movies',mediaType:'movie'},
  'shows-justwatch':{slug:'todays-most-popular-shows',mediaType:'tv'},
  'movies-imdb':{slug:'top-10-movies-of-the-day',mediaType:'movie'},
  'shows-imdb':{slug:'top-10-shows-of-the-day',mediaType:'tv'},
  'movies-rotten':{slug:'most-popular-movies-on-rotten-tomatoes',mediaType:'movie'},
  'shows-rotten':{slug:'most-popular-shows-on-rotten-tomatoes',mediaType:'tv'},
  'movies-trakt':{slug:'trending-movies',mediaType:'movie'},
  'shows-trakt':{slug:'trakt-s-trending-shows',mediaType:'tv'},
  'movies-trakt-digital':{slug:'trakts-trending-movies-digital',mediaType:'movie'},
  'movies-latest':{slug:'latest-movies-digital-release',mediaType:'movie'},
  'shows-latest':{slug:'latest-tv-shows',mediaType:'tv'},

  // Curated popular genre rails. Only a known allow-list can be requested by clients.
  'genre-action-movies':{slug:'action-movies',mediaType:'movie'},
  'genre-action-shows':{slug:'action-shows',mediaType:'tv'},
  'genre-animation-movies':{slug:'popular-animated-movies',mediaType:'movie'},
  'genre-animation-shows':{slug:'popular-animated-shows',mediaType:'tv'},
  'genre-comedy-movies':{slug:'comedy-movies',mediaType:'movie'},
  'genre-comedy-shows':{slug:'comedy-shows',mediaType:'tv'},
  'genre-crime-shows':{slug:'popular-crime-shows',mediaType:'tv'},
  'genre-documentary':{slug:'popular-documentary-movies',mediaType:'movie'},
  'genre-documentary-shows':{slug:'popular-documentary-shows',mediaType:'tv'},
  'genre-drama-movies':{slug:'drama-movies',mediaType:'movie'},
  'genre-drama-shows':{slug:'drama-shows',mediaType:'tv'},
  'genre-horror-movies':{slug:'horror-movies',mediaType:'movie'},
  'genre-horror-shows':{slug:'horror-shows',mediaType:'tv'},
  'genre-reality-shows':{slug:'top-reality-shows',mediaType:'tv'},
  'genre-romance-movies':{slug:'popular-romance-movies',mediaType:'movie'},
  'genre-scifi-movies':{slug:'science-fiction-movies',mediaType:'movie'},
  'genre-scifi-shows':{slug:'science-fiction-shows',mediaType:'tv'},
  'genre-thriller-movies':{slug:'thriller-movies',mediaType:'movie'},
  'genre-thriller-shows':{slug:'thriller-shows',mediaType:'tv'}
});
const SNOAK_STALE_MS=8*24*60*60*1000;
function firstListObject(payload){return Array.isArray(payload)?(payload[0]||{}):(payload&&typeof payload==='object'?payload:{});}
function parseListUpdatedAt(payload){
  const x=firstListObject(payload);
  for(const key of ['updated_at','updatedAt','last_updated','lastUpdated','modified_at','modifiedAt','updated']){
    const raw=x?.[key];if(raw===undefined||raw===null||raw==='')continue;
    if(typeof raw==='number'){const ms=raw>1e12?raw:raw*1000;if(Number.isFinite(ms))return ms;}
    const ms=Date.parse(String(raw));if(Number.isFinite(ms))return ms;
  }
  return 0;
}
async function fetchSnoakList(env,key){
  const cfg=SNOAK_LISTS[key];if(!cfg)throw new Error('Unknown Swoop TV curated list.');
  const [info,payload]=await Promise.all([
    mdbFetch(`/lists/snoak/${encodeURIComponent(cfg.slug)}`,env).catch(()=>null),
    mdbFetch(`/lists/snoak/${encodeURIComponent(cfg.slug)}/items`,env,{extended:'ids_only'})
  ]);
  const sourceUpdatedAt=parseListUpdatedAt(info),stale=Boolean(sourceUpdatedAt&&Date.now()-sourceUpdatedAt>SNOAK_STALE_MS);
  return {key,slug:cfg.slug,mediaType:cfg.mediaType,sourceUpdatedAt,stale,items:stale?[]:compactDiscoveryMdb(payload)};
}
async function safeSnoakList(env,key){try{return await fetchSnoakList(env,key)}catch{return {key,slug:SNOAK_LISTS[key]?.slug||'',mediaType:SNOAK_LISTS[key]?.mediaType||'',sourceUpdatedAt:0,stale:false,items:[]}}}
async function handleSnoakList(request,env,body){
  if(!String(env.MDBLIST_API_KEY||'').trim())return json(request,{error:'Swoop TV curated discovery needs MDBLIST_API_KEY on the Worker.'},503);
  const key=String(body?.listKey||'');if(!SNOAK_LISTS[key])return json(request,{error:'Unknown Swoop TV curated list.'},400);
  try{
    const result=await fetchSnoakList(env,key);
    if(result.stale)return json(request,{error:'This curated MDBList source is stale, so Swoop TV is using its local fallback.',stale:true,listKey:key,sourceUpdatedAt:result.sourceUpdatedAt},409);
    return json(request,{listKey:key,mediaType:result.mediaType,source:'snoak/mdblist',sourceUpdatedAt:result.sourceUpdatedAt,updatedAt:Date.now(),items:result.items});
  }catch(error){return json(request,{error:error.message||'Could not load the curated MDBList source.'},502)}
}

async function mdbFetch(path,env,params={}){
  const key=String(env.MDBLIST_API_KEY||'').trim();if(!key)throw new Error('MDBList discovery is not configured.');
  const url=new URL(`${MDBLIST_BASE}${path}`);url.searchParams.set('apikey',key);
  Object.entries(params).forEach(([k,v])=>{if(v!==undefined&&v!==null&&v!=='')url.searchParams.set(k,String(v))});
  const res=await fetch(url.toString(),{headers:{'Accept':'application/json','User-Agent':'SwoopTV-Discovery/0.7.22'},cf:{cacheTtl:21600,cacheEverything:true}});
  if(!res.ok)throw new Error(`MDBList returned HTTP ${res.status}.`);return res.json();
}
async function firstMdbOfficial(env,candidates=[]){
  for(const slug of candidates){try{return compactDiscoveryMdb(await mdbFetch(`/lists/official/${slug}/items`,env))}catch{}}
  return[];
}
async function safeMdb(path,env){try{return compactDiscoveryMdb(await mdbFetch(path,env))}catch{return[]}}
async function handleDiscovery(request,env,body){
  if(!String(env.TMDB_API_TOKEN||'').trim())return json(request,{error:'Swoop TV discovery is not configured yet. Add the TMDB_API_TOKEN secret to the Swoop TV Worker.'},503);
  const type=String(body?.mediaType||'movie')==='tv'?'tv':'movie';
  try{
    const [day,week,popular,fresh]=await Promise.all([
      tmdbFetch(`/trending/${type}/day`,env,{language:'en-AU'}),
      tmdbFetch(`/trending/${type}/week`,env,{language:'en-AU'}),
      tmdbFetchPages(type==='tv'?'/tv/popular':'/movie/popular',env,{language:'en-AU',region:'AU'},20),
      tmdbFetch(type==='tv'?'/tv/on_the_air':'/movie/now_playing',env,{language:'en-AU',region:'AU'})
    ]);
    const sources={
      tmdbDay:compactDiscoveryTmdb(day,type),
      tmdbWeek:compactDiscoveryTmdb(week,type),
      tmdbPopular:compactDiscoveryTmdb(popular,type),
      fresh:compactDiscoveryTmdb(fresh,type)
    };
    let enhanced=false;
    let snoakMeta={};
    if(String(env.MDBLIST_API_KEY||'').trim()){
      enhanced=true;
      const prefix=type==='tv'?'shows':'movies',chartType=type==='tv'?'show':'movie';
      const snoakKeys=type==='tv'
        ?['shows-justwatch','shows-tvstats','shows-imdb','shows-rotten','shows-trakt','shows-latest']
        :['movies-justwatch','movies-tvstats','movies-imdb','movies-rotten','movies-trakt','movies-trakt-digital','movies-latest'];
      const [justwatch,stable,traktTrending,mostWatched,imdbPopular,boxOffice,...snoakResults]=await Promise.all([
        safeMdb(`/justwatch/streaming-charts/${chartType}`,env),
        firstMdbOfficial(env,[`${prefix}/popular`]),
        firstMdbOfficial(env,[`${prefix}/trakt-trending`,`${prefix}/trending`]),
        firstMdbOfficial(env,[`${prefix}/trakt-most-watched`,`${prefix}/most-watched`,`${prefix}/trakt-watched`]),
        firstMdbOfficial(env,[`${prefix}/imdb-most-popular`,`${prefix}/imdb-popular`]),
        type==='movie'?firstMdbOfficial(env,['movies/trakt-weekend-box-office','movies/trakt-boxoffice','movies/boxoffice']):Promise.resolve([]),
        ...snoakKeys.map(key=>safeSnoakList(env,key))
      ]);
      Object.assign(sources,{justwatch,stable,traktTrending,mostWatched,imdbPopular,boxOffice});
      for(const result of snoakResults){
        if(!result)continue;snoakMeta[result.key]={slug:result.slug,sourceUpdatedAt:result.sourceUpdatedAt,stale:result.stale,count:result.items.length};
        if(result.stale||!result.items.length)continue;
        const sourceName={
          'movies-justwatch':'snoakJustwatch','shows-justwatch':'snoakJustwatch',
          'movies-tvstats':'snoakTvStats','shows-tvstats':'snoakTvStats',
          'movies-imdb':'snoakImdb','shows-imdb':'snoakImdb',
          'movies-rotten':'snoakRotten','shows-rotten':'snoakRotten',
          'movies-trakt':'snoakTrakt','shows-trakt':'snoakTrakt',
          'movies-trakt-digital':'snoakTraktDigital',
          'movies-latest':'snoakLatest','shows-latest':'snoakLatest'
        }[result.key];
        if(sourceName)sources[sourceName]=result.items;
      }
    }
    return new Response(JSON.stringify({mediaType:type,updatedAt:Date.now(),enhanced,snoak:Boolean(Object.values(snoakMeta).some(x=>x.count>0&&!x.stale)),snoakMeta,sources}),{status:200,headers:{...corsHeaders(request),'Content-Type':'application/json; charset=utf-8','Cache-Control':'public, max-age=1800'}});
  }catch(error){return json(request,{error:error.message||'Could not load Swoop TV discovery charts.'},502)}
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
    if (contentLength > 4_000_000) throw new Error('Artwork is larger than the 4 MB Swoop TV limit.');
    const bytes = await res.arrayBuffer();
    if (bytes.byteLength > 4_000_000) throw new Error('Artwork is larger than the 4 MB Swoop TV limit.');
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
  if (String(body?.mode || '') === 'imdb-rating') return handleImdbRating(request, env, body);
  if (String(body?.mode || '') === 'person-credits') return handlePersonCredits(request, env, body);
  if (String(body?.mode || '') === 'discovery') return handleDiscovery(request, env, body);
  if (String(body?.mode || '') === 'snoak-list') return handleSnoakList(request, env, body);

  if (!String(env.SWOOP_PROXY_TOKEN || '')) {
    return json(request, {error:'Worker is not configured. Set the SWOOP_PROXY_TOKEN secret first.'}, 503);
  }
  if (!authorized(request, env)) return json(request, {error:'Invalid Swoop TV Connection Helper token.'}, 401);

  if (String(body?.mode || '') === 'asset') return handleAsset(request, body);

  const username = String(body?.username || '');
  const password = String(body?.password || '');
  const action = String(body?.action || '');
  if (!username || !password) return json(request, {error:'Xtream username and password are required.'}, 400);
  if (username.length > 256 || password.length > 512) return json(request, {error:'Credentials are too long.'}, 400);

  let server;
  try { server = normalizeServer(body?.server); }
  catch (error) { return json(request, {error:error.message || 'Invalid Xtream server URL.'}, 400); }

  if (String(body?.mode || '') === 'xmltv') {
    const qs = new URLSearchParams({username, password});
    const target = `${server}/xmltv.php?${qs.toString()}`;
    try {
      const upstream = await fetch(target,{method:'GET',headers:{'Accept':'application/xml,text/xml,text/plain,*/*','User-Agent':'SwoopTV-Connection-Helper/0.1.16'},redirect:'follow'});
      const headers=corsHeaders(request);headers['Content-Type']=upstream.headers.get('Content-Type')||'application/xml; charset=utf-8';headers['X-Swoop-Upstream-Status']=String(upstream.status);
      return new Response(upstream.body,{status:upstream.status,headers});
    } catch (error) { return json(request,{error:`Could not reach the Xtream XMLTV guide from Cloudflare: ${error.message || error}`},502); }
  }

  if (!ALLOWED_ACTIONS.has(action)) return json(request, {error:'That Xtream API action is not allowed by this helper.'}, 400);

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
        version:'0.1.16',
        configured:String(env.SWOOP_PROXY_TOKEN || '').length >= 16,
        metadataConfigured:Boolean(String(env.TMDB_API_TOKEN || '').trim()),
        discoveryConfigured:Boolean(String(env.TMDB_API_TOKEN || '').trim()),
        mdblistConfigured:Boolean(String(env.MDBLIST_API_KEY || '').trim())
      });
    }
    if (request.method !== 'POST') return json(request, {error:'Method not allowed.'}, 405);
    return handlePost(request, env);
  }
};
