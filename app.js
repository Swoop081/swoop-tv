import {parseM3U} from './src/m3u.js';
import {parseXMLTV} from './src/xmltv.js';
import {testXtream, importXtream, fetchXtreamAssetBlob, fetchXtreamSeriesInfo, fetchXtreamVodInfo, fetchXtreamShortEpg, buildXtreamSeriesStreamUrl} from './src/xtream.js';
import {isNativeWindows, nativePlay, nativeStop, nativeFetchText, nativeDiagnostics} from './src/native.js';
import {getMDBListItems, getMDBListOfficialItems, getMDBListStreamingChart, matchMDBListToCatalog} from './src/mdblist.js';
import {fetchTitleMetadata, metadataServiceUrl} from './src/tmdb.js';
import {loadState, loadBulkState, saveState, saveBulkState, loadProviderProfile, saveProviderProfile, clearProviderProfile, clearState} from './src/storage.js';
import {demoCatalog} from './src/demo.js';

const NATIVE_WINDOWS=isNativeWindows();
const DEFAULT_HOME_ROWS=['continue','mylist','top20-movies','top20-shows','trending-movies','trending-shows','live-now','new-movies','new-shows','action-movies','comedy-movies','drama-shows'];
const DEFAULT_STATE={page:'home',catalog:[],provider:null,myList:[],favourites:[],continueWatching:[],mdblistRows:[],webDiscovery:{},metadataCache:{},settings:{mdblistApiKey:'',xtreamRelayUrl:'',xtreamRelayToken:'',metadataServiceUrl:'',backgroundColor:'#050505',homeRows:[...DEFAULT_HOME_ROWS]}};
const loaded=loadState()||{};
let savedProviderProfile=loadProviderProfile()||null;
const state=Object.assign({},DEFAULT_STATE,loaded,{settings:{...DEFAULT_STATE.settings,...(loaded.settings||{})},webDiscovery:{...(loaded.webDiscovery||{})},metadataCache:{...(loaded.metadataCache||{})}});
if(!Array.isArray(state.settings.homeRows)||!state.settings.homeRows.length)state.settings.homeRows=[...DEFAULT_HOME_ROWS];
if(state.settings.discoverySchemaVersion!==2){state.webDiscovery={};state.settings.discoverySchemaVersion=2;}
const METADATA_ARTWORK_SCHEMA=2;
const invalidateMetadataArtwork=Number(state.settings.metadataArtworkSchemaVersion||0)!==METADATA_ARTWORK_SCHEMA;
if(invalidateMetadataArtwork){state.metadataCache={};state.settings.metadataArtworkSchemaVersion=METADATA_ARTWORK_SCHEMA;}
if(!Array.isArray(state.myList)||!state.myList.length) state.myList=Array.isArray(state.favourites)?[...state.favourites]:[];
if(!Array.isArray(state.continueWatching)) state.continueWatching=[];
if(!Array.isArray(state.mdblistRows))state.mdblistRows=[];
state.mdblistRows.forEach((r,i)=>{if(!r.uid)r.uid=`legacy-${Math.abs(hash(String(r.name||'row')+i))}`;});
if(!loaded.settings?.homeRows&&state.mdblistRows.length)state.settings.homeRows.push(...state.mdblistRows.map(r=>`custom:${r.uid}`));

let modal=null,toastTimer=null,playerItem=null,activeHls=null;
let heroRotationIndex=0,heroRotationTimer=null;
const HERO_ROTATION_MS=8000;
let discoveryRefreshing=false,discoveryMessage='';
const metadataPending=new Set();
const DISCOVERY_REFRESH_MS=4*60*60*1000;
let detailItem=null,detailPayload=null,detailLoading=false,detailError='',detailSeason='';
const detailCache=new Map();
const detailEpisodeItems=new Map();
const viewLimits={live:180,movie:120,series:120};
let guideLimit=24;
let guideStart=Math.floor(Date.now()/1800000)*1800000;
const epgCache=new Map();
let guideLoading=false,guideError='';
let m3uGuideLoaded=false;
let sessionRelay={url:state.settings.xtreamRelayUrl||state.provider?.relayUrl||savedProviderProfile?.relayUrl||'',token:state.settings.xtreamRelayToken||state.provider?.relayToken||savedProviderProfile?.relayToken||''};
let sessionXtream={server:state.provider?.server||savedProviderProfile?.server||'',username:state.provider?.username||savedProviderProfile?.username||'',password:state.provider?.password||savedProviderProfile?.password||'',relayUrl:state.provider?.relayUrl||savedProviderProfile?.relayUrl||state.settings.xtreamRelayUrl||'',relayToken:state.provider?.relayToken||savedProviderProfile?.relayToken||state.settings.xtreamRelayToken||''};
let storageRestoring=Boolean(state.provider && !state.catalog.length);
const artworkCache=new Map();
const artworkRelayQueue=[]; let artworkRelayActive=0; const ARTWORK_RELAY_LIMIT=6;
const $app=document.querySelector('#app');

function esc(s=''){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function hash(s=''){let h=0;for(let i=0;i<s.length;i++)h=((h<<5)-h)+s.charCodeAt(i)|0;return h}
function activeCatalog(){return state.catalog.length?state.catalog:demoCatalog}
function items(kind){return activeCatalog().filter(x=>x.kind===kind)}
function isInMyList(item){return Boolean(item&&state.myList.includes(item.id))}
function continueEntry(id){return state.continueWatching.find(x=>x?.id===id)}
function savedItem(id){return activeCatalog().find(x=>x.id===id)||state.continueWatching.find(x=>x?.id===id)?.item||detailEpisodeItems.get(id)||null}
function visualItem(item){
  if(!item)return item;
  const meta=state.metadataCache?.[item.id]||{};
  return {...item,...(meta||{}),logo:meta.poster||item.logo||'',backdrop:meta.backdrop||item.backdrop||'',plot:meta.plot||item.plot||'',year:meta.year||item.year||'',rating:meta.rating||item.rating||'',tmdbId:meta.tmdbId||item.tmdbId||''};
}
function validHex(value){return /^#[0-9a-f]{6}$/i.test(String(value||''))?String(value).toLowerCase():'#050505'}
function applyTheme(){const c=validHex(state.settings.backgroundColor);document.documentElement.style.setProperty('--bg',c);document.documentElement.style.setProperty('--swoop-bg',c);}
async function enrichItemMetadata(item,{rerender=true}={}){
  if(!item||!['movie','series'].includes(item.kind)||metadataPending.has(item.id))return;
  const cached=state.metadataCache?.[item.id];
  if(cached?.checkedAt&&Date.now()-cached.checkedAt<7*86400000)return;
  metadataPending.add(item.id);
  try{
    const metadata=await fetchTitleMetadata({settings:state.settings,item});
    state.metadataCache[item.id]={...(cached||{}),...(metadata||{}),checkedAt:Date.now()};
    if(metadata?.tmdbId&&!item.tmdbId)item.tmdbId=metadata.tmdbId;
    persist(true);
    if(rerender&&(state.page==='home'||detailItem?.id===item.id||modal==='homeRows'))render();
  }catch(err){state.metadataCache[item.id]={...(cached||{}),checkedAt:Date.now(),error:err.message||String(err)};persist(true);}
  finally{metadataPending.delete(item.id)}
}
function scheduleMetadataEnrichment(){
  const queue=[];
  for(const heroItem of heroCandidates().slice(0,10))if(heroItem)queue.push(heroItem);
  if(state.page==='home')for(const def of selectedHomeRows().slice(0,8))for(const item of homeRowItems(def.id).slice(0,5))queue.push(item);
  if(detailItem)queue.unshift(detailItem);
  const unique=[...new Map(queue.filter(Boolean).map(x=>[x.id,x])).values()].filter(x=>['movie','series'].includes(x.kind)).slice(0,12);
  let i=0;const next=()=>{if(i>=unique.length)return;enrichItemMetadata(unique[i++],{rerender:i<=2}).finally(()=>setTimeout(next,120))};next();
}
function resolveProviderAsset(value=''){
  const raw=Array.isArray(value)?value.find(Boolean)||'':String(value||'').trim();
  if(!raw)return'';
  try{return new URL(raw,`${String(state.provider?.server||sessionXtream.server||'').replace(/\/+$/,'')}/`).href}catch{return raw}
}
function kindLabel(item){return item?.kind==='live'?'Live TV':item?.kind==='movie'?'Movie':item?.kind==='series'?'Series':item?.kind==='episode'?'Episode':'Title'}
const HOME_ROW_DEFS=[
  {id:'continue',label:'Continue Watching',group:'Your Swoop',poster:true},
  {id:'mylist',label:'My List',group:'Your Swoop',poster:true,page:'mylist'},
  {id:'top20-movies',label:'Top 20 Movies',group:'Live from the web',poster:true,web:true,ranked:true,description:'MDBList Popular Movies — current top 20'},
  {id:'top20-shows',label:'Top 20 TV Shows',group:'Live from the web',poster:true,web:true,ranked:true,description:'MDBList Popular Shows — current top 20'},
  {id:'trending-movies',label:'Trending Movies',group:'Live from the web',poster:true,web:true,description:'Current JustWatch streaming chart matched to your library'},
  {id:'trending-shows',label:'Trending TV Shows',group:'Live from the web',poster:true,web:true,description:'Current JustWatch streaming chart matched to your library'},
  {id:'live-now',label:'Live Now',group:'Your provider',poster:false,page:'live'},
  {id:'new-movies',label:'New & Recent Movies',group:'Your provider',poster:true,page:'movies'},
  {id:'new-shows',label:'New & Recent TV Shows',group:'Your provider',poster:true,page:'series'},
  {id:'top-rated-movies',label:'Top Rated Movies',group:'Your provider',poster:true},
  {id:'top-rated-shows',label:'Top Rated TV Shows',group:'Your provider',poster:true},
  {id:'action-movies',label:'Action Movies',group:'Categories',poster:true},
  {id:'comedy-movies',label:'Comedy Movies',group:'Categories',poster:true},
  {id:'drama-movies',label:'Drama Movies',group:'Categories',poster:true},
  {id:'horror-movies',label:'Horror Movies',group:'Categories',poster:true},
  {id:'thriller-movies',label:'Thriller Movies',group:'Categories',poster:true},
  {id:'scifi-movies',label:'Sci-Fi & Fantasy Movies',group:'Categories',poster:true},
  {id:'family-movies',label:'Family Movies',group:'Categories',poster:true},
  {id:'animation-movies',label:'Animation Movies',group:'Categories',poster:true},
  {id:'romance-movies',label:'Romance Movies',group:'Categories',poster:true},
  {id:'adventure-movies',label:'Adventure Movies',group:'Categories',poster:true},
  {id:'fantasy-movies',label:'Fantasy Movies',group:'Categories',poster:true},
  {id:'mystery-movies',label:'Mystery Movies',group:'Categories',poster:true},
  {id:'western-movies',label:'Western Movies',group:'Categories',poster:true},
  {id:'war-movies',label:'War Movies',group:'Categories',poster:true},
  {id:'music-movies',label:'Music & Musical Movies',group:'Categories',poster:true},
  {id:'drama-shows',label:'Drama TV Shows',group:'Categories',poster:true},
  {id:'crime-shows',label:'Crime TV Shows',group:'Categories',poster:true},
  {id:'comedy-shows',label:'Comedy TV Shows',group:'Categories',poster:true},
  {id:'reality-shows',label:'Reality TV',group:'Categories',poster:true},
  {id:'action-shows',label:'Action & Adventure TV',group:'Categories',poster:true},
  {id:'scifi-shows',label:'Sci-Fi & Fantasy TV',group:'Categories',poster:true},
  {id:'mystery-shows',label:'Mystery TV',group:'Categories',poster:true},
  {id:'thriller-shows',label:'Thriller TV',group:'Categories',poster:true},
  {id:'animation-shows',label:'Animation TV',group:'Categories',poster:true},
  {id:'family-shows',label:'Family & Kids TV',group:'Categories',poster:true},
  {id:'documentary',label:'Documentaries',group:'Categories',poster:true},
  {id:'movies',label:'All Movies',group:'Your provider',poster:true,page:'movies'},
  {id:'shows',label:'All TV Shows',group:'Your provider',poster:true,page:'series'}
];
const HOME_ROW_MAP=new Map(HOME_ROW_DEFS.map(x=>[x.id,x]));
const WEB_ROW_IDS=new Set(HOME_ROW_DEFS.filter(x=>x.web).map(x=>x.id));
function providerCategoryDefs(){
  const make=(kind,label)=>{const counts=new Map();for(const item of items(kind)){const g=String(item.group||'').trim();if(g)counts.set(g,(counts.get(g)||0)+1)}return [...counts.entries()].filter(([,n])=>n>=4).sort((a,b)=>b[1]-a[1]).slice(0,28).map(([name,count])=>({id:`cat:${kind}:${encodeURIComponent(name)}`,label:name,group:label,poster:true,category:true,description:`${count.toLocaleString()} titles from your provider`}))};
  return [...make('movie','Provider Movie Categories'),...make('series','Provider TV Categories')];
}
function homeRowDef(id){
  if(String(id).startsWith('custom:')){
    const uid=String(id).slice(7),row=state.mdblistRows.find(x=>String(x.uid)===uid);
    return row?{id,label:row.name||'MDBList',group:'Custom MDBList',poster:true,custom:true,description:'Auto-refreshing MDBList row matched to your provider'}:null;
  }
  if(String(id).startsWith('cat:')){const parts=String(id).split(':');const kind=parts[1],name=decodeURIComponent(parts.slice(2).join(':'));return {id,label:name,group:kind==='movie'?'Provider Movie Categories':'Provider TV Categories',poster:true,category:true,description:`${items(kind).filter(x=>x.group===name).length.toLocaleString()} titles from your provider`};}
  return HOME_ROW_MAP.get(id)||null;
}
function allHomeRowDefs(){return [...HOME_ROW_DEFS,...providerCategoryDefs(),...state.mdblistRows.map(r=>homeRowDef(`custom:${r.uid}`)).filter(Boolean)]}
function selectedHomeRows(){return state.settings.homeRows.map(homeRowDef).filter(Boolean)}
function mediaSearchText(item){return `${item?.genre||''} ${item?.group||''} ${item?.name||''}`.toLowerCase()}
function yearNumber(item){const m=String(item?.year||item?.name||'').match(/(?:19|20)\d{2}/);return m?Number(m[0]):0}
function ratingNumber(item){const n=parseFloat(String(item?.rating||'').replace(',','.'));return Number.isFinite(n)?n:0}
function stableDailyOrder(list,key=''){const day=Math.floor(Date.now()/86400000);return [...list].sort((a,b)=>Math.abs(hash(`${day}|${key}|${a.id}`))-Math.abs(hash(`${day}|${key}|${b.id}`)))}
function localHomeRowItems(id){
  const movies=items('movie'),shows=items('series'),live=items('live');
  const filter=(arr,words)=>stableDailyOrder(arr.filter(x=>words.some(w=>mediaSearchText(x).includes(w))),id);
  if(id==='continue')return continueItems();
  if(id==='mylist')return listItems();
  if(id==='live-now')return live;
  if(id==='movies')return movies;
  if(id==='shows')return shows;
  if(id==='new-movies')return [...movies].sort((a,b)=>yearNumber(b)-yearNumber(a)||Math.abs(hash(a.id))-Math.abs(hash(b.id)));
  if(id==='new-shows')return [...shows].sort((a,b)=>yearNumber(b)-yearNumber(a)||Math.abs(hash(a.id))-Math.abs(hash(b.id)));
  if(id==='top-rated-movies')return [...movies].filter(x=>ratingNumber(x)>0).sort((a,b)=>ratingNumber(b)-ratingNumber(a));
  if(id==='top-rated-shows')return [...shows].filter(x=>ratingNumber(x)>0).sort((a,b)=>ratingNumber(b)-ratingNumber(a));
  if(id==='action-movies')return filter(movies,['action']);
  if(id==='comedy-movies')return filter(movies,['comedy']);
  if(id==='drama-movies')return filter(movies,['drama']);
  if(id==='horror-movies')return filter(movies,['horror']);
  if(id==='thriller-movies')return filter(movies,['thriller','suspense']);
  if(id==='scifi-movies')return filter(movies,['sci-fi','sci fi','science fiction','fantasy']);
  if(id==='family-movies')return filter(movies,['family','kids','children']);
  if(id==='animation-movies')return filter(movies,['animation','animated','anime']);
  if(id==='romance-movies')return filter(movies,['romance','romantic']);
  if(id==='adventure-movies')return filter(movies,['adventure']);
  if(id==='fantasy-movies')return filter(movies,['fantasy']);
  if(id==='mystery-movies')return filter(movies,['mystery']);
  if(id==='western-movies')return filter(movies,['western']);
  if(id==='war-movies')return filter(movies,['war','military']);
  if(id==='music-movies')return filter(movies,['music','musical']);
  if(id==='drama-shows')return filter(shows,['drama']);
  if(id==='crime-shows')return filter(shows,['crime','detective']);
  if(id==='comedy-shows')return filter(shows,['comedy','sitcom']);
  if(id==='reality-shows')return filter(shows,['reality']);
  if(id==='action-shows')return filter(shows,['action','adventure']);
  if(id==='scifi-shows')return filter(shows,['sci-fi','sci fi','science fiction','fantasy']);
  if(id==='mystery-shows')return filter(shows,['mystery','detective']);
  if(id==='thriller-shows')return filter(shows,['thriller','suspense']);
  if(id==='animation-shows')return filter(shows,['animation','animated','anime']);
  if(id==='family-shows')return filter(shows,['family','kids','children']);
  if(id==='documentary')return stableDailyOrder([...movies,...shows].filter(x=>['documentary','docuseries'].some(w=>mediaSearchText(x).includes(w))),id);
  return [];
}
function cachedWebRowItems(id){const cache=state.webDiscovery?.[id];return (cache?.itemIds||[]).map(savedItem).filter(Boolean)}
function customHomeRowItems(id){const uid=String(id).slice(7),row=state.mdblistRows.find(x=>String(x.uid)===uid);return row?.items||[]}
function homeRowItems(id){if(WEB_ROW_IDS.has(id))return cachedWebRowItems(id);if(String(id).startsWith('custom:'))return customHomeRowItems(id);if(String(id).startsWith('cat:')){const parts=String(id).split(':'),kind=parts[1],name=decodeURIComponent(parts.slice(2).join(':'));return stableDailyOrder(items(kind).filter(x=>x.group===name),id)}return localHomeRowItems(id)}
function relativeRefreshTime(ts){if(!ts)return'Not refreshed yet';const mins=Math.max(0,Math.floor((Date.now()-ts)/60000));if(mins<1)return'Updated just now';if(mins<60)return`Updated ${mins}m ago`;const hrs=Math.floor(mins/60);if(hrs<24)return`Updated ${hrs}h ago`;return`Updated ${Math.floor(hrs/24)}d ago`}
function discoveryMeta(id,data){
  if(WEB_ROW_IDS.has(id)){const c=state.webDiscovery?.[id];return c?`${relativeRefreshTime(c.updatedAt)} · ${data.length} available from current chart`:'Waiting for web discovery refresh';}
  if(String(id).startsWith('custom:')){const r=state.mdblistRows.find(x=>`custom:${x.uid}`===id);return `${relativeRefreshTime(r?.updatedAt)} · ${data.length} available`;}
  if(id==='live-now')return`${data.length.toLocaleString()} channels`;
  if(id==='continue')return`${data.length} recent`;
  if(id==='mylist')return`${data.length} saved`;
  return`${data.length.toLocaleString()} available`;
}
async function fetchBuiltInDiscovery(id,apiKey){
  const mergeUnique=(a,b)=>[...new Map([...a,...b].map(x=>[x.id,x])).values()].slice(0,20);
  if(id==='top20-movies'){
    let primary=[];try{const payload=await getMDBListOfficialItems({apiKey,slug:'movies/popular'});primary=matchMDBListToCatalog(payload,state.catalog,{limit:20,mediaType:'movie'})}catch{}
    if(primary.length<20){const chart=await getMDBListStreamingChart({apiKey,mediaType:'movie'});primary=mergeUnique(primary,matchMDBListToCatalog(chart,state.catalog,{limit:20,mediaType:'movie'}));}
    return primary;
  }
  if(id==='top20-shows'){
    let primary=[];try{const payload=await getMDBListOfficialItems({apiKey,slug:'shows/popular'});primary=matchMDBListToCatalog(payload,state.catalog,{limit:20,mediaType:'show'})}catch{}
    if(primary.length<20){const chart=await getMDBListStreamingChart({apiKey,mediaType:'show'});primary=mergeUnique(primary,matchMDBListToCatalog(chart,state.catalog,{limit:20,mediaType:'show'}));}
    return primary;
  }
  if(id==='trending-movies'){const payload=await getMDBListStreamingChart({apiKey,mediaType:'movie'});return matchMDBListToCatalog(payload,state.catalog,{limit:20,mediaType:'movie'});}
  if(id==='trending-shows'){const payload=await getMDBListStreamingChart({apiKey,mediaType:'show'});return matchMDBListToCatalog(payload,state.catalog,{limit:20,mediaType:'show'});}
  return[];
}
async function refreshDiscoveryRows(force=false){
  const apiKey=String(state.settings.mdblistApiKey||'').trim();if(discoveryRefreshing||!apiKey||!state.catalog.length)return;
  const wanted=[...new Set([...state.settings.homeRows.filter(id=>WEB_ROW_IDS.has(id)),'top20-movies','top20-shows'])];
  const custom=state.settings.homeRows.filter(id=>String(id).startsWith('custom:'));
  const now=Date.now(),staleIds=wanted.filter(id=>force||!state.webDiscovery?.[id]?.updatedAt||now-state.webDiscovery[id].updatedAt>DISCOVERY_REFRESH_MS);
  const staleCustom=custom.map(id=>state.mdblistRows.find(r=>`custom:${r.uid}`===id)).filter(r=>r?.source&&(force||!r.updatedAt||now-r.updatedAt>DISCOVERY_REFRESH_MS));
  if(!staleIds.length&&!staleCustom.length)return;
  discoveryRefreshing=true;discoveryMessage='Refreshing web discovery…';if(state.page==='home')render();
  try{
    for(const id of staleIds){try{const matched=await fetchBuiltInDiscovery(id,apiKey);state.webDiscovery[id]={itemIds:matched.map(x=>x.id),updatedAt:Date.now(),error:''};}catch(err){state.webDiscovery[id]={...(state.webDiscovery[id]||{}),updatedAt:Date.now(),error:err.message||String(err)};}}
    for(const row of staleCustom){try{const payload=await getMDBListItems({apiKey,listId:row.source.listId,username:row.source.username,listName:row.source.listName});row.items=matchMDBListToCatalog(payload,state.catalog);row.updatedAt=Date.now();row.error='';}catch(err){row.updatedAt=Date.now();row.error=err.message||String(err);}}
    persist(true);discoveryMessage='Discovery updated';
  }finally{discoveryRefreshing=false;if(state.page==='home'||modal==='homeRows')render();setTimeout(()=>{discoveryMessage=''},1800)}
}
function card(item,poster=false,opts={}){
  if(!item)return'';
  item=visualItem(item);
  const fallback=item.demoColor||`linear-gradient(135deg,hsl(${Math.abs(hash(item.name))%360} 44% 34%),#080b12)`;
  const sub=item.kind==='live'?(item.group||'Live TV'):[item.year,item.rating?`★ ${item.rating}`:'',item.kind==='episode'&&item.season?`S${item.season} E${item.episodeNum||''}`:''].filter(Boolean).join('  ·  ');
  const art=item.logo?`<img class="card-art" data-swoop-art="${esc(item.logo)}" alt="" loading="lazy">`:'';
  const liveBadge=item.kind==='live'?`<div class="badge"><span class="live-dot"></span>LIVE</div>`:'';
  const action=item.kind==='live'||item.kind==='episode'?'data-play':'data-detail';
  const hoverAction=item.kind==='live'?'Play channel':item.kind==='episode'?'Play episode':'More info';
  const saved=isInMyList(item)?'<span class="card-saved">✓ MY LIST</span>':'';
  const progress=Number.isFinite(Number(opts.progress))?Math.max(0,Math.min(100,Number(opts.progress))):null;
  const rank=Number.isFinite(Number(opts.rank))&&Number(opts.rank)>0?Number(opts.rank):null;
  const rankBadge=rank?`<div class="rank-badge"><span>${rank}</span></div>`:'';
  return `<button class="card ${poster?'poster':'landscape'} ${item.kind==='live'?'live-card':''} ${rank?'ranked-card':''}" ${action}="${esc(item.id)}" style="--card-bg:${fallback}" aria-label="${esc(item.name)}">
    <div class="card-bg"></div>${art}<div class="card-shade"></div>${rankBadge}${liveBadge}${saved}
    <div class="card-copy"><div class="card-title">${esc(item.name)}</div><div class="card-sub">${esc(sub)}</div><div class="card-hover"><span class="card-hover-icon">${item.kind==='live'||item.kind==='episode'?'▶':'ⓘ'}</span><span>${hoverAction}</span></div></div>
    ${progress!==null?`<div class="progress"><i style="width:${progress}%"></i></div>`:''}</button>`;
}
function nav(){
  const desktop=[['home','Home'],['live','Live TV'],['guide','Guide'],['movies','Movies'],['series','TV Shows'],['mylist','My List']];
  const mobile=[['home','⌂','Home'],['live','◉','Live'],['guide','▤','Guide'],['movies','▰','Movies'],['series','▦','Shows']];
  return `<header class="topbar"><button class="brand" data-page="home" aria-label="Swoop TV Home"><i class="brand-mark">S</i><span>SWOOP</span><b>TV</b></button>
  <nav class="desktop-nav">${desktop.map(([p,label])=>`<button class="nav-btn ${state.page===p?'active':''}" data-page="${p}">${label}</button>`).join('')}</nav>
  <div class="top-actions"><button class="icon-btn search-action" data-page="search" aria-label="Search">⌕</button><button class="top-provider" data-modal="provider">＋ Add Provider</button><button class="profile-btn" data-page="settings" aria-label="Settings">S</button></div></header>
  <nav class="bottom-nav">${mobile.map(([p,icon,label])=>`<button class="${state.page===p?'active':''}" data-page="${p}"><span>${icon}</span>${label}</button>`).join('')}</nav>`;
}
function rail(title,data,poster=false,meta='',opts={}){
  if(!data.length)return'';
  return `<section class="section ${poster?'poster-section':'landscape-section'} ${opts.ranked?'ranked-section':''}"><div class="section-head"><div><h2>${esc(title)}</h2>${meta?`<span class="section-meta">${esc(meta)}</span>`:''}</div>${opts.page?`<button class="section-link" data-page="${opts.page}">Explore all →</button>`:'<span class="rail-arrow">›</span>'}</div><div class="rail">${data.map((x,i)=>card(x,poster,{progress:continueEntry(x.id)?.progress,rank:opts.ranked?i+1:null})).join('')}</div></section>`;
}
function fallbackFeatureItem(){
  const cat=activeCatalog();
  const recent=state.continueWatching.map(x=>x.item||cat.find(i=>i.id===x.id)).find(Boolean);
  const cw=recent?.kind==='episode'?cat.find(x=>x.id===recent.parentSeriesId):recent;
  return cw||cat.find(x=>x.kind==='movie'&&(x.backdrop||x.logo))||cat.find(x=>x.kind==='series'&&(x.backdrop||x.logo))||cat.find(x=>x.kind==='movie')||cat.find(x=>x.kind==='series')||cat.find(x=>x.kind==='live')||null;
}
function heroTopFive(kind){
  const webId=kind==='movie'?'top20-movies':'top20-shows';
  const pool=[...cachedWebRowItems(webId).filter(x=>x?.kind===kind)];
  const fallbackIds=kind==='movie'?['trending-movies','top-rated-movies','new-movies']:['trending-shows','top-rated-shows','new-shows'];
  for(const id of fallbackIds){
    const source=WEB_ROW_IDS.has(id)?cachedWebRowItems(id):localHomeRowItems(id);
    for(const item of source){if(item?.kind===kind&&!pool.some(x=>x.id===item.id))pool.push(item);if(pool.length>=5)break}
    if(pool.length>=5)break;
  }
  if(pool.length<5){for(const item of items(kind)){if(!pool.some(x=>x.id===item.id))pool.push(item);if(pool.length>=5)break}}
  return pool.slice(0,5).map((item,index)=>({...item,_heroRank:index+1,_heroFeed:kind==='movie'?'TOP 5 MOVIE':'TOP 5 TV SHOW'}));
}
function heroCandidates(){
  const movies=heroTopFive('movie'),shows=heroTopFive('series'),out=[];
  for(let i=0;i<5;i++){if(movies[i])out.push(movies[i]);if(shows[i])out.push(shows[i])}
  if(!out.length){const fallback=fallbackFeatureItem();if(fallback)out.push(fallback)}
  return out;
}
function featureItem(){const pool=heroCandidates();if(!pool.length)return null;heroRotationIndex=((heroRotationIndex%pool.length)+pool.length)%pool.length;return pool[heroRotationIndex]}
function hero(feature,providerName,rotation={}){
  if(!feature)return'';
  feature=visualItem(feature);
  const isLive=feature.kind==='live',isSeries=feature.kind==='series';
  const typeLabel=feature._heroFeed?`${feature._heroFeed}${feature._heroRank?` · #${feature._heroRank}`:''}`:isLive?'LIVE TV':feature.kind==='movie'?'FEATURED MOVIE':'FEATURED SERIES';
  const meta=[feature.year,feature.rating?`★ ${feature.rating}`:'',feature.group].filter(Boolean);
  const backdrop=feature.backdrop||feature.logo;
  const artClass=feature.backdrop?'hero-backdrop hero-backdrop-clean':'hero-backdrop hero-backdrop-poster';
  const art=backdrop?`<img class="${artClass}" data-swoop-art="${esc(backdrop)}" alt="" loading="eager">`:'';
  const poster=feature.logo?`<img class="hero-poster" data-swoop-art="${esc(feature.logo)}" alt="" loading="eager">`:'';
  const mainAction=isSeries?`<button class="btn play-btn" data-detail="${esc(feature.id)}"><span>▶</span> View Series</button>`:`<button class="btn play-btn" data-play="${esc(feature.id)}"><span>▶</span> Play</button>`;
  const total=Number(rotation.total||0),current=Number(rotation.index||0);
  const rotationControls=total>1?`<div class="hero-rotation-controls"><button data-hero-step="-1" aria-label="Previous featured title">‹</button><div class="hero-rotation-dots">${Array.from({length:total},(_,i)=>`<button class="${i===current?'active':''}" data-hero-go="${i}" aria-label="Show featured title ${i+1}"></button>`).join('')}</div><button data-hero-step="1" aria-label="Next featured title">›</button></div>`:'';
  return `<section class="hero hero-rotating" data-home-hero><div class="hero-media">${art}${poster}<div class="hero-fallback" style="--hero-fallback:${feature.demoColor||'linear-gradient(135deg,#1d2a44,#080a0e)'}"></div></div><div class="hero-vignette"></div>
    <div class="hero-content"><div class="hero-brandline"><span class="swoop-mini">S</span><span>${esc(typeLabel)}</span></div>${feature.titleLogo?`<img class="hero-title-logo" data-swoop-art="${esc(feature.titleLogo)}" alt="${esc(feature.name)}">`:`<h1>${esc(feature.name)}</h1>`}<div class="hero-meta">${meta.map(x=>`<span>${esc(x)}</span>`).join('')}<span class="hero-source">${esc(providerName)}</span></div><p>${feature.plot?esc(feature.plot):isLive?`Watch ${esc(feature.name)} live from your connected TV provider.`:`Discover ${esc(feature.name)} in your connected ${esc(providerName)} library.`}</p><div class="cta-row hero-actions">${mainAction}${!isLive?`<button class="btn secondary hero-secondary" data-detail="${esc(feature.id)}"><span>ⓘ</span> More Info</button>`:`<button class="btn secondary hero-secondary" data-page="guide"><span>▤</span> TV Guide</button>`}</div></div>${rotationControls}
  </section>`;
}
function listItems(){return state.myList.map(savedItem).filter(Boolean)}
function continueItems(){return [...state.continueWatching].sort((a,b)=>(b.lastPlayed||0)-(a.lastPlayed||0)).map(x=>x.item||savedItem(x.id)).filter(Boolean)}
function home(){
  const cat=activeCatalog(),live=cat.filter(x=>x.kind==='live'),movies=cat.filter(x=>x.kind==='movie'),shows=cat.filter(x=>x.kind==='series');
  const providerName=state.provider?.name||'Demo Library',heroPool=heroCandidates();
  if(heroPool.length)heroRotationIndex=((heroRotationIndex%heroPool.length)+heroPool.length)%heroPool.length;
  const feature=heroPool[heroRotationIndex]||fallbackFeatureItem();
  const rows=selectedHomeRows();
  const rendered=rows.map(def=>{const data=homeRowItems(def.id);if(!data.length)return'';const limit=def.ranked?20:(def.id==='live-now'?14:18);return rail(def.label,data.slice(0,limit),def.poster,discoveryMeta(def.id,data),{page:def.page,ranked:def.ranked})}).join('');
  const needsWeb=rows.some(r=>r.web||r.custom),hasKey=Boolean(String(state.settings.mdblistApiKey||'').trim());
  const discoveryNote=needsWeb&&!hasKey?`<section class="web-discovery-callout"><div><span class="eyebrow">LIVE WEB DISCOVERY</span><h2>Turn on constantly changing rows</h2><p>Add your MDBList API key once and Swoop will refresh Top 20, Trending and your custom web rows automatically.</p></div><button class="btn accent" data-modal="homeRows">Set up Discovery</button></section>`:'';
  const status=discoveryRefreshing?'Refreshing web rows…':discoveryMessage||(hasKey?`Web rows refresh automatically every ${Math.round(DISCOVERY_REFRESH_MS/3600000)} hours`:'Customize which rows appear below');
  return `<main class="home-main">${hero(feature,providerName,{total:heroPool.length,index:heroRotationIndex})}<div class="content home-content"><div class="library-strip home-library-strip"><div><span class="library-dot"></span><strong>${state.catalog.length?esc(providerName):'Demo Library'}</strong><span>${live.length.toLocaleString()} live · ${movies.length.toLocaleString()} movies · ${shows.length.toLocaleString()} shows</span></div><div class="home-library-actions"><span class="discovery-status ${discoveryRefreshing?'busy':''}">${esc(status)}</span><button class="library-manage" data-modal="homeRows">☰ Customize Home</button><button class="library-manage" data-modal="provider">${state.catalog.length?'Provider':'Connect Provider'} →</button></div></div>
    ${discoveryNote}${rendered||`<section class="web-discovery-callout"><div><span class="eyebrow">YOUR HOME</span><h2>Choose what Swoop shows here</h2><p>Select Top 20, Trending, Live TV, genres and more. You can change the row order any time.</p></div><button class="btn accent" data-modal="homeRows">Customize Home</button></section>`}
  </div></main>`;
}
function page(kind,title){
  const arr=items(kind),limit=viewLimits[kind]||120,shown=arr.slice(0,limit),providerName=state.provider?.name||'Demo Library';
  const leadRaw=arr.find(x=>visualItem(x).backdrop||visualItem(x).logo)||arr[0];
  const lead=visualItem(leadRaw);
  const groups=[...new Set(arr.map(x=>x.group).filter(Boolean))].slice(0,10);
  const leadBackdrop=lead?(lead.backdrop||lead.logo):'';
  const leadArt=leadBackdrop?`<img data-swoop-art="${esc(leadBackdrop)}" class="page-hero-art page-hero-backdrop" alt="" loading="eager">`:'';
  const cards=shown.map(x=>card(x,kind!=='live')).join('');
  const leadAction=lead?(kind==='live'?`<button class="btn play-btn page-feature-play" data-play="${esc(lead.id)}">▶ Play ${esc(lead.name)}</button>`:`<button class="btn play-btn page-feature-play" data-detail="${esc(lead.id)}">ⓘ Explore ${esc(lead.name)}</button>`):'';
  return `<main class="page cinematic-page"><section class="page-hero ${kind==='live'?'live-page-hero':''}">${leadArt}<div class="page-hero-shade"></div><div class="page-hero-copy"><div class="eyebrow">${kind==='live'?'WATCH NOW':kind==='movie'?'ON DEMAND':'BINGE-WORTHY'}</div><h1>${esc(title)}</h1><p>${state.catalog.length?`${arr.length.toLocaleString()} ${kind==='live'?'channels':kind==='movie'?'movies':'series'} from ${esc(providerName)}.`:'Demo content — connect a provider to populate your library.'}</p><div class="cta-row">${leadAction}${kind==='live'?'<button class="btn secondary" data-page="guide">▤ Open TV Guide</button>':''}</div></div></section>
    <div class="page-content"><div class="page-toolbar"><div class="category-pills">${groups.map(g=>`<button data-search-term="${esc(g)}">${esc(g)}</button>`).join('')}</div><button class="btn secondary compact-btn" data-modal="provider">＋ Provider</button></div>${arr.length?`<div class="content-grid ${kind==='live'?'live-content-grid':'poster-content-grid'}">${cards}</div>${shown.length<arr.length?`<div class="load-more-wrap"><button class="btn secondary" data-load-more="${kind}">Load more · showing ${shown.length.toLocaleString()} of ${arr.length.toLocaleString()}</button></div>`:''}`:empty('No content yet','Connect a TV provider to populate this section.')}</div></main>`;
}
function myListPage(){
  const arr=listItems();
  return `<main class="page mylist-page"><section class="collection-hero"><div class="eyebrow">YOUR COLLECTION</div><h1>My List</h1><p>Everything you saved for later, in one place.</p><div class="collection-count">${arr.length.toLocaleString()} ${arr.length===1?'title':'titles'}</div></section><div class="page-content">${arr.length?`<div class="content-grid poster-content-grid">${arr.map(x=>card(x,x.kind!=='live')).join('')}</div>`:empty('Your list is empty','Open a movie or TV show and choose Add to My List.')}</div></main>`;
}
function empty(title,copy){return `<div class="empty"><div class="empty-mark">S</div><h3>${esc(title)}</h3><p>${esc(copy)}</p><button class="btn accent" data-modal="provider">Add TV Provider</button></div>`}
function searchPage(){return `<main class="page search-page"><div class="search-hero"><div class="eyebrow">FIND SOMETHING GREAT</div><h1>Search Swoop</h1><div class="searchbox searchbox-large"><span>⌕</span><input id="searchInput" autofocus placeholder="Movies, TV shows, live channels…" /></div></div><div class="page-content"><div id="searchResults" class="content-grid search-results"></div></div></main>`}
function settingsPage(){
  const counts={live:items('live').length,movie:items('movie').length,series:items('series').length};
  return `<main class="page settings-page"><div class="settings-hero"><div class="eyebrow">SWOOP TV</div><h1>Settings</h1><p>Manage your provider, discovery rows, saved titles and playback environment.</p></div><div class="page-content settings-list">
  <section class="setting-card setting-card-feature"><div class="setting-icon">TV</div><div class="setting-main"><h3>TV Provider</h3><p>${esc(state.provider?.name||'Demo mode')}</p><div class="setting-stats"><span><strong>${counts.live.toLocaleString()}</strong> Live</span><span><strong>${counts.movie.toLocaleString()}</strong> Movies</span><span><strong>${counts.series.toLocaleString()}</strong> Shows</span></div><div class="cta-row"><button class="btn secondary" data-modal="provider">Manage Provider</button>${state.catalog.length?'<button class="btn danger" data-action="disconnect">Disconnect</button>':''}</div></div></section>
  <section class="setting-card"><div class="setting-icon">＋</div><div class="setting-main"><h3>My List & Continue Watching</h3><p>${state.myList.length.toLocaleString()} saved · ${state.continueWatching.length.toLocaleString()} recently watched.</p><div class="cta-row"><button class="btn secondary" data-page="mylist">Open My List</button>${state.continueWatching.length?'<button class="btn secondary" data-action="clear-history">Clear Continue Watching</button>':''}</div></div></section>
  <section class="setting-card"><div class="setting-icon">ROW</div><div class="setting-main"><h3>Home & Web Discovery</h3><p>${state.settings.homeRows.length} Home rows selected · ${state.settings.mdblistApiKey?'MDBList connected':'MDBList key not configured'}. Top 20 and Trending rows refresh automatically when enabled.</p><div class="cta-row"><button class="btn accent" data-modal="homeRows">Customize Home</button><button class="btn secondary" data-modal="mdblist">Add Custom MDBList Row</button></div>${state.mdblistRows.length?state.mdblistRows.map((r,i)=>`<div class="kv"><span>${esc(r.name)}</span><span>${r.items.length} matched · ${esc(relativeRefreshTime(r.updatedAt))} · <button class="nav-btn" data-remove-row="${i}">Remove</button></span></div>`).join(''):''}</div></section>
  <section class="setting-card"><div class="setting-icon">ART</div><div class="setting-main"><h3>Cinematic Artwork</h3><p>Swoop uses provider artwork first and can enhance movie/TV presentation with TMDb posters and full-width backdrops through the owner-managed Swoop metadata service. End users do not need a TMDb key.</p><div class="kv"><span>Metadata service</span><span>${esc(metadataServiceUrl(state.settings))}</span></div><div class="kv"><span>Home background</span><span>${esc(validHex(state.settings.backgroundColor))}</span></div><div class="cta-row"><button class="btn secondary" data-modal="homeRows">Appearance & Home Rows</button></div></div></section>
  ${NATIVE_WINDOWS?`<section class="setting-card native-ready"><div class="setting-icon">▶</div><div class="setting-main"><h3>Windows Native Playback</h3><p>Native bridge ready · mpv 0.41.0. Live TV and VOD play outside the browser sandbox for broader IPTV compatibility.</p></div></section>`:`<section class="setting-card"><div class="setting-icon">↗</div><div class="setting-main"><h3>Browser Connection Helper</h3><p>${state.settings.xtreamRelayUrl?esc(state.settings.xtreamRelayUrl):'Not configured'} · Used only for Xtream API/catalog requests when the browser blocks direct access.</p></div></section>`}
  <section class="setting-card"><div class="setting-icon">◈</div><div class="setting-main"><h3>Privacy & Architecture</h3><p>Swoop TV does not bundle content. ${NATIVE_WINDOWS?'The Windows build uses a loopback-only local bridge for provider API calls and native playback.':'Imported streams play directly from your provider whenever the browser/device supports them.'} Xtream stream URLs can contain provider credentials and are stored locally with the catalog.</p></div></section>
  </div></main>`;
}

function guidePage(){
  const all=items('live'),channels=all.slice(0,guideLimit),hours=3,slots=Array.from({length:7},(_,i)=>new Date(guideStart+i*30*60000));
  const providerGuide=state.provider?.type==='xtream'?'Xtream EPG':state.provider?.epgUrl?'XMLTV guide':'No EPG source configured';
  return `<main class="page guide-page"><section class="guide-hero"><div><div class="eyebrow">LIVE TV</div><h1>TV Guide</h1><p>${esc(providerGuide)} · ${all.length.toLocaleString()} channels</p></div><div class="guide-now"><span>NOW</span><strong>${new Date().toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}</strong></div></section>
  <div class="guide-shell"><div class="guide-toolbar"><div class="guide-date"><strong>${new Date().toLocaleDateString([],{weekday:'long'})}</strong><span>${new Date().toLocaleDateString([],{day:'numeric',month:'long'})}</span></div><button class="btn secondary" data-guide-now>Jump to now</button></div>
  ${guideError?`<div class="guide-alert">${esc(guideError)}</div>`:''}
  <div class="guide-grid"><div class="guide-header"><div class="guide-channel-head">Channels</div><div class="guide-times">${slots.map(d=>`<span>${d.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}</span>`).join('')}</div></div>
  <div class="guide-body">${channels.map(ch=>guideRow(ch,hours)).join('')}</div></div>
  ${channels.length<all.length?`<div class="load-more-wrap"><button class="btn secondary" data-guide-more>Load more channels · showing ${channels.length.toLocaleString()} of ${all.length.toLocaleString()}</button></div>`:''}
  </div></main>`;
}
function guideRow(channel,hours=3){
  const cached=epgCache.get(channel.id);
  return `<div class="guide-row" data-guide-row="${esc(channel.id)}"><button class="guide-channel" data-play="${esc(channel.id)}">${channel.logo?`<img data-swoop-art="${esc(channel.logo)}" alt="">`:'<span class="guide-logo-fallback">TV</span>'}<span><strong>${esc(channel.name)}</strong><small>${esc(channel.group||'Live TV')}</small></span><b>▶</b></button><div class="guide-programs">${cached?guideProgramsHtml(channel,cached.list,hours):`<div class="guide-loading"><i></i><span>${guideLoading?'Loading programme guide…':'Programme guide will load here'}</span></div>`}</div></div>`;
}
function guideProgramsHtml(channel,list=[],hours=3){
  const start=guideStart,end=start+hours*3600000;
  const blocks=[];
  for(const p of list){
    const ps=Number(p.startMs),pe=Number(p.endMs);
    if(!Number.isFinite(ps)||!Number.isFinite(pe)||pe<=start||ps>=end)continue;
    const clippedStart=Math.max(start,ps),clippedEnd=Math.min(end,pe);
    const left=((clippedStart-start)/(end-start))*100,width=Math.max(5,((clippedEnd-clippedStart)/(end-start))*100);
    const now=Date.now()>=ps&&Date.now()<pe;
    blocks.push(`<button class="guide-program ${now?'current':''}" data-play="${esc(channel.id)}" style="left:${left.toFixed(3)}%;width:${width.toFixed(3)}%" title="${esc(p.title)}"><strong>${esc(p.title||'Programme')}</strong><span>${new Date(ps).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}${now?' · NOW':''}</span></button>`);
  }
  if(!blocks.length)return `<button class="guide-program guide-program-empty" data-play="${esc(channel.id)}" style="left:0;width:100%"><strong>${list.length?'No programme in this window':'No programme information'}</strong><span>Watch ${esc(channel.name)}</span></button>`;
  const nowLeft=Math.max(0,Math.min(100,((Date.now()-start)/(end-start))*100));
  return `${blocks.join('')}${Date.now()>=start&&Date.now()<=end?`<i class="guide-now-line" style="left:${nowLeft}%"></i>`:''}`;
}
function decodeMaybeBase64(value=''){
  const text=String(value||'');
  if(!text)return'';
  try{if(/^[A-Za-z0-9+/=]+$/.test(text)&&text.length%4===0){const decoded=decodeURIComponent(Array.from(atob(text),c=>'%'+c.charCodeAt(0).toString(16).padStart(2,'0')).join(''));if(decoded&&/[\p{L}\p{N}]/u.test(decoded))return decoded}}catch{}
  return text;
}
function epgTime(entry,key){
  const direct=Number(entry?.[`${key}_timestamp`]||entry?.[key==='start'?'start_timestamp':'stop_timestamp']);
  if(Number.isFinite(direct)&&direct>0)return direct*1000;
  const raw=String(entry?.[key]||entry?.[key==='start'?'start':'end']||'').trim();
  if(!raw)return NaN;
  const parsed=Date.parse(raw.includes('T')?raw:raw.replace(' ','T'));
  return parsed;
}
function normalizeXtreamEpg(payload){
  const list=Array.isArray(payload)?payload:Array.isArray(payload?.epg_listings)?payload.epg_listings:Array.isArray(payload?.epg)?payload.epg:[];
  return list.map(e=>({title:decodeMaybeBase64(e.title||e.name||'Programme'),description:decodeMaybeBase64(e.description||''),startMs:epgTime(e,'start'),endMs:epgTime(e,'end')})).filter(e=>Number.isFinite(e.startMs)&&Number.isFinite(e.endMs));
}
async function loadGuideEpg(){
  if(state.page!=='guide'||guideLoading)return;
  const channels=items('live').slice(0,guideLimit),stale=Date.now()-5*60000;
  if(!channels.length)return;
  guideLoading=true;guideError='';document.querySelectorAll('.guide-loading span').forEach(el=>el.textContent='Loading programme guide…');
  try{
    if(state.provider?.type==='xtream'){
      if(!sessionXtream.server||!sessionXtream.username||!sessionXtream.password){guideError='Reconnect your Xtream provider to refresh programme guide data.';return}
      const pending=channels.filter(ch=>!epgCache.get(ch.id)||epgCache.get(ch.id).loadedAt<stale);
      let cursor=0;
      const worker=async()=>{while(cursor<pending.length){const ch=pending[cursor++];try{const payload=await fetchXtreamShortEpg(sessionXtream,ch.streamId,12);epgCache.set(ch.id,{loadedAt:Date.now(),list:normalizeXtreamEpg(payload)});updateGuideRow(ch)}catch{epgCache.set(ch.id,{loadedAt:Date.now(),list:[]});updateGuideRow(ch)}}};
      await Promise.all(Array.from({length:Math.min(4,pending.length||1)},worker));
    }else if(state.provider?.type==='m3u'&&state.provider?.epgUrl){
      if(!m3uGuideLoaded){const text=NATIVE_WINDOWS?await nativeFetchText(state.provider.epgUrl):await (await fetch(state.provider.epgUrl)).text();const wanted=new Set(channels.map(c=>c.tvgId||c.name).filter(Boolean));const parsed=parseXMLTV(text,wanted);for(const ch of channels){const key=ch.tvgId||ch.name;epgCache.set(ch.id,{loadedAt:Date.now(),list:parsed[key]||[]});updateGuideRow(ch)}m3uGuideLoaded=true}
    }else guideError='This provider does not have an EPG source configured yet.';
  }catch(err){guideError=err.message||'Could not load programme guide data.'}
  finally{guideLoading=false;const alert=document.querySelector('.guide-alert');if(guideError&&!alert){const shell=document.querySelector('.guide-shell');if(shell)shell.insertAdjacentHTML('afterbegin',`<div class="guide-alert">${esc(guideError)}</div>`)} }
}
function updateGuideRow(ch){const row=[...document.querySelectorAll('[data-guide-row]')].find(x=>x.dataset.guideRow===ch.id);if(!row)return;const box=row.querySelector('.guide-programs');const cached=epgCache.get(ch.id);if(box&&cached)box.innerHTML=guideProgramsHtml(ch,cached.list,3);hydrateArtwork(row)}


function bindHeroControls(root=document){
  root.querySelectorAll('[data-hero-step]').forEach(el=>el.onclick=()=>{const pool=heroCandidates();if(!pool.length)return;heroRotationIndex=(heroRotationIndex+Number(el.dataset.heroStep||1)+pool.length)%pool.length;replaceHomeHero()});
  root.querySelectorAll('[data-hero-go]').forEach(el=>el.onclick=()=>{const pool=heroCandidates();if(!pool.length)return;heroRotationIndex=Math.max(0,Math.min(pool.length-1,Number(el.dataset.heroGo||0)));replaceHomeHero()});
}
function replaceHomeHero(){
  if(state.page!=='home'||modal||detailItem||playerItem)return;
  const current=document.querySelector('[data-home-hero]'),pool=heroCandidates();if(!current||!pool.length)return;
  heroRotationIndex=((heroRotationIndex%pool.length)+pool.length)%pool.length;
  const wrap=document.createElement('div');wrap.innerHTML=hero(pool[heroRotationIndex],state.provider?.name||'Demo Library',{total:pool.length,index:heroRotationIndex});
  const next=wrap.firstElementChild;if(!next)return;current.replaceWith(next);hydrateArtwork(next);bindDynamicCards(next);bindHeroControls(next);
  const item=pool[heroRotationIndex];if(item&&['movie','series'].includes(item.kind))enrichItemMetadata(item,{rerender:false});
}
function scheduleHeroRotation(){
  if(heroRotationTimer){clearInterval(heroRotationTimer);heroRotationTimer=null}
  if(state.page!=='home'||heroCandidates().length<2)return;
  heroRotationTimer=setInterval(()=>{if(document.hidden||state.page!=='home'||modal||detailItem||playerItem)return;const pool=heroCandidates();if(pool.length<2)return;heroRotationIndex=(heroRotationIndex+1)%pool.length;replaceHomeHero()},HERO_ROTATION_MS);
}

function restoringPage(){
  return `<main class="page restoring-page"><div class="restore-card"><div class="provider-spinner" aria-hidden="true"></div><div class="eyebrow">RESTORING SWOOP</div><h1>Loading your saved TV library…</h1><p>Your provider details are saved. Swoop is restoring the large channel, movie and TV-show catalog from durable device storage.</p></div></main>`;
}

function render(){
  applyTheme();
  let body;if(storageRestoring)body=restoringPage();else if(state.page==='home')body=home();else if(state.page==='live')body=page('live','Live TV');else if(state.page==='guide')body=guidePage();else if(state.page==='movies')body=page('movie','Movies');else if(state.page==='series')body=page('series','TV Shows');else if(state.page==='mylist')body=myListPage();else if(state.page==='search')body=searchPage();else body=settingsPage();
  $app.innerHTML=`<div class="app-shell">${nav()}${body}${modal?modalHtml():''}${detailItem?detailHtml():''}${playerItem?playerHtml():''}</div>`;bind();bindHeroControls(document);if(state.page==='search')runSearch('');hydrateArtwork();if(state.page==='guide')setTimeout(loadGuideEpg,0);if(state.page==='home'&&state.catalog.length&&state.settings.mdblistApiKey)setTimeout(()=>refreshDiscoveryRows(false),0);if(state.catalog.length)setTimeout(scheduleMetadataEnrichment,80);scheduleHeroRotation();
}

function providerModal(){
  const profile=savedProviderProfile||{};
  const xtreamSaved=profile.type==='xtream'?profile:{};
  const m3uSaved=profile.type==='m3u'?profile:{};
  const connected=state.provider?.name?`<div class="provider-current"><span class="provider-current-dot"></span><div><strong>${esc(state.provider.name)}</strong><span>${state.provider.type==='xtream'?'Xtream Codes':'M3U Playlist'} currently connected</span></div></div>`:'';
  const helper=NATIVE_WINDOWS?`<div class="provider-note native-note"><div class="provider-note-icon">✓</div><div><strong>Windows Native Bridge ready</strong><span>HTTP and HTTPS Xtream servers are supported. No Cloudflare details are needed in this Windows app.</span></div></div>`:`<details class="helper-box compact-helper" ${state.settings.xtreamRelayUrl?'open':''}><summary>Connection Helper <span>only if direct login fails</span></summary><div class="helper-body"><p class="form-hint">Use your Swoop Connection Helper when a working Xtream account is blocked by browser CORS or mixed-content rules. It relays catalog/API requests only, never video.</p><div class="field"><label>Connection Helper URL</label><input name="relayUrl" type="url" value="${esc(state.settings.xtreamRelayUrl||'')}" placeholder="https://your-worker.workers.dev"></div><div class="field"><label>Helper token</label><input name="relayToken" type="password" value="${esc(state.settings.xtreamRelayToken||'')}" autocomplete="off" placeholder="SWOOP_PROXY_TOKEN"></div></div></details>`;
  return `<div class="modal-backdrop" data-close-modal><div class="modal provider-modal" data-modal-card><div class="modal-head provider-modal-head"><div><div class="eyebrow">TV PROVIDER</div><h2>${state.provider?'Manage Provider':'Add Provider'}</h2><p>Choose how your TV service was supplied. Swoop only shows the fields required for that connection type.</p></div><button class="icon-btn" data-close aria-label="Close">✕</button></div><div class="modal-body provider-modal-body">${connected}<div id="providerSetup"><div class="provider-methods" aria-label="Provider type"><button type="button" class="provider-method active" data-provider-tab="xtream"><span class="provider-method-icon">X</span><span><strong>Xtream Codes</strong><small>Server URL + username + password</small></span><span class="provider-method-check">✓</span></button><button type="button" class="provider-method" data-provider-tab="m3u"><span class="provider-method-icon">M3U</span><span><strong>M3U Playlist</strong><small>Playlist URL or local M3U file</small></span><span class="provider-method-check">✓</span></button></div>
    <form id="xtreamForm" class="provider-form"><div class="provider-form-intro"><div><div class="eyebrow">XTREAM CODES</div><h3>Connect your TV service</h3><p>Enter the same Xtream details you use in another IPTV player.</p></div><span class="provider-badge">Recommended</span></div><div class="field"><label>Provider name</label><input name="name" value="${esc(state.provider?.type==='xtream'?state.provider?.name||xtreamSaved.name||'My TV':xtreamSaved.name||'My TV')}" placeholder="My TV" required></div><div class="field"><label>Server URL</label><input name="server" type="url" value="${esc(state.provider?.type==='xtream'?state.provider?.server||xtreamSaved.server||'':xtreamSaved.server||'')}" placeholder="http://provider.example:port" required></div><div class="split"><div class="field"><label>Username</label><input name="username" value="${esc(state.provider?.type==='xtream'?state.provider?.username||xtreamSaved.username||'':xtreamSaved.username||'')}" autocomplete="username" required></div><div class="field"><label>Password</label><input name="password" type="password" value="${esc(state.provider?.type==='xtream'?state.provider?.password||xtreamSaved.password||'':xtreamSaved.password||'')}" autocomplete="current-password" required></div></div>${helper}<label class="remember-row provider-remember"><input type="checkbox" name="remember" ${(state.provider?.username||xtreamSaved.username||!state.provider)?'checked':''}><span><strong>Keep me signed in on this device</strong><small>Swoop saves this provider profile separately from the large TV catalog so a refresh or restart does not clear it.</small></span></label><button class="btn accent provider-primary" type="submit"><span>Connect Xtream</span><span>→</span></button></form>
    <form id="m3uForm" class="provider-form" hidden><div class="provider-form-intro"><div><div class="eyebrow">M3U PLAYLIST</div><h3>Import your playlist</h3><p>Use either a playlist URL or a local M3U/M3U8 file.</p></div></div><div class="field"><label>Provider name</label><input name="name" value="${esc(state.provider?.type==='m3u'?state.provider?.name||m3uSaved.name||'My TV':m3uSaved.name||'My TV')}" placeholder="My TV" required></div><div class="field"><label>M3U playlist URL</label><input name="url" type="url" value="${esc(state.provider?.type==='m3u'?state.provider?.url||m3uSaved.url||'':m3uSaved.url||'')}" placeholder="http://provider.example/get.php?... "></div><div class="provider-or"><span>or</span></div><div class="field"><label>Choose M3U file</label><input name="file" type="file" accept=".m3u,.m3u8,text/plain,application/x-mpegURL"></div><div class="field"><label>TV guide / XMLTV URL <span class="optional">Optional</span></label><input name="epgUrl" type="url" value="${esc(state.provider?.type==='m3u'?state.provider?.epgUrl||m3uSaved.epgUrl||'':m3uSaved.epgUrl||'')}" placeholder="http://provider.example/epg.xml"></div><div class="provider-note"><div class="provider-note-icon">i</div><div><strong>${NATIVE_WINDOWS?'Windows import ready':'Playlist import'}</strong><span>${NATIVE_WINDOWS?'The Windows bridge can fetch HTTP or HTTPS playlist URLs directly.':'Local files work immediately. URL imports require the playlist server to allow browser requests.'}</span></div></div><label class="remember-row provider-remember"><input type="checkbox" name="remember" ${(m3uSaved.url||state.provider?.type==='m3u'||!state.provider)?'checked':''}><span><strong>Remember this playlist on this device</strong><small>URL-based playlist and guide details are restored automatically after refresh. Local-file libraries are restored from Swoop storage.</small></span></label><button class="btn accent provider-primary" type="submit"><span>Import M3U</span><span>→</span></button></form></div>
    <section id="providerProgress" class="provider-progress" hidden aria-live="polite" aria-busy="true"><div class="provider-progress-top"><div class="provider-spinner" aria-hidden="true"></div><div><div id="providerProgressKicker" class="eyebrow">PLEASE WAIT</div><h3 id="providerProgressTitle">Connecting to your provider…</h3><p id="providerProgressDetail">Swoop is preparing your TV library. Keep this window open.</p></div></div><div class="provider-progress-bar"><span id="providerProgressBar"></span></div><div id="providerProgressSteps" class="provider-progress-steps"></div><div id="providerProgressSummary" class="provider-progress-summary"></div><div class="provider-progress-actions"><button type="button" class="btn secondary" data-provider-progress-back hidden>Back to details</button></div></section><div id="providerStatus" aria-live="polite"></div></div></div></div>`;
}
function mdblistModal(){return `<div class="modal-backdrop" data-close-modal><div class="modal" data-modal-card><div class="modal-head"><h2>Add MDBList Row</h2><button class="icon-btn" data-close>✕</button></div><div class="modal-body"><form id="mdblistForm" class="form-grid"><div class="field"><label>Row name in Swoop TV</label><input name="rowName" value="My MDBList" required></div><div class="field"><label>MDBList API key</label><input name="apiKey" type="password" value="${esc(state.settings.mdblistApiKey||'')}" required></div><div class="field"><label>List ID</label><input name="listId" placeholder="e.g. 12345"></div><div class="divider"></div><p class="form-hint">Or identify the list by username + list slug/name.</p><div class="split"><div class="field"><label>Username</label><input name="username" placeholder="username"></div><div class="field"><label>List name / slug</label><input name="listName" placeholder="best-action-movies"></div></div><button class="btn accent" type="submit">Fetch & Match Catalog</button></form><div id="mdbStatus"></div></div></div></div>`}
function homeRowsModal(){
  const selected=new Set(state.settings.homeRows),defs=allHomeRowDefs(),groups=[...new Set(defs.map(x=>x.group))];
  const lastWeb=Math.max(0,...Object.values(state.webDiscovery||{}).map(x=>Number(x?.updatedAt||0)),...state.mdblistRows.map(x=>Number(x.updatedAt||0)));
  const feature=visualItem(featureItem()),featureArt=feature?(feature.backdrop||feature.logo):'',bg=validHex(state.settings.backgroundColor);
  return `<div class="modal-backdrop" data-close-modal><div class="modal home-rows-modal" data-modal-card><div class="modal-head home-rows-head"><div><div class="eyebrow">HOME SCREEN</div><h2>Customize Swoop</h2><p>Choose your rows, background and cinematic presentation. Swoop can enhance provider posters with TMDb backdrops through your owner-managed metadata service.</p></div><button class="icon-btn" data-close>✕</button></div><div class="modal-body home-rows-body">
  <section class="home-look-card" style="--preview-bg:${esc(bg)}"><div class="home-look-preview">${featureArt?`<img data-swoop-art="${esc(featureArt)}" alt="">`:''}<div class="home-look-shade"></div><div class="home-look-copy"><span class="eyebrow">HOME PREVIEW</span><strong>${esc(feature?.name||'Your featured title')}</strong><small>Large cinematic artwork fills the Home hero when available.</small></div></div><div class="home-look-controls"><span class="eyebrow">APPEARANCE</span><h3>Background colour</h3><p>Choose the base colour behind Home rows and content pages. Film artwork sits above it with a cinematic fade.</p><div class="colour-row"><input id="homeBgColor" type="color" value="${esc(bg)}" aria-label="Background colour"><input id="homeBgHex" type="text" value="${esc(bg)}" maxlength="7" aria-label="Background hex colour"><button type="button" class="btn secondary compact-btn" data-bg-preset="#050505">Cinema Black</button><button type="button" class="btn secondary compact-btn" data-bg-preset="#111218">Charcoal</button><button type="button" class="btn secondary compact-btn" data-bg-preset="#081018">Midnight</button></div><small class="metadata-note">Artwork source: provider images first, enhanced with TMDb backdrops when configured on ${esc(metadataServiceUrl(state.settings))}.</small></div></section>
  <section class="discovery-key-card"><div><span class="eyebrow">WEB DISCOVERY</span><h3>MDBList connection</h3><p>One API key powers Top 20, Trending and auto-refreshing custom MDBList rows. Free MDBList accounts currently allow 1,000 API requests per day.</p></div><form id="homeDiscoveryForm"><div class="field"><label>MDBList API key</label><input name="apiKey" type="password" value="${esc(state.settings.mdblistApiKey||'')}" placeholder="Paste your MDBList API key"></div><div class="discovery-key-actions"><button class="btn accent" type="submit">Save & Refresh</button><button class="btn secondary" type="button" data-refresh-discovery ${state.settings.mdblistApiKey?'':'disabled'}>Refresh now</button></div><small>${lastWeb?esc(relativeRefreshTime(lastWeb)):'No web refresh yet'}${discoveryRefreshing?' · Refreshing now…':''}</small></form></section>
  <div class="home-row-toolbar"><div><strong>${state.settings.homeRows.length} rows selected</strong><span>Use ↑ ↓ to control the order.</span></div><div><button class="btn secondary compact-btn" data-modal="mdblist">＋ Custom MDBList Row</button><button class="btn secondary compact-btn" data-reset-home>Reset defaults</button></div></div>
  <div class="home-row-picker">${groups.map(group=>`<section class="home-row-group"><div class="home-row-group-title"><span>${esc(group)}</span></div>${defs.filter(x=>x.group===group).map(def=>{const on=selected.has(def.id),index=state.settings.homeRows.indexOf(def.id),data=homeRowItems(def.id),cache=state.webDiscovery?.[def.id],err=cache?.error||(def.custom?state.mdblistRows.find(r=>`custom:${r.uid}`===def.id)?.error:'');return `<div class="home-row-option ${on?'selected':''}"><button class="home-row-toggle" data-home-toggle="${esc(def.id)}" aria-pressed="${on?'true':'false'}"><span class="home-row-check">${on?'✓':'＋'}</span><span><strong>${esc(def.label)}</strong><small>${esc(def.description||`${data.length.toLocaleString()} items currently available`)}</small>${err?`<em>${esc(err)}</em>`:''}</span></button><div class="home-row-order">${on?`<button data-home-up="${esc(def.id)}" ${index<=0?'disabled':''} aria-label="Move ${esc(def.label)} up">↑</button><button data-home-down="${esc(def.id)}" ${index<0||index>=state.settings.homeRows.length-1?'disabled':''} aria-label="Move ${esc(def.label)} down">↓</button>`:''}</div></div>`}).join('')}</section>`).join('')}</div>
  <div class="home-row-footer"><span>Top 20 rows use current MDBList popularity. Trending rows use current JustWatch streaming charts through MDBList.</span><button class="btn accent" data-close>Done</button></div>
  </div></div></div>`;
}
function modalHtml(){if(modal==='provider')return providerModal();if(modal==='homeRows')return homeRowsModal();return mdblistModal()}
function setStatus(id,msg,type='info'){const el=document.querySelector(id);if(el)el.innerHTML=`<div class="status ${type}">${esc(msg)}</div>`}
function providerProgressStart(kind,providerName){const setup=document.querySelector('#providerSetup'),panel=document.querySelector('#providerProgress'),status=document.querySelector('#providerStatus');if(setup)setup.hidden=true;if(panel)panel.hidden=false;if(status)status.innerHTML='';const steps=kind==='xtream'?[['contact','Contacting provider'],['auth','Verifying Xtream login'],['live','Loading Live TV'],['movie','Loading Movies'],['series','Loading TV Shows'],['save','Building Swoop library']]:[['read','Reading playlist'],['parse','Parsing channels'],['save','Building Swoop library']];const box=document.querySelector('#providerProgressSteps');if(box)box.innerHTML=steps.map(([id,label],i)=>`<div class="provider-progress-step" data-progress-step="${id}"><span class="step-indicator">${i+1}</span><span>${esc(label)}</span><strong></strong></div>`).join('');const title=document.querySelector('#providerProgressTitle');if(title)title.textContent=`Connecting to ${providerName||'your provider'}…`;const detail=document.querySelector('#providerProgressDetail');if(detail)detail.textContent=kind==='xtream'?'Swoop is checking your account, then loading Live TV, Movies and TV Shows. Large libraries can take a little while.':'Swoop is reading your playlist and preparing the channels for your library.';const summary=document.querySelector('#providerProgressSummary');if(summary)summary.innerHTML='<strong>Please wait.</strong> Keep Swoop open while this finishes.';providerProgressUpdate({step:steps[0][0],progress:5})}
function providerProgressUpdate({step='',progress=0,title='',detail='',stepDetail='',done=false,error=false}={}){const bar=document.querySelector('#providerProgressBar');if(bar)bar.style.width=`${Math.max(0,Math.min(100,progress))}%`;if(title){const el=document.querySelector('#providerProgressTitle');if(el)el.textContent=title}if(detail){const el=document.querySelector('#providerProgressDetail');if(el)el.textContent=detail}document.querySelectorAll('[data-progress-step]').forEach(el=>{const active=el.dataset.progressStep===step;if(active)el.classList.add('active');else el.classList.remove('active');if(done&&!error)el.classList.add('done')});if(step){const active=document.querySelector(`[data-progress-step="${step}"]`);if(active){active.classList.add(error?'error':'active');const strong=active.querySelector('strong');if(strong&&stepDetail)strong.textContent=stepDetail}}}
function providerProgressMark(step,detail=''){const el=document.querySelector(`[data-progress-step="${step}"]`);if(el){el.classList.remove('active');el.classList.add('done');const indicator=el.querySelector('.step-indicator');if(indicator)indicator.textContent='✓';const strong=el.querySelector('strong');if(strong)strong.textContent=detail}}
function providerProgressSuccess(message){providerProgressUpdate({progress:100,title:'Your library is ready',detail:message});document.querySelectorAll('[data-progress-step]').forEach(el=>{el.classList.remove('active');el.classList.add('done');const i=el.querySelector('.step-indicator');if(i)i.textContent='✓'});const kicker=document.querySelector('#providerProgressKicker');if(kicker)kicker.textContent='CONNECTED';const spinner=document.querySelector('.provider-spinner');if(spinner){spinner.classList.add('success');spinner.textContent='✓'}const summary=document.querySelector('#providerProgressSummary');if(summary)summary.innerHTML='<strong>Done.</strong> Opening Swoop TV…'}
function providerProgressError(message){providerProgressUpdate({progress:100,title:'Could not finish connecting',detail:message,error:true});const kicker=document.querySelector('#providerProgressKicker');if(kicker)kicker.textContent='CONNECTION ISSUE';const spinner=document.querySelector('.provider-spinner');if(spinner){spinner.classList.add('error');spinner.textContent='!'}const summary=document.querySelector('#providerProgressSummary');if(summary)summary.innerHTML='<strong>Your details have not been cleared.</strong> Go back, check them and try again.';const back=document.querySelector('[data-provider-progress-back]');if(back)back.hidden=false}
function providerProgressBack(){const setup=document.querySelector('#providerSetup'),panel=document.querySelector('#providerProgress');if(setup)setup.hidden=false;if(panel)panel.hidden=true;const back=document.querySelector('[data-provider-progress-back]');if(back)back.hidden=true}
function toast(msg){clearTimeout(toastTimer);document.querySelector('.toast')?.remove();const el=document.createElement('div');el.className='toast';el.textContent=msg;document.body.appendChild(el);toastTimer=setTimeout(()=>el.remove(),2200)}

function detailMeta(item,payload){
  item=visualItem(item);
  const info=payload?.info||{},movie=payload?.movie_data||{};
  const providerCover=resolveProviderAsset(info.movie_image||info.cover_big||info.cover||movie.stream_icon||'');
  const providerBackdrop=resolveProviderAsset((Array.isArray(info.backdrop_path)?info.backdrop_path[0]:info.backdrop_path)||(Array.isArray(payload?.backdrop_path)?payload.backdrop_path[0]:payload?.backdrop_path)||'');
  const cover=item.logo||providerCover;
  const backdrop=item.backdrop||providerBackdrop||cover;
  return {title:info.name||movie.name||item.name,plot:info.plot||info.description||movie.plot||item.plot||'',cover,backdrop,backdrops:Array.isArray(item.backdrops)?item.backdrops:[],titleLogo:item.titleLogo||'',year:info.releasedate||info.releaseDate||info.year||movie.year||item.year||'',rating:info.rating||info.rating_5based||movie.rating||item.rating||'',genre:info.genre||item.genre||item.group||'',cast:info.cast||'',director:info.director||'',duration:info.duration||info.episode_run_time||movie.duration||item.duration||'',country:info.country||'',age:info.age||info.mpaa_rating||'',youtube:info.youtube_trailer||''};
}
function normalizeEpisode(item,ep,season){
  const info=ep?.info||{};
  let streamUrl='';try{streamUrl=buildXtreamSeriesStreamUrl(sessionXtream,ep)}catch{}
  return {id:`${item.id}:episode:${ep.id??ep.stream_id??`${season}-${ep.episode_num}`}`,providerId:item.providerId,source:'xtream',kind:'episode',name:ep.title||info.title||`Episode ${ep.episode_num||''}`.trim(),group:item.name,logo:resolveProviderAsset(info.movie_image||info.cover||item.logo),backdrop:resolveProviderAsset(info.movie_image||item.backdrop||item.logo),streamUrl,parentSeriesId:item.id,seriesId:item.seriesId,season:String(season||ep.season||''),episodeNum:ep.episode_num||ep.episode||'',plot:info.plot||info.description||'',duration:info.duration||'',rating:info.rating||'',year:info.releasedate||''};
}
function seriesSeasons(item,payload){
  const episodes=payload?.episodes&&typeof payload.episodes==='object'?payload.episodes:{};const result=[];detailEpisodeItems.clear();
  for(const [season,eps] of Object.entries(episodes)){const arr=(Array.isArray(eps)?eps:[]).map(ep=>normalizeEpisode(item,ep,season));arr.forEach(x=>detailEpisodeItems.set(x.id,x));if(arr.length)result.push({season:String(season),episodes:arr})}
  result.sort((a,b)=>Number(a.season)-Number(b.season));return result;
}
function detailHtml(){
  if(!detailItem)return'';
  const meta=detailMeta(detailItem,detailPayload||{}),saved=isInMyList(detailItem),backdrop=meta.backdrop||meta.cover||detailItem.logo,hasCinematicBackdrop=Boolean(meta.backdrop&&meta.backdrop!==meta.cover);
  let episodeBlock='',primary='';
  if(detailItem.kind==='series'){
    const seasons=seriesSeasons(detailItem,detailPayload||{});if(!detailSeason&&seasons.length)detailSeason=seasons[0].season;const selected=seasons.find(s=>s.season===detailSeason)||seasons[0];const first=selected?.episodes?.[0];if(first)primary=`<button class="btn play-btn detail-play" data-play="${esc(first.id)}">▶ Play S${esc(first.season)} E${esc(first.episodeNum||'1')}</button>`;
    episodeBlock=`<section class="detail-episodes"><div class="detail-section-head"><div><span class="eyebrow">EPISODES</span><h3>${seasons.length?'Seasons':'Episode information'}</h3></div>${seasons.length?`<div class="season-pills">${seasons.map(s=>`<button class="${s.season===detailSeason?'active':''}" data-season="${esc(s.season)}">Season ${esc(s.season)}</button>`).join('')}</div>`:''}</div>${detailLoading?`<div class="detail-loading"><i></i><span>Loading seasons and episodes…</span></div>`:detailError?`<div class="detail-error">${esc(detailError)}</div>`:selected?.episodes?.length?`<div class="episode-list">${selected.episodes.map(ep=>`<button class="episode-card" data-play="${esc(ep.id)}"><div class="episode-thumb" style="--episode-bg:linear-gradient(135deg,hsl(${Math.abs(hash(ep.name))%360} 38% 28%),#090a0d)">${ep.logo?`<img data-swoop-art="${esc(ep.logo)}" alt="">`:''}<span>▶</span></div><div class="episode-copy"><div><strong>${ep.episodeNum?`${esc(ep.episodeNum)}. `:''}${esc(ep.name)}</strong>${ep.duration?`<span>${esc(ep.duration)}</span>`:''}</div><p>${esc(ep.plot||'Play this episode from your connected provider.')}</p></div></button>`).join('')}</div>`:`<div class="detail-empty">No episodes were returned for this series.</div>`}</section>`;
  }else if(detailItem.kind==='movie') primary=`<button class="btn play-btn detail-play" data-play="${esc(detailItem.id)}">▶ Play</button>`;
  else if(detailItem.kind==='live') primary=`<button class="btn play-btn detail-play" data-play="${esc(detailItem.id)}">▶ Watch Live</button>`;
  const related=activeCatalog().filter(x=>x.id!==detailItem.id&&x.kind===detailItem.kind&&x.group===detailItem.group).slice(0,12);
  const facts=[['Genre',meta.genre],['Cast',meta.cast],['Director',meta.director],['Country',meta.country],['Duration',meta.duration]].filter(([,v])=>v);
  return `<div class="detail-overlay" role="dialog" aria-modal="true" aria-label="${esc(meta.title)}"><div class="detail-scroll"><section class="detail-hero"><div class="detail-media"><div class="detail-fallback" style="--detail-bg:${detailItem.demoColor||'linear-gradient(135deg,#252539,#090909)'}"></div>${backdrop?`<img class="detail-backdrop" data-swoop-art="${esc(backdrop)}" alt="">`:''}</div><div class="detail-vignette"></div><button class="detail-close" data-detail-close aria-label="Close">←</button><div class="detail-copy"><div class="detail-kicker">${esc(kindLabel(detailItem).toUpperCase())}</div>${meta.titleLogo?`<img class="detail-title-logo" data-swoop-art="${esc(meta.titleLogo)}" alt="${esc(meta.title)}">`:`<h2>${esc(meta.title)}</h2>`}<div class="detail-meta">${[meta.year,meta.rating?`★ ${meta.rating}`:'',meta.age,detailItem.group].filter(Boolean).map(x=>`<span>${esc(x)}</span>`).join('')}</div><p>${esc(meta.plot||`Available from ${state.provider?.name||'your connected provider'}.`)}</p><div class="cta-row">${primary}<button class="btn secondary detail-list ${saved?'saved':''}" data-toggle-list="${esc(detailItem.id)}"><span>${saved?'✓':'＋'}</span> ${saved?'In My List':'My List'}</button></div></div>${meta.cover&&!hasCinematicBackdrop?`<img class="detail-poster" data-swoop-art="${esc(meta.cover)}" alt="">`:''}</section>
  ${episodeBlock}<section class="detail-info"><div><span class="eyebrow">ABOUT</span><h3>More about ${esc(meta.title)}</h3></div><div class="detail-facts">${facts.length?facts.map(([k,v])=>`<div><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`).join(''):'<div><span>Source</span><strong>Your connected provider</strong></div>'}</div></section>${related.length?`<section class="detail-related">${rail('More Like This',related,detailItem.kind!=='live')}</section>`:''}</div></div>`;
}
async function openDetail(item){
  if(!item)return;detailItem=item;detailSeason='';detailError='';detailPayload=detailCache.get(item.id)||null;detailLoading=false;render();if(['movie','series'].includes(item.kind))setTimeout(()=>enrichItemMetadata(item,{rerender:true}),0);
  if(detailPayload||item.source!=='xtream'||!['movie','series'].includes(item.kind))return;
  if(!sessionXtream.server||!sessionXtream.username||!sessionXtream.password){detailError=item.kind==='series'?'Reconnect your Xtream provider to load seasons and episodes.':'Reconnect your Xtream provider to load full title details.';render();return}
  detailLoading=true;render();
  try{const payload=item.kind==='series'?await fetchXtreamSeriesInfo(sessionXtream,item.seriesId):await fetchXtreamVodInfo(sessionXtream,item.streamId);detailCache.set(item.id,payload||{});if(detailItem?.id===item.id){detailPayload=payload||{};detailLoading=false;render()}}
  catch(err){if(detailItem?.id===item.id){detailLoading=false;detailError=err.message||'Could not load title details.';render()}}
}
function closeDetail(){detailItem=null;detailPayload=null;detailLoading=false;detailError='';detailSeason='';detailEpisodeItems.clear();render()}
function toggleMyList(item){if(!item)return;const index=state.myList.indexOf(item.id);if(index>=0){state.myList.splice(index,1);toast('Removed from My List')}else{state.myList.unshift(item.id);toast('Added to My List')}persist();render()}
function rememberWatching(item){if(!item||item.kind==='live')return;const entry={id:item.id,item:{...item},lastPlayed:Date.now(),progress:continueEntry(item.id)?.progress??null};state.continueWatching=state.continueWatching.filter(x=>x.id!==item.id);state.continueWatching.unshift(entry);state.continueWatching=state.continueWatching.slice(0,30);persist()}

function playerHtml(){if(NATIVE_WINDOWS)return `<div class="player-shell native-player-shell" role="dialog" aria-modal="true" aria-label="${esc(playerItem?.name||'Swoop Native Player')}"><div class="native-player-card"><div class="eyebrow">WINDOWS NATIVE PLAYER</div><h2>${esc(playerItem?.name||'')}</h2><div id="playerStatus" class="player-status">Launching native playback…</div><div id="playerMessage" class="native-player-copy">Swoop will open the stream in its native mpv playback window. Press F for fullscreen, Space to pause, and Esc or Q to close the player.</div><div class="cta-row"><button class="btn danger" data-native-stop>Stop playback</button><button class="btn secondary" data-close-player>Back to Swoop</button></div></div></div>`;return `<div class="player-shell" role="dialog" aria-modal="true" aria-label="${esc(playerItem?.name||'Swoop Player')}"><video id="swoopVideo" class="swoop-video" controls autoplay playsinline></video><div class="player-top"><button class="player-back" data-close-player>←</button><div><div class="player-title">${esc(playerItem?.name||'')}</div><div id="playerStatus" class="player-status">${playerItem?.kind==='live'?'Preparing live stream…':'Preparing playback…'}</div></div></div><div id="playerMessage" class="player-message" hidden></div></div>`}
function setPlayerMessage(message,isError=false){const status=document.querySelector('#playerStatus'),box=document.querySelector('#playerMessage');if(status)status.textContent=isError?'Playback unavailable':'Loading…';if(box){box.hidden=false;box.classList.toggle('error',isError);box.textContent=message}}
function stopPlayback(){if(NATIVE_WINDOWS)nativeStop().catch(()=>{});try{activeHls?.destroy?.()}catch{}activeHls=null;const video=document.querySelector('#swoopVideo');if(video){try{video.pause()}catch{}video.removeAttribute('src');try{video.load()}catch{}}}
function closePlayer(){stopPlayback();playerItem=null;render()}
function hlsCandidate(item){let url=String(item.streamUrl||'');if(item.kind==='live'&&item.source==='xtream')url=url.replace(/\.(?:ts|m3u8)(?=($|\?))/i,'.m3u8');return url}
function loadHlsLibrary(){if(window.Hls)return Promise.resolve(window.Hls);if(window.__swoopHlsPromise)return window.__swoopHlsPromise;window.__swoopHlsPromise=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='https://cdn.jsdelivr.net/npm/hls.js@1.6.16/dist/hls.min.js';script.async=true;script.onload=()=>window.Hls?resolve(window.Hls):reject(new Error('HLS player did not initialise.'));script.onerror=()=>reject(new Error('Could not load the HLS playback engine.'));document.head.appendChild(script)});return window.__swoopHlsPromise}
async function startPlayback(item){
  if(NATIVE_WINDOWS){try{const result=await nativePlay(item);const status=document.querySelector('#playerStatus');if(status)status.textContent='Native player starting…';const msg=document.querySelector('#playerMessage');if(msg)msg.textContent=`mpv process ${result?.pid||''} was requested. Swoop is checking that the player stays open…`;await new Promise(r=>setTimeout(r,1400));const diag=await nativeDiagnostics();if(diag?.playing){if(status)status.textContent=item.kind==='live'?'● LIVE · Native player opened':'Playing in native window';if(msg)msg.textContent=`Native playback is running${result?.pid?` · process ${result.pid}`:''}. Video is going directly from your provider to this PC.`}else{const lines=Array.isArray(diag?.logTail)?diag.logTail.filter(Boolean):[];const tail=lines.slice(-6).join(' | ');const code=diag?.exitCode!==null&&diag?.exitCode!==undefined?` Exit code ${diag.exitCode}.`:'';setPlayerMessage(`The native player started but closed immediately.${code}${tail?` mpv: ${tail}`:' Check the Swoop TV Windows Bridge window for the launch result.'}`,true)}}catch(err){setPlayerMessage(err.message||'Could not launch the Windows native player.',true)}return}
  const video=document.querySelector('#swoopVideo');if(!video||!item)return;const url=hlsCandidate(item);if(location.protocol==='https:'&&/^http:\/\//i.test(url)){setPlayerMessage('This provider is sending an HTTP video stream. An HTTPS web app cannot safely play it in Chrome. Swoop stopped the request instead of letting the browser hang. A secure HTTPS/HLS stream or the native Swoop app is required for this source.',true);return}const lower=url.split('?')[0].toLowerCase(),isHls=/\.m3u8$/.test(lower);if(item.kind==='live'&&!isHls){setPlayerMessage('This live stream is not browser-safe HLS. Swoop has deliberately not opened the raw transport stream because that was causing Chrome to become unresponsive.',true);return}if(isHls){if(video.canPlayType('application/vnd.apple.mpegurl')){video.src=url;video.addEventListener('loadedmetadata',()=>{const s=document.querySelector('#playerStatus');if(s)s.textContent=item.kind==='live'?'● LIVE':'Playing'},{once:true});video.addEventListener('error',()=>setPlayerMessage('The browser could not open this HLS stream. The provider may block browser playback or the stream may use an unsupported codec.',true),{once:true});try{await video.play()}catch{}return}try{const Hls=await loadHlsLibrary();if(!Hls.isSupported())throw new Error('This browser does not provide MediaSource playback.');activeHls=new Hls({enableWorker:true,lowLatencyMode:true,backBufferLength:60,maxBufferLength:20});activeHls.attachMedia(video);activeHls.on(Hls.Events.MEDIA_ATTACHED,()=>activeHls?.loadSource(url));activeHls.on(Hls.Events.MANIFEST_PARSED,()=>{const s=document.querySelector('#playerStatus');if(s)s.textContent=item.kind==='live'?'● LIVE':'Playing';video.play().catch(()=>{})});activeHls.on(Hls.Events.ERROR,(_,data)=>{if(!data?.fatal)return;const detail=data?.details?` (${data.details})`:'';setPlayerMessage(`The HLS stream could not be played${detail}. Many IPTV providers allow native apps but block browser HLS/CORS.`,true);try{activeHls?.destroy()}catch{}activeHls=null})}catch(err){setPlayerMessage(err.message||'Could not start HLS playback.',true)}return}if(/\.(mp4|webm|m4v)$/.test(lower)){video.src=url;video.addEventListener('loadedmetadata',()=>{const s=document.querySelector('#playerStatus');if(s)s.textContent='Playing'},{once:true});video.addEventListener('error',()=>setPlayerMessage('The browser could not play this video file or codec.',true),{once:true});try{await video.play()}catch{}return}setPlayerMessage('This video container is not supported safely by the web player yet.',true)
}
function play(item){if(!item)return;if(!item.streamUrl){toast(item.source==='demo'?'Demo item — connect your provider for playback.':item.kind==='series'?'Open the series to choose an episode.':'No playable URL available.');if(item.kind==='series')openDetail(item);return}rememberWatching(item);stopPlayback();playerItem=item;render();requestAnimationFrame(()=>startPlayback(item))}

function queueArtworkRelay(task){return new Promise((resolve,reject)=>{artworkRelayQueue.push({task,resolve,reject});pumpArtworkRelay()})}
function pumpArtworkRelay(){while(artworkRelayActive<ARTWORK_RELAY_LIMIT&&artworkRelayQueue.length){const job=artworkRelayQueue.shift();artworkRelayActive++;Promise.resolve().then(job.task).then(job.resolve,job.reject).finally(()=>{artworkRelayActive--;pumpArtworkRelay()})}}
async function relayArtworkUrl(url){if(artworkCache.has(url))return artworkCache.get(url);const promise=queueArtworkRelay(async()=>{const blob=await fetchXtreamAssetBlob({relayUrl:sessionRelay.url,relayToken:sessionRelay.token},url);return URL.createObjectURL(blob)}).catch(err=>{artworkCache.delete(url);throw err});artworkCache.set(url,promise);return promise}
function canRelayArtwork(){return !NATIVE_WINDOWS&&Boolean(sessionRelay.url&&sessionRelay.token&&state.provider?.type==='xtream')}
function loadArtwork(img){if(img.dataset.swoopLoaded==='1')return;img.dataset.swoopLoaded='1';const url=img.dataset.swoopArt||'';if(!url)return;const fallback=async()=>{if(!canRelayArtwork())return;try{img.src=await relayArtworkUrl(url);img.classList.add('loaded')}catch{img.removeAttribute('src')}};if(location.protocol==='https:'&&/^http:\/\//i.test(url)&&canRelayArtwork()){fallback();return}img.onload=()=>img.classList.add('loaded');img.onerror=()=>fallback();img.src=url}
function hydrateArtwork(root=document){const imgs=[...root.querySelectorAll('img[data-swoop-art]')];if('IntersectionObserver'in window){const observer=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){observer.unobserve(entry.target);loadArtwork(entry.target)}},{rootMargin:'300px'});imgs.forEach(img=>observer.observe(img))}else imgs.forEach(loadArtwork)}
function runSearch(q){const out=document.querySelector('#searchResults');if(!out)return;const term=q.trim().toLowerCase();const res=term?activeCatalog().filter(x=>`${x.name} ${x.group} ${x.year||''}`.toLowerCase().includes(term)).slice(0,100):activeCatalog().slice(0,30);out.innerHTML=res.length?res.map(x=>card(x,x.kind!=='live')).join(''):empty('No matches','Try another title, channel or category.');hydrateArtwork(out);bindDynamicCards(out)}
function persist(bulk=false){const snapshot={...state,page:'home',favourites:state.myList};const localOk=saveState(snapshot);return bulk?saveBulkState(snapshot).then(bulkOk=>localOk&&bulkOk):Promise.resolve(localOk)}
function bindDynamicCards(root=document){root.querySelectorAll('[data-play]').forEach(el=>{if(el.dataset.boundPlay)return;el.dataset.boundPlay='1';el.onclick=()=>play(savedItem(el.dataset.play))});root.querySelectorAll('[data-detail]').forEach(el=>{if(el.dataset.boundDetail)return;el.dataset.boundDetail='1';el.onclick=()=>openDetail(savedItem(el.dataset.detail))})}

function bind(){
  document.querySelectorAll('[data-page]').forEach(el=>el.onclick=()=>{state.page=el.dataset.page;if(state.page==='guide')guideStart=Math.floor(Date.now()/1800000)*1800000;render()});
  document.querySelectorAll('[data-modal]').forEach(el=>el.onclick=()=>{modal=el.dataset.modal;render()});
  document.querySelectorAll('[data-close]').forEach(el=>el.onclick=()=>{modal=null;render()});
  document.querySelectorAll('[data-close-modal]').forEach(el=>el.onclick=e=>{if(e.target===el){modal=null;render()}});
  bindDynamicCards(document);
  document.querySelectorAll('[data-detail-close]').forEach(el=>el.onclick=closeDetail);
  document.querySelectorAll('[data-toggle-list]').forEach(el=>el.onclick=()=>toggleMyList(savedItem(el.dataset.toggleList)||detailItem));
  document.querySelectorAll('[data-season]').forEach(el=>el.onclick=()=>{detailSeason=el.dataset.season;render()});
  document.querySelectorAll('[data-close-player]').forEach(el=>el.onclick=()=>closePlayer());
  document.querySelectorAll('[data-native-stop]').forEach(el=>el.onclick=()=>{nativeStop().catch(()=>{});const status=document.querySelector('#playerStatus');if(status)status.textContent='Playback stopped'});
  document.querySelectorAll('[data-load-more]').forEach(el=>el.onclick=()=>{const kind=el.dataset.loadMore;viewLimits[kind]=(viewLimits[kind]||120)+(kind==='live'?180:120);render()});
  document.querySelectorAll('[data-search-term]').forEach(el=>el.onclick=()=>{state.page='search';render();const input=document.querySelector('#searchInput');if(input){input.value=el.dataset.searchTerm;runSearch(input.value)}});
  document.querySelector('[data-guide-now]')?.addEventListener('click',()=>{guideStart=Math.floor(Date.now()/1800000)*1800000;render()});
  document.querySelector('[data-guide-more]')?.addEventListener('click',()=>{guideLimit+=24;if(state.provider?.type==='m3u')m3uGuideLoaded=false;render()});
  document.querySelector('[data-action="disconnect"]')?.addEventListener('click',()=>{state.catalog=[];state.provider=null;state.mdblistRows.forEach(r=>{r.items=[];r.updatedAt=0;r.error=''});state.webDiscovery={};state.metadataCache={};state.myList=[];state.continueWatching=[];sessionRelay={url:'',token:''};sessionXtream={server:'',username:'',password:'',relayUrl:'',relayToken:''};savedProviderProfile=null;clearProviderProfile();epgCache.clear();detailCache.clear();persist(true);render();toast('Provider disconnected')});
  document.querySelector('[data-action="clear-history"]')?.addEventListener('click',()=>{state.continueWatching=[];persist();render();toast('Continue Watching cleared')});
  document.querySelectorAll('[data-remove-row]').forEach(el=>el.onclick=()=>{const row=state.mdblistRows[Number(el.dataset.removeRow)];if(row)state.settings.homeRows=state.settings.homeRows.filter(id=>id!==`custom:${row.uid}`);state.mdblistRows.splice(Number(el.dataset.removeRow),1);persist(true);render()});
  const search=document.querySelector('#searchInput');if(search)search.oninput=e=>runSearch(e.target.value);
  document.querySelectorAll('[data-provider-tab]').forEach(el=>el.onclick=()=>{document.querySelectorAll('[data-provider-tab]').forEach(x=>x.classList.toggle('active',x===el));document.querySelector('#m3uForm').hidden=el.dataset.providerTab!=='m3u';document.querySelector('#xtreamForm').hidden=el.dataset.providerTab!=='xtream';document.querySelector('#providerStatus').innerHTML=''});
  document.querySelector('[data-provider-progress-back]')?.addEventListener('click',providerProgressBack);
  document.querySelector('#homeDiscoveryForm')?.addEventListener('submit',async e=>{e.preventDefault();const fd=new FormData(e.currentTarget),key=String(fd.get('apiKey')||'').trim();if(!key){toast('Enter an MDBList API key first');return}state.settings.mdblistApiKey=key;persist();toast('MDBList key saved');await refreshDiscoveryRows(true)});
  const bgPicker=document.querySelector('#homeBgColor'),bgHex=document.querySelector('#homeBgHex');
  const setBg=value=>{const c=validHex(value);state.settings.backgroundColor=c;if(bgPicker)bgPicker.value=c;if(bgHex)bgHex.value=c;applyTheme();persist()};
  if(bgPicker)bgPicker.oninput=e=>setBg(e.target.value);
  if(bgHex)bgHex.onchange=e=>setBg(e.target.value);
  document.querySelectorAll('[data-bg-preset]').forEach(el=>el.onclick=()=>setBg(el.dataset.bgPreset));
  document.querySelector('[data-refresh-discovery]')?.addEventListener('click',()=>refreshDiscoveryRows(true));
  document.querySelectorAll('[data-home-toggle]').forEach(el=>el.onclick=()=>{const id=el.dataset.homeToggle,index=state.settings.homeRows.indexOf(id);if(index>=0)state.settings.homeRows.splice(index,1);else state.settings.homeRows.push(id);persist();render()});
  document.querySelectorAll('[data-home-up]').forEach(el=>el.onclick=()=>{const id=el.dataset.homeUp,i=state.settings.homeRows.indexOf(id);if(i>0){[state.settings.homeRows[i-1],state.settings.homeRows[i]]=[state.settings.homeRows[i],state.settings.homeRows[i-1]];persist();render()}});
  document.querySelectorAll('[data-home-down]').forEach(el=>el.onclick=()=>{const id=el.dataset.homeDown,i=state.settings.homeRows.indexOf(id);if(i>=0&&i<state.settings.homeRows.length-1){[state.settings.homeRows[i+1],state.settings.homeRows[i]]=[state.settings.homeRows[i],state.settings.homeRows[i+1]];persist();render()}});
  document.querySelector('[data-reset-home]')?.addEventListener('click',()=>{state.settings.homeRows=[...DEFAULT_HOME_ROWS,...state.mdblistRows.map(r=>`custom:${r.uid}`)];persist();render();toast('Home rows reset')});
  document.querySelector('#m3uForm')?.addEventListener('submit',async e=>{e.preventDefault();const fd=new FormData(e.currentTarget),file=fd.get('file'),url=String(fd.get('url')||'').trim(),name=String(fd.get('name')||'M3U Provider'),remember=Boolean(fd.get('remember'));providerProgressStart('m3u',name);try{providerProgressUpdate({step:'read',progress:12,title:`Reading ${name}…`,detail:file&&file.size?'Swoop is reading the M3U file from this device.':'Swoop is downloading the playlist from your provider.'});let text;if(file&&file.size)text=await file.text();else if(url){if(NATIVE_WINDOWS)text=await nativeFetchText(url);else{const r=await fetch(url);if(!r.ok)throw new Error(`Playlist returned HTTP ${r.status}`);text=await r.text()}}else throw new Error('Choose an M3U file or enter a playlist URL.');providerProgressMark('read','Complete');providerProgressUpdate({step:'parse',progress:55,title:'Parsing channels…',detail:'Swoop is reading channel names, groups, logos and stream addresses.'});await new Promise(r=>setTimeout(r,40));const providerId=`m3u-${Date.now()}`,cat=parseM3U(text,providerId);if(!cat.length)throw new Error('No playable entries were found in that M3U playlist.');providerProgressMark('parse',`${cat.length.toLocaleString()} items`);providerProgressUpdate({step:'save',progress:86,title:'Building your Swoop library…',detail:`Preparing ${cat.length.toLocaleString()} imported items for browsing.`});state.catalog=cat;state.provider={id:providerId,type:'m3u',name,url,epgUrl:String(fd.get('epgUrl')||'')};state.mdblistRows.forEach(r=>{r.items=[];r.updatedAt=0;r.error=''});state.webDiscovery={};state.metadataCache={};state.myList=[];state.continueWatching=[];m3uGuideLoaded=false;epgCache.clear();if(remember){savedProviderProfile={type:'m3u',name,url,epgUrl:String(fd.get('epgUrl')||'')};saveProviderProfile(savedProviderProfile)}else if(savedProviderProfile?.type==='m3u'){savedProviderProfile=null;clearProviderProfile()}await persist(true);providerProgressMark('save','Ready');providerProgressSuccess(`Imported ${cat.length.toLocaleString()} items from ${name}.`);setTimeout(()=>{modal=null;state.page='home';render()},1100)}catch(err){providerProgressError(err.message||String(err))}});
  document.querySelector('#xtreamForm')?.addEventListener('submit',async e=>{e.preventDefault();const fd=new FormData(e.currentTarget),relayUrl=String(fd.get('relayUrl')||'').trim(),relayToken=String(fd.get('relayToken')||''),name=String(fd.get('name')||'Xtream Provider'),cfg={server:String(fd.get('server')).trim(),username:String(fd.get('username')),password:String(fd.get('password')),relayUrl,relayToken};providerProgressStart('xtream',name);try{providerProgressUpdate({step:'contact',progress:7,title:`Contacting ${name}…`,detail:NATIVE_WINDOWS?'Using the Windows Native Bridge to reach your Xtream server.':relayUrl?'Using the Swoop Connection Helper to reach your Xtream server.':'Connecting directly to your Xtream server.'});const profile=await testXtream(cfg);providerProgressMark('contact','Reached');providerProgressUpdate({step:'auth',progress:18,title:'Verifying your Xtream login…',detail:'Checking that the account is active and authorised.'});if(String(profile?.user_info?.auth)==='0')throw new Error('Xtream account was not authorised.');providerProgressMark('auth','Authorised');providerProgressUpdate({step:'live',progress:26,title:'Loading your provider library…',detail:'Live TV, Movies and TV Shows are being loaded. Large subscriptions can take a little while.'});const providerId=`xtream-${Date.now()}`,completedSections=new Set();const result=await importXtream(cfg,providerId,info=>{if(info?.section){completedSections.add(info.section);providerProgressMark(info.section,`${Number(info.count||0).toLocaleString()} items`);const next=['live','movie','series'].find(x=>!completedSections.has(x))||'save',progress=next==='live'?30:next==='movie'?47:next==='series'?64:80,nextLabel=next==='live'?'Live TV':next==='movie'?'Movies':next==='series'?'TV Shows':'your Swoop library';providerProgressUpdate({step:next,progress,title:next==='save'?'Provider catalog loaded — preparing Swoop…':`Loading ${nextLabel}…`,detail:next==='save'?'Swoop is now building the local library and indexes.':'The remaining sections are still loading. You can leave this window open.'})}});if(!result.items.length)throw new Error('Connected, but the provider returned an empty catalog.');providerProgressUpdate({step:'save',progress:88,title:'Building your Swoop library…',detail:'Saving the catalog and preparing it for Home, Live TV, Movies, TV Shows, Guide and Search.'});const remember=Boolean(fd.get('remember'));sessionRelay={url:relayUrl,token:relayToken};sessionXtream={...cfg};state.settings.xtreamRelayUrl=relayUrl;state.settings.xtreamRelayToken=remember?relayToken:'';state.catalog=result.items;state.provider={id:providerId,type:'xtream',name,server:cfg.server,connection:NATIVE_WINDOWS?'windows-native':relayUrl?'helper':'direct',relayUrl,...(remember?{username:cfg.username,password:cfg.password,relayToken}:{})};if(remember){savedProviderProfile={type:'xtream',name,server:cfg.server,username:cfg.username,password:cfg.password,relayUrl,relayToken};saveProviderProfile(savedProviderProfile)}else if(savedProviderProfile?.type==='xtream'){savedProviderProfile=null;clearProviderProfile()};state.mdblistRows.forEach(r=>{r.items=[];r.updatedAt=0;r.error=''});state.webDiscovery={};state.metadataCache={};state.myList=[];state.continueWatching=[];epgCache.clear();detailCache.clear();await persist(true);providerProgressMark('save','Ready');const counts=result.counts||{live:result.items.filter(x=>x.kind==='live').length,movie:result.items.filter(x=>x.kind==='movie').length,series:result.items.filter(x=>x.kind==='series').length};providerProgressSuccess(`${counts.live.toLocaleString()} live channels · ${counts.movie.toLocaleString()} movies · ${counts.series.toLocaleString()} TV shows`);setTimeout(()=>{modal=null;state.page='home';render()},1300)}catch(err){providerProgressError(err.message||String(err))}});
  document.querySelector('#mdblistForm')?.addEventListener('submit',async e=>{e.preventDefault();if(!state.catalog.length){setStatus('#mdbStatus','Import an IPTV catalog first so Swoop TV has something to match against.','err');return}const fd=new FormData(e.currentTarget),apiKey=String(fd.get('apiKey')||'').trim();try{setStatus('#mdbStatus','Fetching MDBList and matching it against your provider catalog…');const payload=await getMDBListItems({apiKey,listId:String(fd.get('listId')||'').trim(),username:String(fd.get('username')||'').trim(),listName:String(fd.get('listName')||'').trim()});const matched=matchMDBListToCatalog(payload,state.catalog);state.settings.mdblistApiKey=apiKey;const uid=`mdb-${Date.now()}-${Math.abs(hash(String(fd.get('rowName')||'MDBList')))%10000}`;const source={listId:String(fd.get('listId')||'').trim(),username:String(fd.get('username')||'').trim(),listName:String(fd.get('listName')||'').trim()};state.mdblistRows.push({uid,name:String(fd.get('rowName')||'MDBList'),items:matched,source,updatedAt:Date.now(),error:''});state.settings.homeRows.push(`custom:${uid}`);persist(true);setStatus('#mdbStatus',`Matched ${matched.length} titles from this MDBList to your provider catalog. It is now enabled on Home and will refresh automatically.`,'ok');setTimeout(()=>{modal=null;state.page='home';render()},650)}catch(err){setStatus('#mdbStatus',err.message||String(err),'err')}});
}

window.addEventListener('keydown',e=>{if(e.key==='Escape'&&playerItem){closePlayer();return}if(e.key==='Escape'&&detailItem){closeDetail();return}if(e.key==='Escape'&&modal){modal=null;render();return}if((e.key==='ArrowRight'||e.key==='ArrowLeft'||e.key==='ArrowDown'||e.key==='ArrowUp')&&!['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName)){const focusables=[...document.querySelectorAll('button:not([hidden]),[tabindex="0"]')].filter(x=>x.offsetParent!==null);const i=focusables.indexOf(document.activeElement);if(i>=0){e.preventDefault();focusables[(i+(e.key==='ArrowRight'||e.key==='ArrowDown'?1:-1)+focusables.length)%focusables.length].focus()}}});
if(!NATIVE_WINDOWS&&'serviceWorker'in navigator&&location.protocol.startsWith('http'))navigator.serviceWorker.register('./sw.js').catch(()=>{});

async function restoreDurableLibrary(){
  try{
    // A catalog present here came from the legacy localStorage format. Migrate
    // it once into IndexedDB so future refreshes do not hit browser quota.
    if(state.catalog.length){await persist(true);return}
    const bulk=await loadBulkState();
    if(!bulk)return;
    if(Array.isArray(bulk.catalog))state.catalog=bulk.catalog;
    if(bulk.webDiscovery&&typeof bulk.webDiscovery==='object')state.webDiscovery=bulk.webDiscovery;
    if(!invalidateMetadataArtwork&&bulk.metadataCache&&typeof bulk.metadataCache==='object')state.metadataCache=bulk.metadataCache;else if(invalidateMetadataArtwork)state.metadataCache={};
    if(Array.isArray(bulk.mdblistRows)&&bulk.mdblistRows.length){
      const compact=new Map((state.mdblistRows||[]).map(r=>[r.uid,r]));
      state.mdblistRows=bulk.mdblistRows.map(r=>({...compact.get(r.uid),...r}));
    }
    sessionRelay={url:state.settings.xtreamRelayUrl||state.provider?.relayUrl||savedProviderProfile?.relayUrl||'',token:state.settings.xtreamRelayToken||state.provider?.relayToken||savedProviderProfile?.relayToken||''};
    sessionXtream={server:state.provider?.server||savedProviderProfile?.server||'',username:state.provider?.username||savedProviderProfile?.username||'',password:state.provider?.password||savedProviderProfile?.password||'',relayUrl:state.provider?.relayUrl||savedProviderProfile?.relayUrl||state.settings.xtreamRelayUrl||'',relayToken:state.provider?.relayToken||savedProviderProfile?.relayToken||state.settings.xtreamRelayToken||''};
  }finally{
    storageRestoring=false;
    render();
  }
}

render();
restoreDurableLibrary();
