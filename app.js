import {parseM3U} from './src/m3u.js';
import {parseXMLTV} from './src/xmltv.js';
import {testXtream, importXtream, fetchXtreamAssetBlob, fetchXtreamSeriesInfo, fetchXtreamVodInfo, fetchXtreamShortEpg, buildXtreamSeriesStreamUrl} from './src/xtream.js';
import {isNativeWindows, nativePlay, nativeStop, nativeFetchText, nativeDiagnostics, nativeControl, nativeSwitchLive} from './src/native.js';
import {nativeCatalogStatus,nativeCatalogReplaceProvider,nativeCatalogRemoveProvider,nativeCatalogQuery,nativeCatalogSearch,nativeCatalogCategories,nativeCatalogGet,nativeCatalogSources,nativeCatalogMatchPayload} from './src/nativeCatalog.js';
import {getMDBListItems, getMDBListOfficialItems, getMDBListStreamingChart, matchMDBListToCatalog, normalizeMediaTitle} from './src/mdblist.js';
import {fetchTitleMetadata, fetchTitleImdbRating, metadataServiceUrl} from './src/tmdb.js';
import {fetchSwoopDiscovery} from './src/discovery.js';
import {buildMovieStackIndex, collapseMovieSources, cleanDisplayTitle, rankSources, sourceTraits, qualityLabel} from './src/sourceStack.js';
import {buildLiveStackIndex, selectLiveSource} from './src/liveStack.js';
import {PROFILE_AVATARS, avatarById, makeProfile, normalizeProfile, profileAllowsMedia, profileGenreAffinity, smartRankRows} from './src/profiles.js';
import {SWOOP_THEMES, themeById} from './src/themes.js';
import {loadState, loadBulkState, saveState, saveBulkState, loadProviderProfile, saveProviderProfile, clearProviderProfile, loadProviderProfiles, saveProviderProfiles, clearProviderProfiles, clearState, loadAuxState, retireBrowserCatalog} from './src/storage.js';
import {demoCatalog} from './src/demo.js';

const NATIVE_WINDOWS=isNativeWindows();
let nativeCatalogMode=false,nativeCatalogStats=null,nativeCatalogMigration=false;
const nativeItemCache=new Map();
const nativePageCache={movie:{key:'',items:[],total:0,loading:false},series:{key:'',items:[],total:0,loading:false},live:{key:'',items:[],total:0,loading:false}};
const nativeCategoryCache={movie:[],series:[],live:[]};
const nativeHomeRowCache=new Map();let nativeHomePrimeBusy=false;
const NATIVE_HOME_SEARCH={
'action-movies':['movie','action'],'comedy-movies':['movie','comedy'],'drama-movies':['movie','drama'],'horror-movies':['movie','horror'],'thriller-movies':['movie','thriller'],'scifi-movies':['movie','sci fi'],'family-movies':['movie','family'],'animation-movies':['movie','animation'],'romance-movies':['movie','romance'],'adventure-movies':['movie','adventure'],'fantasy-movies':['movie','fantasy'],'mystery-movies':['movie','mystery'],'western-movies':['movie','western'],'war-movies':['movie','war'],'music-movies':['movie','music'],
'drama-shows':['series','drama'],'crime-shows':['series','crime'],'comedy-shows':['series','comedy'],'reality-shows':['series','reality'],'action-shows':['series','action'],'scifi-shows':['series','sci fi'],'mystery-shows':['series','mystery'],'thriller-shows':['series','thriller'],'animation-shows':['series','animation'],'family-shows':['series','family']};
async function loadNativeHomeRow(id){
  if(!nativeCatalogMode||nativeHomeRowCache.has(id))return nativeHomeRowCache.get(id)||[];let result=[];
  if(String(id).startsWith('cat:')){const parts=String(id).split(':'),kind=parts[1],group=decodeURIComponent(parts.slice(2).join(':'));result=(await nativeCatalogQuery({kind,providerIds:nativeEnabledProviderIds(),group,limit:HOME_STANDARD_ROW_LIMIT,sort:'recent'})).items||[]}
  else if(id==='new-movies'||id==='movies')result=(await nativeCatalogQuery({kind:'movie',providerIds:nativeEnabledProviderIds(),limit:HOME_STANDARD_ROW_LIMIT,sort:'recent'})).items||[];
  else if(id==='new-shows'||id==='shows')result=(await nativeCatalogQuery({kind:'series',providerIds:nativeEnabledProviderIds(),limit:HOME_STANDARD_ROW_LIMIT,sort:'recent'})).items||[];
  else if(id==='live-now')result=(await nativeCatalogQuery({kind:'live',providerIds:nativeEnabledProviderIds(),limit:HOME_STANDARD_ROW_LIMIT,sort:'name'})).items||[];
  else if(id==='top-rated-movies')result=(await nativeCatalogQuery({kind:'movie',providerIds:nativeEnabledProviderIds(),limit:HOME_STANDARD_ROW_LIMIT,sort:'rating'})).items||[];
  else if(id==='top-rated-shows')result=(await nativeCatalogQuery({kind:'series',providerIds:nativeEnabledProviderIds(),limit:HOME_STANDARD_ROW_LIMIT,sort:'rating'})).items||[];
  else if(id==='documentary'){const a=await nativeCatalogSearch('documentary',{providerIds:nativeEnabledProviderIds(),limit:HOME_STANDARD_ROW_LIMIT,kinds:['movie','series']});result=a.items||[]}
  else if(NATIVE_HOME_SEARCH[id]){const [kind,term]=NATIVE_HOME_SEARCH[id],a=await nativeCatalogSearch(term,{providerIds:nativeEnabledProviderIds(),limit:HOME_STANDARD_ROW_LIMIT,kinds:[kind]});result=a.items||[]}
  result=cacheNativeItems(result);nativeHomeRowCache.set(id,result);return result;
}
async function primeNativeHomeRows(){if(!nativeCatalogMode||nativeHomePrimeBusy||state.page!=='home')return;const skip=new Set(['continue','recently-watched','recommended','recent-live','mylist']);const ids=selectedHomeRows().map(x=>x.id).filter(id=>!WEB_ROW_IDS.has(id)&&!String(id).startsWith('custom:')&&!skip.has(id)&&!nativeHomeRowCache.has(id)).slice(0,10);if(!ids.length)return;nativeHomePrimeBusy=true;try{for(const id of ids){await loadNativeHomeRow(id).catch(()=>[]);await new Promise(r=>setTimeout(r,0))}}finally{nativeHomePrimeBusy=false;if(state.page==='home'&&!modal&&!detailItem&&!playerItem)render()}}
function cacheNativeItems(list=[]){
  for(const item of list||[]){
    if(!item?.id)continue;
    nativeItemCache.set(item.id,item);
    if(item._nativeSourceId)nativeItemCache.set(String(item._nativeSourceId),item);
    for(const alias of Array.isArray(item._nativeSourceIds)?item._nativeSourceIds:[])if(alias)nativeItemCache.set(String(alias),item);
  }
  return list||[];
}
function nativeEnabledProviderIds(){return state?.providers?.filter(p=>p.enabled!==false).map(p=>p.id)||[]}
function nativeTotal(kind,raw=false){if(!nativeCatalogStats)return 0;const enabled=new Set(nativeEnabledProviderIds()),rows=(nativeCatalogStats.providers||[]).filter(x=>x.kind===kind&&(!enabled.size||enabled.has(x.provider_id)));return rows.reduce((n,r)=>n+Number(r?.[raw?'raw_count':'unique_count']||0),0)}
function catalogLogicalTotal(){return nativeCatalogMode?['live','movie','series'].reduce((n,k)=>n+nativeTotal(k),0):activeCatalog().length}
function catalogRawTotal(){return nativeCatalogMode?Number(nativeCatalogStats?.rowCount||0):state.catalog.length}
function nativeProviderCounts(id){const rows=(nativeCatalogStats?.providers||[]).filter(x=>x.provider_id===id),out={live:0,movie:0,series:0,total:0};for(const r of rows){out[r.kind]=Number(r.unique_count||0);out.total+=Number(r.raw_count||0)}return out}
async function hydrateNativeProfileItems(){if(!nativeCatalogMode)return;const ids=[...(state.myList||[]),...(state.recentLive||[]),...(state.continueWatching||[]).map(x=>x?.id||x).filter(Boolean),...(state.watchHistory||[]).map(x=>x?.id||x).filter(Boolean)];const unique=[...new Set(ids.filter(x=>typeof x==='string'&&x))].slice(0,250);if(!unique.length)return;try{const result=await nativeCatalogGet(unique);cacheNativeItems(result?.items||[])}catch{}}
async function refreshNativeCatalogStats(){if(!NATIVE_WINDOWS)return null;try{nativeCatalogStats=await nativeCatalogStatus();return nativeCatalogStats}catch{return null}}
async function activateNativeCatalogIfAvailable(){
  if(!NATIVE_WINDOWS)return false;const status=await refreshNativeCatalogStats();if(!status?.rowCount)return false;
  nativeCatalogMode=true;
  const aux=await loadAuxState().catch(()=>null);if(aux){if(aux.webDiscovery)state.webDiscovery=aux.webDiscovery;if(!invalidateMetadataArtwork&&aux.metadataCache)state.metadataCache=sanitizeImdbMetadataCache(aux.metadataCache);metadataRevision++;if(Array.isArray(aux.mdblistRows)&&aux.mdblistRows.length){const compact=new Map((state.mdblistRows||[]).map(r=>[r.uid,r]));state.mdblistRows=aux.mdblistRows.map(r=>({...compact.get(r.uid),...r}))}}
  const [movies,series,live,catsM,catsS,catsL]=await Promise.all([
    nativeCatalogQuery({kind:'movie',providerIds:nativeEnabledProviderIds(),limit:144,sort:'recent'}),nativeCatalogQuery({kind:'series',providerIds:nativeEnabledProviderIds(),limit:96,sort:'recent'}),nativeCatalogQuery({kind:'live',providerIds:nativeEnabledProviderIds(),limit:144,sort:'name'}),
    nativeCatalogCategories('movie',{providerIds:nativeEnabledProviderIds(),limit:40}),nativeCatalogCategories('series',{providerIds:nativeEnabledProviderIds(),limit:40}),nativeCatalogCategories('live',{providerIds:nativeEnabledProviderIds(),limit:60})
  ]);
  state.catalog=[...cacheNativeItems(movies?.items||[]),...cacheNativeItems(series?.items||[]),...cacheNativeItems(live?.items||[])];
  nativeCategoryCache.movie=catsM?.items||[];nativeCategoryCache.series=catsS?.items||[];nativeCategoryCache.live=catsL?.items||[];
  for(const p of state.providers)p.counts=nativeProviderCounts(p.id);
  resetMovieStackIndex();libraryRestored=true;await hydrateNativeProfileItems();return true;
}
async function migrateCatalogToNative(){
  if(!NATIVE_WINDOWS||nativeCatalogMigration||!state.catalog.length)return false;nativeCatalogMigration=true;
  try{
    const byProvider=new Map();for(const item of state.catalog){const id=item.providerId||state.provider?.id||'legacy';if(!byProvider.has(id))byProvider.set(id,[]);byProvider.get(id).push(item)}
    let done=0,total=state.catalog.length;
    for(const [providerId,list] of byProvider){await nativeCatalogReplaceProvider(providerId,list,{onProgress:info=>updateRestoreProgress({phase:'sqlite',loaded:done+info.loaded,total,items:done+info.loaded})});done+=list.length}
    await refreshNativeCatalogStats();return true;
  }finally{nativeCatalogMigration=false}
}
async function ensureNativePage(kind,{force=false}={}){
  if(!nativeCatalogMode)return null;const cache=nativePageCache[kind],limit=viewLimits[kind]||(kind==='live'?96:72),group=kind==='live'?liveCategory:(pageCategory[kind]||''),key=`${providerFilter}|${group}|${limit}`;if(!force&&cache.key===key&&cache.items.length)return cache;if(cache.loading)return cache;cache.loading=true;
  try{const result=await nativeCatalogQuery({kind,providerId:providerFilter,providerIds:providerFilter==='all'?nativeEnabledProviderIds():[],group,limit,offset:0,sort:kind==='live'?'name':'recent'});cache.key=key;cache.items=cacheNativeItems(result?.items||[]);cache.total=Number(result?.total||cache.items.length);return cache}finally{cache.loading=false}
}
function scheduleNativePage(kind,force=false){if(!nativeCatalogMode)return;const cache=nativePageCache[kind],group=kind==='live'?liveCategory:(pageCategory[kind]||''),want=`${providerFilter}|${group}|${viewLimits[kind]||(kind==='live'?96:72)}`;if(!force&&cache.key===want&&cache.items.length)return;setTimeout(async()=>{const before=cache.key;await ensureNativePage(kind,{force});if((before!==cache.key||force)&&((state.page==='movies'&&kind==='movie')||(state.page==='series'&&kind==='series')||(state.page==='live'&&kind==='live')))render()},0)}
const PINNED_HOME_ROWS=['continue','top20-movies','top20-shows'];
function normalizeHomeRows(rows=[]){const source=Array.isArray(rows)?rows:[],rest=[];for(const id of source){if(!id||id==='because-you-watched'||PINNED_HOME_ROWS.includes(id)||rest.includes(id))continue;rest.push(id)}return [...PINNED_HOME_ROWS,...rest]}
const DEFAULT_HOME_ROWS=normalizeHomeRows(['continue','top20-movies','top20-shows','recommended','recently-watched','recent-live','mylist','trending-movies','trending-shows','new-hot-movies','new-hot-shows','live-now','new-movies','new-shows','action-movies','comedy-movies','drama-shows']);
const DEFAULT_STATE={page:'home',catalog:[],provider:null,providers:[],myList:[],favourites:[],liveFavourites:[],continueWatching:[],watchHistory:[],recentLive:[],profiles:[],activeProfileId:'',mdblistRows:[],webDiscovery:{},metadataCache:{},settings:{mdblistApiKey:'',xtreamRelayUrl:'',xtreamRelayToken:'',metadataServiceUrl:'',themeId:'chill',backgroundColor:'#050505',backgroundOverride:false,movieSourcePreferences:{},homeRows:[...DEFAULT_HOME_ROWS],smartHomeOrder:true,performanceMode:'auto'}};
const loaded=loadState()||{};
let savedProviderProfiles=loadProviderProfiles()||[];
let savedProviderProfile=savedProviderProfiles[0]||loadProviderProfile()||null;
const state=Object.assign({},DEFAULT_STATE,loaded,{settings:{...DEFAULT_STATE.settings,...(loaded.settings||{})},webDiscovery:{...(loaded.webDiscovery||{})},metadataCache:{...(loaded.metadataCache||{})}});

if(!Array.isArray(state.providers))state.providers=[];
if(!state.providers.length&&state.provider?.id){state.providers=[{...state.provider,enabled:true,priority:0,status:'connected',lastRefreshed:Date.now(),counts:{}}];}
if(!state.providers.length&&savedProviderProfiles.length){state.providers=savedProviderProfiles.map((p,i)=>({id:p.id||`${p.type||'provider'}-${Math.abs(hash(`${p.server||p.url||p.name||i}|${p.username||''}`))}`,type:p.type||'xtream',name:p.name||`Provider ${i+1}`,server:p.server||'',url:p.url||'',epgUrl:p.epgUrl||'',relayUrl:p.relayUrl||'',enabled:p.enabled!==false,priority:Number.isFinite(Number(p.priority))?Number(p.priority):i,status:'saved',lastRefreshed:Number(p.lastRefreshed||0),counts:p.counts||{}}));}
state.providers=state.providers.map((p,i)=>({...p,enabled:p.enabled!==false,priority:Number.isFinite(Number(p.priority))?Number(p.priority):i,status:p.status||'connected',counts:p.counts||{}})).sort((a,b)=>Number(a.priority)-Number(b.priority));
function syncLegacyProvider(){const enabled=state.providers.filter(p=>p.enabled!==false).sort((a,b)=>Number(a.priority)-Number(b.priority));state.provider=enabled[0]||null;return state.provider}
syncLegacyProvider();
if(!Array.isArray(state.settings.homeRows)||!state.settings.homeRows.length)state.settings.homeRows=[...DEFAULT_HOME_ROWS];
state.settings.homeRows=normalizeHomeRows(state.settings.homeRows);
if(Number(state.settings.personalizationSchemaVersion||0)<2){for(const id of ['recommended','recently-watched','recent-live'])if(!state.settings.homeRows.includes(id))state.settings.homeRows.push(id);state.settings.homeRows=normalizeHomeRows(state.settings.homeRows);state.settings.personalizationSchemaVersion=2;}
if(state.settings.discoverySchemaVersion!==3){state.webDiscovery={};state.settings.discoverySchemaVersion=3;}
const METADATA_ARTWORK_SCHEMA=3;
const invalidateMetadataArtwork=Number(state.settings.metadataArtworkSchemaVersion||0)!==METADATA_ARTWORK_SCHEMA;
if(invalidateMetadataArtwork){state.metadataCache={};state.settings.metadataArtworkSchemaVersion=METADATA_ARTWORK_SCHEMA;}
const IMDB_RATING_SCHEMA=2;
const invalidateImdbRatings=Number(state.settings.imdbRatingSchemaVersion||0)!==IMDB_RATING_SCHEMA;
function sanitizeImdbMetadataCache(cache={}){
  if(!cache||typeof cache!=='object')return {};
  if(invalidateImdbRatings){for(const meta of Object.values(cache)){if(!meta||typeof meta!=='object')continue;const valid=tenPointRating(meta.imdbRating);if(valid){meta.imdbRating=valid;meta.imdbRatingCheckedAt=Number(meta.imdbRatingCheckedAt||Date.now())}else{delete meta.imdbRating;delete meta.imdbRatingCheckedAt;}}}
  return cache;
}
state.metadataCache=sanitizeImdbMetadataCache(state.metadataCache);
state.settings.imdbRatingSchemaVersion=IMDB_RATING_SCHEMA;
if(!Array.isArray(state.myList)||!state.myList.length) state.myList=Array.isArray(state.favourites)?[...state.favourites]:[];
if(!Array.isArray(state.continueWatching)) state.continueWatching=[];
if(!Array.isArray(state.watchHistory)) state.watchHistory=[];
if(!Array.isArray(state.recentLive)) state.recentLive=[];
if(!Array.isArray(state.liveFavourites)) state.liveFavourites=[];
if(!state.settings.movieSourcePreferences||typeof state.settings.movieSourcePreferences!=='object')state.settings.movieSourcePreferences={};
if(!Array.isArray(state.mdblistRows))state.mdblistRows=[];
state.mdblistRows.forEach((r,i)=>{if(!r.uid)r.uid=`legacy-${Math.abs(hash(String(r.name||'row')+i))}`;});
if(!loaded.settings?.homeRows&&state.mdblistRows.length)state.settings.homeRows.push(...state.mdblistRows.map(r=>`custom:${r.uid}`));

const PROFILE_SETTING_KEYS=['themeId','backgroundColor','backgroundOverride','movieSourcePreferences','homeRows','smartHomeOrder'];
function profileSettingsSnapshot(){const out={};for(const key of PROFILE_SETTING_KEYS){const value=state.settings?.[key];out[key]=Array.isArray(value)?[...value]:value&&typeof value==='object'?{...value}:value}return out}
function currentProfileSnapshot(base={}){return normalizeProfile({...base,id:base.id||state.activeProfileId,name:base.name||'Swoop',avatar:base.avatar||'lion',kids:Boolean(base.kids),pinHash:base.pinHash||'',pinSalt:base.pinSalt||'',myList:[...(state.myList||[])],continueWatching:[...(state.continueWatching||[])],watchHistory:[...(state.watchHistory||[])],recentLive:[...(state.recentLive||[])],liveFavourites:[...(state.liveFavourites||[])],profileSettings:profileSettingsSnapshot()})}
function activeProfile(){return state.profiles.find(p=>p.id===state.activeProfileId)||state.profiles[0]||null}
function ensureProfiles(){
  if(!Array.isArray(state.profiles)||!state.profiles.length){
    const first=makeProfile({id:'profile-main',name:'Swoop',avatar:'lion',myList:state.myList,continueWatching:state.continueWatching,watchHistory:state.watchHistory,recentLive:state.recentLive,liveFavourites:state.liveFavourites,profileSettings:profileSettingsSnapshot()});
    state.profiles=[first];state.activeProfileId=first.id;
  }else{
    state.profiles=state.profiles.map((p,i)=>normalizeProfile(p,{name:p?.name||`Profile ${i+1}`,avatar:p?.avatar||PROFILE_AVATARS[i%PROFILE_AVATARS.length].id,profileSettings:{themeId:'chill',backgroundColor:'#050505',backgroundOverride:false,movieSourcePreferences:{},homeRows:[...DEFAULT_HOME_ROWS],smartHomeOrder:true}}));
    if(!state.profiles.some(p=>p.id===state.activeProfileId))state.activeProfileId=state.profiles[0].id;
  }
}
function syncActiveProfileFromState(){const i=state.profiles.findIndex(p=>p.id===state.activeProfileId);if(i<0)return;state.profiles[i]=currentProfileSnapshot(state.profiles[i])}
function applyProfileToState(profile){if(!profile)return;state.myList=[...(profile.myList||[])];state.continueWatching=[...(profile.continueWatching||[])];state.watchHistory=[...(profile.watchHistory||[])];state.recentLive=[...(profile.recentLive||[])];state.liveFavourites=[...(profile.liveFavourites||[])];const ps=profile.profileSettings||{},legacyBg=ps.backgroundColor||'#050505';state.settings.themeId=themeById(ps.themeId||'chill').id;state.settings.backgroundColor=legacyBg;state.settings.backgroundOverride=typeof ps.backgroundOverride==='boolean'?ps.backgroundOverride:Boolean(!ps.themeId&&String(legacyBg).toLowerCase()!=='#050505');state.settings.movieSourcePreferences={...(ps.movieSourcePreferences||{})};state.settings.homeRows=normalizeHomeRows(Array.isArray(ps.homeRows)&&ps.homeRows.length?[...ps.homeRows]:[...DEFAULT_HOME_ROWS]);state.settings.smartHomeOrder=ps.smartHomeOrder!==false}
ensureProfiles();
applyProfileToState(activeProfile());

let modal=null,toastTimer=null,playerItem=null,playerUiHidden=false,activeHls=null,trailerKey='',trailerTitle='',sourceChoiceItem=null;
let profilePickerOpen=true,profileEditId='',pendingProfileId='',profilePinError='';
let playbackMonitorTimer=null,lastPlaybackPersist=0,playerStartedAt=0,upNextTimer=null,upNextSeconds=0,upNextItem=null;
let liveMiniGuideToken=0,channelNumberBuffer='',channelNumberTimer=null;
let heroRotationIndex=0,heroRotationTimer=null;
const HERO_ROTATION_MS=8000;
const LARGE_LIBRARY_THRESHOLD=12000;
const HOME_EAGER_ROWS=5;
const HOME_EAGER_CARDS=12;
const HOME_TOP20_LIMIT=20;
const HOME_STANDARD_ROW_LIMIT=100;
let lazyHomeObserver=null,searchDebounceTimer=null;
function largeLibraryMode(){return state.settings.performanceMode!=='cinematic'&&catalogLogicalTotal()>=LARGE_LIBRARY_THRESHOLD}
function performanceLabel(){return largeLibraryMode()?'Optimized for large library':'Full cinematic rendering'}
let discoveryRefreshing=false,discoveryMessage='';
const metadataPending=new Map();
const visibleMetadataQueue=[];
const visibleMetadataQueued=new Set();
let visibleMetadataActive=0,visibleMetadataObserver=null;
const DISCOVERY_REFRESH_MS=4*60*60*1000;
const DISCOVERY_FAST_REFRESH_MS=90*60*1000;
const discoveryBundleMemory=new Map();
let detailItem=null,detailPayload=null,detailLoading=false,detailError='',detailSeason='';
const detailCache=new Map();
const detailEpisodeItems=new Map();
const viewLimits={live:96,movie:72,series:72};
let guideLimit=24,liveCategory='',providerFilter='all',pageCategory={movie:'',series:''};
let guideStart=Math.floor(Date.now()/1800000)*1800000;
const epgCache=new Map();
let guideLoading=false,guideError='';
let m3uGuideLoaded=false;const m3uGuideLoadedProviders=new Set();
const sessionProviderConfigs=new Map();
function providerProfileId(p={},fallback=''){if(p.id)return String(p.id);if(p.type==='m3u')return `m3u-${Math.abs(hash(String(p.url||p.name||fallback)))}`;return `xtream-${Math.abs(hash(`${p.server||''}|${p.username||''}`))}`}
for(const p of savedProviderProfiles){const id=providerProfileId(p);if(id)sessionProviderConfigs.set(id,{...p,id});}
function providerById(id=''){return state.providers.find(p=>p.id===id)||null}
function providerConfigById(id=''){const session=sessionProviderConfigs.get(id);if(session)return session;const saved=savedProviderProfiles.find(p=>providerProfileId(p)===id);if(saved)return saved;const p=providerById(id);return p?{...p}:null}
function providerConfigFor(itemOrId){const id=typeof itemOrId==='string'?itemOrId:itemOrId?.providerId;return providerConfigById(id)||providerConfigById(state.provider?.id)||{};}
function providerDisplayName(itemOrId){const id=typeof itemOrId==='string'?itemOrId:itemOrId?.providerId;return providerById(id)?.name||'TV Provider'}
function enabledProviders(){return state.providers.filter(p=>p.enabled!==false).sort((a,b)=>Number(a.priority)-Number(b.priority))}
function providerSummaryName(){const list=enabledProviders();if(list.length>1)return `${list.length} Providers`;if(list.length===1)return list[0].name;return state.providers.length?'No Providers Enabled':'Demo Library'}
function providerCatalogCounts(id){if(nativeCatalogMode&&nativeCatalogStats)return nativeProviderCounts(id);const list=state.catalog.filter(x=>x.providerId===id);return {live:list.filter(x=>x.kind==='live').length,movie:list.filter(x=>x.kind==='movie').length,series:list.filter(x=>x.kind==='series').length,total:list.length}}
function syncProviderCounts(){for(const p of state.providers)p.counts=providerCatalogCounts(p.id)}
let sessionRelay={url:state.settings.xtreamRelayUrl||state.provider?.relayUrl||savedProviderProfile?.relayUrl||'',token:state.settings.xtreamRelayToken||state.provider?.relayToken||savedProviderProfile?.relayToken||''};
let sessionXtream=providerConfigById(state.provider?.id)||{server:'',username:'',password:'',relayUrl:'',relayToken:''};
let storageRestoring=false;
let libraryRestored=Boolean(state.catalog.length);
let libraryRestorePromise=null;
const artworkCache=new Map();
const artworkRelayQueue=[]; let artworkRelayActive=0;
let artworkObserver=null;
let detailReturnScroll=0,detailScrollTop=0;
const $app=document.querySelector('#app');

function esc(s=''){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function hash(s=''){let h=0;for(let i=0;i<s.length;i++)h=((h<<5)-h)+s.charCodeAt(i)|0;return h}
let activeCatalogSourceRef=null,activeCatalogContext='',activeCatalogCache=[],metadataRevision=0;
function activeCatalog(){
  const source=state.catalog.length?state.catalog:demoCatalog,profile=activeProfile(),enabledKey=state.catalog.length&&state.providers.length?enabledProviders().map(p=>p.id).join('|'):'all',context=`${enabledKey}|${profile?.kids?`${profile.id}:${metadataRevision}`:'standard'}`;
  if(activeCatalogSourceRef===source&&activeCatalogContext===context)return activeCatalogCache;
  let base=source;
  if(state.catalog.length&&state.providers.length){const enabled=new Set(enabledProviders().map(p=>p.id));base=base.filter(item=>!item.providerId||enabled.has(item.providerId));}
  activeCatalogCache=profile?.kids?base.filter(item=>profileAllowsMedia(profile,item,state.metadataCache?.[item.id]||{})):base;
  activeCatalogSourceRef=source;activeCatalogContext=context;return activeCatalogCache;
}
let movieStackCatalogRef=null,movieStackIndex=null,liveStackCatalogRef=null,liveStackIndex=null,movieStackPriorityKey='',liveStackPriorityKey='';
function getMovieStackIndex(){const catalog=activeCatalog(),priorityKey=state.providers.map(p=>`${p.id}:${p.priority}`).join('|');if(movieStackCatalogRef!==catalog||movieStackPriorityKey!==priorityKey||!movieStackIndex){movieStackCatalogRef=catalog;movieStackPriorityKey=priorityKey;movieStackIndex=buildMovieStackIndex(catalog,providerPriorityMap())}return movieStackIndex}
function providerPriorityMap(){return Object.fromEntries(state.providers.map((p,i)=>[p.id,Number.isFinite(Number(p.priority))?Number(p.priority):i]))}
function getLiveStackIndex(){const catalog=activeCatalog(),priorityKey=state.providers.map(p=>`${p.id}:${p.priority}`).join('|');if(liveStackCatalogRef!==catalog||liveStackPriorityKey!==priorityKey||!liveStackIndex){liveStackCatalogRef=catalog;liveStackPriorityKey=priorityKey;liveStackIndex=buildLiveStackIndex(catalog,providerPriorityMap())}return liveStackIndex}
function resetMovieStackIndex(){activeCatalogSourceRef=null;activeCatalogContext='';activeCatalogCache=[];movieStackCatalogRef=null;movieStackIndex=null;movieStackPriorityKey='';liveStackCatalogRef=null;liveStackIndex=null;liveStackPriorityKey='';searchIndexKey='';searchIndexCache=[];if(typeof nativeHomeRowCache!=='undefined')nativeHomeRowCache.clear();for(const k of ['movie','series','live'])if(nativePageCache?.[k]){nativePageCache[k].key='';nativePageCache[k].items=[];nativePageCache[k].total=0}}
function items(kind){if(kind==='movie')return getMovieStackIndex().stacked;if(kind==='live')return getLiveStackIndex().stacked;return activeCatalog().filter(x=>x.kind===kind)}
function preferredLiveSource(item){if(item?.kind!=='live')return item;if(providerFilter!=='all'&&Array.isArray(item.sources)){const filtered=item.sources.filter(s=>s.providerId===providerFilter);if(filtered.length)return selectLiveSource({...item,sources:filtered},providerPriorityMap())}return selectLiveSource(item,providerPriorityMap())}
function logicalItemIds(item){
  if(!item)return[];
  return [...new Set([
    item.id,
    item._nativeSourceId,
    ...(Array.isArray(item._nativeSourceIds)?item._nativeSourceIds:[]),
    ...(Array.isArray(item.sources)?item.sources.map(x=>x.id):[])
  ].filter(Boolean).map(String))];
}
function isLiveFavourite(item){return Boolean(item?.id&&state.liveFavourites.includes(item.id))}
function toggleLiveFavourite(item){if(!item?.id||item.kind!=='live')return;const on=isLiveFavourite(item);state.liveFavourites=on?state.liveFavourites.filter(id=>id!==item.id):[item.id,...state.liveFavourites.filter(id=>id!==item.id)].slice(0,120);persist();toast(on?'Removed from Favourite Channels':'Added to Favourite Channels');render()}
function savedMovieSourcePreference(item){return item?.id?String(state.settings.movieSourcePreferences?.[item.id]||''):''}
function rememberMovieSourcePreference(item,sourceId){if(!item?.id||!sourceId)return;state.settings.movieSourcePreferences={...(state.settings.movieSourcePreferences||{}),[item.id]:sourceId};persist()}
function orderedMovieSources(item){if(!item||!Array.isArray(item.sources))return[];const preferred=savedMovieSourcePreference(item)||continueEntry(item.id)?.selectedSourceId||'';return rankSources(item.sources,preferred)}
function sourceTechSummary(source){const t=sourceTraits(source);return [t.quality,t.hdr,t.codec,t.audio].filter(Boolean).join(' · ')||'Provider default'}
function isInMyList(item){if(!item)return false;const ids=new Set(logicalItemIds(item));return state.myList.some(id=>ids.has(id))}
function continueEntry(id){const item=savedItem(id),ids=new Set(item?logicalItemIds(item):[id]);return state.continueWatching.find(x=>ids.has(x?.id))}
function savedItem(id){const nativeHit=nativeItemCache.get(id);if(nativeHit)return nativeHit;const stack=getMovieStackIndex(),live=getLiveStackIndex();return stack.byStackId.get(id)||stack.bySourceId.get(id)||live.byStackId?.get(id)||live.bySourceId?.get(id)||activeCatalog().find(x=>x.id===id)||detailEpisodeItems.get(id)||state.continueWatching.find(x=>x?.id===id)?.item||null}
function isDemoItem(item){return Boolean(item&&(item.source==='demo'||item.providerId==='demo'||String(item.id||'').startsWith('demo:')))}
function visualItem(item){
  if(!item)return item;
  // Demo titles are intentionally fictional UI placeholders. Never let cached/remote metadata
  // turn a synthetic title into unrelated real-world artwork just because the names collide.
  if(isDemoItem(item))return {...item,logo:'',backdrop:'',titleLogo:'',plot:'',rating:'',imdbRating:'',tmdbId:'',imdbId:''};
  const meta=state.metadataCache?.[item.id]||{};
  return {...item,...(meta||{}),logo:meta.poster||item.logo||'',backdrop:meta.backdrop||item.backdrop||'',plot:meta.plot||item.plot||'',year:meta.year||item.year||'',rating:meta.rating||item.rating||'',imdbRating:meta.imdbRating||item.imdbRating||'',tmdbId:meta.tmdbId||item.tmdbId||'',imdbId:meta.imdbId||item.imdbId||''};
}
function validHex(value){return /^#[0-9a-f]{6}$/i.test(String(value||''))?String(value).toLowerCase():'#050505'}
function applyTheme(){const theme=themeById(state.settings.themeId||'chill'),root=document.documentElement,override=Boolean(state.settings.backgroundOverride),bg=override?validHex(state.settings.backgroundColor):theme.bg;root.dataset.theme=theme.id;root.style.setProperty('--bg',bg);root.style.setProperty('--swoop-bg',bg);root.style.setProperty('--surface',theme.surface);root.style.setProperty('--surface-2',theme.surface2);root.style.setProperty('--surface-3',theme.surface3);root.style.setProperty('--text',theme.text);root.style.setProperty('--muted',theme.muted);root.style.setProperty('--accent',theme.accent);root.style.setProperty('--accent-2',theme.accent2);root.style.setProperty('--theme-base-bg',theme.bg);document.querySelector('meta[name=theme-color]')?.setAttribute('content',bg);root.dataset.performance=largeLibraryMode()?'lean':'cinematic';}
function currentTheme(){return themeById(state.settings.themeId||'chill')}
function profileTheme(profile){return themeById(profile?.profileSettings?.themeId||'chill')}
function themePickerHtml(selectedId='chill',name='themeId'){const selected=themeById(selectedId).id;return `<div class="theme-picker-grid">${SWOOP_THEMES.map(t=>`<button type="button" class="theme-choice ${t.id===selected?'active':''}" data-profile-theme="${esc(t.id)}" data-theme-value="${esc(t.id)}"><span class="theme-swatch" style="--theme-swatch:${esc(t.swatch)}"><i></i><b>${esc(t.name)}</b></span><span><strong>${esc(t.name)}</strong><small>${esc(t.tagline)}</small></span></button>`).join('')}</div><input type="hidden" name="${esc(name)}" value="${esc(selected)}" id="profileThemeValue">`}
async function enrichItemMetadata(item,{rerender=true}={}){
  if(!item||isDemoItem(item)||!['movie','series'].includes(item.kind))return null;
  if(metadataPending.has(item.id))return metadataPending.get(item.id);
  const cached=state.metadataCache?.[item.id]||{},now=Date.now();
  const metadataFresh=Boolean(cached.checkedAt&&now-cached.checkedAt<7*86400000);
  const imdbFresh=Boolean(cached.imdbRatingCheckedAt&&now-cached.imdbRatingCheckedAt<30*86400000);
  if(metadataFresh&&imdbFresh)return cached;
  const task=(async()=>{
    try{
      const metadata=await fetchTitleMetadata({settings:state.settings,item}),stamp=Date.now(),hasImdbField=Boolean(tenPointRating(metadata?.imdbRating));
      state.metadataCache[item.id]={...cached,...(metadata||{}),checkedAt:stamp,...(hasImdbField?{imdbRatingCheckedAt:stamp}:{})};metadataRevision++;
      if(metadata?.tmdbId&&!item.tmdbId)item.tmdbId=metadata.tmdbId;
      if(metadata?.imdbId&&!item.imdbId)item.imdbId=metadata.imdbId;
      persist('cache');
      if(rerender&&(state.page==='home'||detailItem?.id===item.id||modal==='homeRows'))render();
      return state.metadataCache[item.id];
    }catch(err){state.metadataCache[item.id]={...cached,checkedAt:Date.now(),error:err.message||String(err)};metadataRevision++;persist('cache');return state.metadataCache[item.id];}
  })().finally(()=>metadataPending.delete(item.id));
  metadataPending.set(item.id,task);
  return task;
}
function scheduleMetadataEnrichment(){
  const queue=[];
  for(const heroItem of heroCandidates().slice(0,largeLibraryMode()?4:10))if(heroItem)queue.push(heroItem);
  if(state.page==='home')for(const def of selectedHomeRows().slice(0,largeLibraryMode()?3:8))for(const item of homeRowItems(def.id).slice(0,largeLibraryMode()?3:5))queue.push(item);
  if(detailItem)queue.unshift(detailItem);
  for(const watched of watchHistoryItems().slice(0,largeLibraryMode()?2:6)){const source=watched.kind==='episode'?(savedItem(watched.parentSeriesId)||watched):watched;queue.push(source)}
  const unique=[...new Map(queue.filter(Boolean).map(x=>[x.id,x])).values()].filter(x=>!isDemoItem(x)&&['movie','series'].includes(x.kind)).slice(0,largeLibraryMode()?6:12);
  let i=0;const next=()=>{if(i>=unique.length)return;enrichItemMetadata(unique[i++],{rerender:false}).finally(()=>setTimeout(next,largeLibraryMode()?450:140))};next();
}
function visibleMetadataLimit(){return largeLibraryMode()?2:4}
function visibleMetadataDelay(){return largeLibraryMode()?180:70}
function updateVisibleImdbBadges(itemId){
  const rating=displayImdbRating({id:itemId});
  for(const el of document.querySelectorAll('[data-imdb-item]')){
    if(el.dataset.imdbItem!==String(itemId))continue;
    let badge=el.querySelector('.card-imdb-rating');
    if(rating){if(!badge){badge=document.createElement('span');badge.className='card-imdb-rating';el.appendChild(badge)}badge.innerHTML=`<b>IMDb</b> ${rating}`;}else badge?.remove();
    el.dataset.imdbHydrated='1';
  }
}
async function enrichVisibleImdbRating(item){
  if(!item||isDemoItem(item)||!['movie','series'].includes(item.kind))return null;
  const cached=state.metadataCache?.[item.id]||{},now=Date.now();
  if(cached.imdbRatingCheckedAt&&now-cached.imdbRatingCheckedAt<30*86400000)return cached;
  try{
    let ratingMeta=null;
    try{ratingMeta=await fetchTitleImdbRating({settings:state.settings,item:{...item,tmdbId:cached.tmdbId||item.tmdbId||'',imdbId:cached.imdbId||item.imdbId||''}})}catch{}
    if(!ratingMeta||!Object.prototype.hasOwnProperty.call(ratingMeta,'imdbRating')){
      const full=await enrichItemMetadata(item,{rerender:false});
      return full||state.metadataCache?.[item.id]||null;
    }
    const stamp=Date.now();
    state.metadataCache[item.id]={...cached,...ratingMeta,imdbRatingCheckedAt:stamp};metadataRevision++;
    if(ratingMeta.tmdbId&&!item.tmdbId)item.tmdbId=ratingMeta.tmdbId;
    if(ratingMeta.imdbId&&!item.imdbId)item.imdbId=ratingMeta.imdbId;
    persist('cache');
    return state.metadataCache[item.id];
  }catch{return state.metadataCache?.[item.id]||null}
}
function pumpVisibleMetadata(){
  while(visibleMetadataActive<visibleMetadataLimit()&&visibleMetadataQueue.length){
    const item=visibleMetadataQueue.shift();if(!item)continue;visibleMetadataActive++;
    enrichVisibleImdbRating(item).finally(()=>{updateVisibleImdbBadges(item.id);visibleMetadataQueued.delete(item.id);visibleMetadataActive--;setTimeout(pumpVisibleMetadata,visibleMetadataDelay())});
  }
}
function queueVisibleMetadata(item){
  if(!item||isDemoItem(item)||!['movie','series'].includes(item.kind)||visibleMetadataQueued.has(item.id))return;
  const cached=state.metadataCache?.[item.id]||{},now=Date.now();
  if(cached.imdbRatingCheckedAt&&now-cached.imdbRatingCheckedAt<30*86400000){updateVisibleImdbBadges(item.id);return}
  visibleMetadataQueued.add(item.id);visibleMetadataQueue.push(item);pumpVisibleMetadata();
}
function hydrateVisibleImdbRatings(root=document){
  const nodes=[...root.querySelectorAll('[data-imdb-item]')].filter(el=>el.dataset.imdbHydrated!=='1');if(!nodes.length)return;
  const activate=el=>{const id=el.dataset.imdbItem,item=savedItem(id);if(!item){el.dataset.imdbHydrated='1';return}const cached=state.metadataCache?.[id]||{};if(displayImdbRating({id})){updateVisibleImdbBadges(id);return}if(cached.imdbRatingCheckedAt&&Date.now()-cached.imdbRatingCheckedAt<30*86400000){el.dataset.imdbHydrated='1';return}queueVisibleMetadata(item)};
  if(!('IntersectionObserver'in window)){nodes.forEach(activate);return}
  if(!visibleMetadataObserver)visibleMetadataObserver=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){visibleMetadataObserver?.unobserve(entry.target);activate(entry.target)}},{rootMargin:largeLibraryMode()?'260px 420px':'420px 720px',threshold:.01});
  nodes.forEach(el=>visibleMetadataObserver.observe(el));
}
function resolveProviderAsset(value='',providerId=''){
  const raw=Array.isArray(value)?value.find(Boolean)||'':String(value||'').trim();if(!raw)return'';const cfg=providerConfigById(providerId)||sessionXtream||{};
  try{return new URL(raw,`${String(cfg.server||'').replace(/\/+$/,'')}/`).href}catch{return raw}
}
function kindLabel(item){return item?.kind==='live'?'Live TV':item?.kind==='movie'?'Movie':item?.kind==='series'?'Series':item?.kind==='episode'?'Episode':'Title'}
const HOME_ROW_DEFS=[
  {id:'continue',label:'Continue Watching',group:'Your Swoop',poster:true},
  {id:'recently-watched',label:'Recently Watched',group:'Your Swoop',poster:true},
  {id:'recommended',label:'Recommended For You',group:'For You',poster:true},
  {id:'recent-live',label:'Recent Channels',group:'Your Swoop',poster:false,page:'live'},
  {id:'mylist',label:'My List',group:'Your Swoop',poster:true,page:'mylist'},
  {id:'top20-movies',label:'Top 20 Movies',group:'Live from the web',poster:true,web:true,ranked:true,description:'Stable current popularity blended across web signals — top 20 available in your library'},
  {id:'top20-shows',label:'Top 20 TV Shows',group:'Live from the web',poster:true,web:true,ranked:true,description:'Stable current popularity blended across web signals — top 20 available in your library'},
  {id:'trending-movies',label:'Trending Now — Movies',group:'Live from the web',poster:true,web:true,description:'Blended short-term signals from TMDb, Trakt, JustWatch and popularity charts'},
  {id:'trending-shows',label:'Trending Now — TV Shows',group:'Live from the web',poster:true,web:true,description:'Blended short-term signals from TMDb, Trakt, JustWatch and popularity charts'},
  {id:'new-hot-movies',label:'New & Hot Movies',group:'Live from the web',poster:true,web:true,description:'Fresh releases with strong current activity'},
  {id:'new-hot-shows',label:'New & Hot TV Shows',group:'Live from the web',poster:true,web:true,description:'Current and newly airing shows with strong activity'},
  {id:'streaming-movies',label:'Popular on Streaming — Movies',group:'Live from the web',poster:true,web:true,description:'Current streaming-chart popularity matched to your library'},
  {id:'streaming-shows',label:'Popular on Streaming — TV',group:'Live from the web',poster:true,web:true,description:'Current streaming-chart popularity matched to your library'},
  {id:'most-watched-movies',label:'Most Watched This Week — Movies',group:'Live from the web',poster:true,web:true,description:'Weekly viewing activity blended with current popularity'},
  {id:'most-watched-shows',label:'Most Watched This Week — TV',group:'Live from the web',poster:true,web:true,description:'Weekly viewing activity blended with current popularity'},
  {id:'box-office-movies',label:'Box Office Now',group:'Live from the web',poster:true,web:true,description:'Current theatrical and box-office titles available in your library'},
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
  if(nativeCatalogMode){const make=(kind,label)=>(nativeCategoryCache[kind]||[]).filter(x=>Number(x.count)>=4).slice(0,28).map(x=>({id:`cat:${kind}:${encodeURIComponent(x.name)}`,label:x.name,group:label,poster:true,category:true,description:`${Number(x.count).toLocaleString()} titles from your local catalogue`}));return [...make('movie','Provider Movie Categories'),...make('series','Provider TV Categories')];}
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
function selectedHomeRows(){
  const normalized=normalizeHomeRows(state.settings.homeRows);
  let defs=normalized.map(homeRowDef).filter(Boolean);
  const pinned=PINNED_HOME_ROWS.map(id=>defs.find(x=>x.id===id)).filter(Boolean);
  let rest=defs.filter(x=>!PINNED_HOME_ROWS.includes(x.id));
  if(state.settings.smartHomeOrder!==false){
    const affinity=profileGenreAffinity(state.watchHistory,id=>savedItem(id),item=>[...mediaGenres(item)]);
    rest=smartRankRows(rest,affinity);
  }
  return [...pinned,...rest];
}
function mediaSearchText(item){return `${item?.genre||''} ${item?.group||''} ${item?.name||''}`.toLowerCase()}
function yearNumber(item){const m=String(item?.year||item?.name||'').match(/(?:19|20)\d{2}/);return m?Number(m[0]):0}
function tenPointRating(value){const n=parseFloat(String(value??'').replace(',','.'));return Number.isFinite(n)&&n>0&&n<=10?n.toFixed(1):''}
function ratingNumber(item){const meta=state.metadataCache?.[item?.id]||{},trusted=tenPointRating(meta.rating)||tenPointRating(item?.rating);return trusted?Number(trusted):0}
function displayRating(item){const meta=state.metadataCache?.[item?.id]||{};return tenPointRating(meta.rating)}
function displayImdbRating(item){const meta=state.metadataCache?.[item?.id]||{};return tenPointRating(meta.imdbRating)}
function stableDailyOrder(list,key=''){const day=Math.floor(Date.now()/86400000);return [...list].sort((a,b)=>Math.abs(hash(`${day}|${key}|${a.id}`))-Math.abs(hash(`${day}|${key}|${b.id}`)))}
function watchHistoryItems(){const out=[],seen=new Set();for(const x of [...state.watchHistory].sort((a,b)=>(b.lastPlayed||0)-(a.lastPlayed||0))){const item=savedItem(x.id)||x.item;if(item&&!seen.has(item.id)){seen.add(item.id);out.push(item)}}return out}
function recentLiveItems(){return state.recentLive.map(savedItem).filter(Boolean)}
function mediaGenres(item){
  const meta=state.metadataCache?.[item?.id]||{};
  const raw=Array.isArray(meta.genres)?meta.genres.join(' '):`${meta.genres||''} ${item?.genre||''} ${item?.group||''}`;
  return new Set(String(raw).toLowerCase().split(/[,/|·]+|\s{2,}/).map(x=>x.trim()).filter(x=>x.length>2));
}
function matchTmdbRecommendations(recs=[],kind=''){
  const pool=activeCatalog().filter(x=>['movie','series'].includes(x.kind)&&(!kind||x.kind===kind));
  const byTmdb=new Map(pool.filter(x=>x.tmdbId).map(x=>[String(x.tmdbId),x]));
  const byTitle=new Map();
  for(const item of pool){const key=normalizeMediaTitle(item.name);if(key&&!byTitle.has(key))byTitle.set(key,item)}
  const out=[];
  for(const rec of recs||[]){
    let hit=rec?.tmdbId?byTmdb.get(String(rec.tmdbId)):null;
    if(!hit){const key=normalizeMediaTitle(rec?.title||rec?.name||'');if(key)hit=byTitle.get(key)}
    if(hit&&!out.some(x=>x.id===hit.id))out.push(hit);
  }
  return collapseMovieSources(out,activeCatalog());
}
function personalizedRecommendations(limit=HOME_STANDARD_ROW_LIMIT){
  const history=[...new Map(watchHistoryItems().map(x=>x.kind==='episode'?(savedItem(x.parentSeriesId)||x):x).map(x=>[x.id,x])).values()].slice(0,12),exclude=new Set(history.map(x=>x.id));
  if(!history.length)return[];
  const direct=[];
  for(const watched of history){
    const meta=state.metadataCache?.[watched.id];
    for(const hit of matchTmdbRecommendations(meta?.recommendations||[],watched.kind))if(!exclude.has(hit.id)&&!direct.some(x=>x.id===hit.id))direct.push(hit);
  }
  const recommendationGenres=item=>{const meta=state.metadataCache?.[item?.id]||{},raw=Array.isArray(meta.genres)?meta.genres.join(' '):`${meta.genres||''} ${item?.genre||''}`;return new Set(String(raw).toLowerCase().split(/[,/|·]+|\s{2,}/).map(x=>x.trim()).filter(x=>x.length>2))};
  const genreScores=new Map();
  for(const watched of history){for(const g of recommendationGenres(watched))genreScores.set(g,(genreScores.get(g)||0)+1)}
  const scored=activeCatalog().filter(x=>['movie','series'].includes(x.kind)&&!exclude.has(x.id)).map(item=>{
    let affinity=0;for(const g of recommendationGenres(item))affinity+=genreScores.get(g)||0;
    if(affinity<=0)return {item,score:0,tie:0};
    let score=affinity;
    if(history[0]?.kind===item.kind)score+=.5;
    if(state.myList.includes(item.id))score-=4;
    score+=Math.min(.75,ratingNumber(item)/12);
    return {item,score,tie:Math.abs(hash(`${Math.floor(Date.now()/86400000)}|rec|${item.id}`))};
  }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||a.tie-b.tie).map(x=>x.item);
  return collapseMovieSources([...new Map([...direct,...scored].map(x=>[x.id,x])).values()],activeCatalog()).slice(0,limit);
}
function localHomeRowItems(id){
  const movies=items('movie'),shows=items('series'),live=items('live');
  const filter=(arr,words)=>stableDailyOrder(arr.filter(x=>words.some(w=>mediaSearchText(x).includes(w))),id);
  if(id==='continue')return continueItems();
  if(id==='recently-watched')return watchHistoryItems();
  if(id==='recommended')return personalizedRecommendations();
  if(id==='recent-live')return recentLiveItems();
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
function cachedWebRowItems(id){const cache=state.webDiscovery?.[id];if(nativeCatalogMode&&Array.isArray(cache?.items))return cacheNativeItems(cache.items);return collapseMovieSources((cache?.itemIds||[]).map(savedItem).filter(Boolean),activeCatalog())}
function customHomeRowItems(id){const uid=String(id).slice(7),row=state.mdblistRows.find(x=>String(x.uid)===uid);return collapseMovieSources(row?.items||[],activeCatalog())}
function homeRowItems(id){let result;if(WEB_ROW_IDS.has(id))result=cachedWebRowItems(id);else if(String(id).startsWith('custom:'))result=customHomeRowItems(id);else if(nativeCatalogMode&&nativeHomeRowCache.has(id))result=nativeHomeRowCache.get(id);else if(String(id).startsWith('cat:')){const parts=String(id).split(':'),kind=parts[1],name=decodeURIComponent(parts.slice(2).join(':'));result=stableDailyOrder(items(kind).filter(x=>x.group===name),id)}else result=localHomeRowItems(id);const profile=activeProfile();return (result||[]).filter(item=>profileAllowsMedia(profile,item,state.metadataCache?.[item.id]||{}))}
function relativeRefreshTime(ts){if(!ts)return'Not refreshed yet';const mins=Math.max(0,Math.floor((Date.now()-ts)/60000));if(mins<1)return'Updated just now';if(mins<60)return`Updated ${mins}m ago`;const hrs=Math.floor(mins/60);if(hrs<24)return`Updated ${hrs}h ago`;return`Updated ${Math.floor(hrs/24)}d ago`}
function discoveryMeta(id,data){
  if(WEB_ROW_IDS.has(id)){const c=state.webDiscovery?.[id];return c?`${relativeRefreshTime(c.updatedAt)} · ${data.length} available${c.enhanced?' · blended web ranking':' · TMDb ranking'}`:'Waiting for web discovery refresh';}
  if(String(id).startsWith('custom:')){const r=state.mdblistRows.find(x=>`custom:${x.uid}`===id);return `${relativeRefreshTime(r?.updatedAt)} · ${data.length} available`;}
  if(id==='live-now')return`${data.length.toLocaleString()} channels`;
  if(id==='continue')return`${data.length} in progress`;
  if(id==='recently-watched')return`${data.length} recently played`;
  if(id==='recommended')return state.watchHistory.length?'Based on your viewing':'Start watching to personalize this row';
  if(id==='recent-live')return`${data.length} recent channels`;
  if(id==='mylist')return`${data.length} saved`;
  return`${data.length.toLocaleString()} available`;
}
function discoveryRowMediaType(id){return /shows|tv/i.test(String(id))?'show':'movie'}
function discoveryRowMode(id){if(String(id).startsWith('top20-'))return'top20';if(String(id).startsWith('trending-'))return'trending';if(String(id).startsWith('new-hot-'))return'newhot';if(String(id).startsWith('streaming-'))return'streaming';if(String(id).startsWith('most-watched-'))return'watched';if(id==='box-office-movies')return'boxoffice';return'trending'}
function discoveryRowTtl(id){return /^(trending|new-hot|streaming|box-office)/.test(String(id))?DISCOVERY_FAST_REFRESH_MS:DISCOVERY_REFRESH_MS}
async function discoveryBundle(mediaType,force=false){
  const key=mediaType==='show'?'tv':'movie',cached=discoveryBundleMemory.get(key),now=Date.now();
  if(!force&&cached&&now-cached.at<5*60*1000)return cached.data;
  const data=await fetchSwoopDiscovery({settings:state.settings,mediaType:key});
  discoveryBundleMemory.set(key,{at:now,data});return data;
}
function blendDiscoverySources(bundle,mediaType,mode='trending',limit=20){
  const kind=mediaType==='show'?'series':'movie',sources=bundle?.sources||{};
  const weights={
    trending:{tmdbDay:1.65,traktTrending:1.5,justwatch:1.25,tmdbWeek:1.0,imdbPopular:.8,stable:.65,tmdbPopular:.6},
    top20:{stable:1.5,imdbPopular:1.25,tmdbPopular:1.05,justwatch:.85,tmdbWeek:.7,traktTrending:.55},
    newhot:{tmdbDay:1.45,fresh:1.35,justwatch:1.05,traktTrending:1.0,tmdbWeek:.75,stable:.45},
    streaming:{justwatch:1.7,traktTrending:.95,stable:.75,tmdbDay:.65,tmdbWeek:.55},
    watched:{mostWatched:1.7,traktTrending:1.0,tmdbWeek:.8,justwatch:.65,stable:.45},
    boxoffice:{boxOffice:1.8,fresh:1.2,tmdbDay:.8,tmdbWeek:.45}
  }[mode]||{};
  const score=new Map(),sourceHits=new Map(),logicalById=new Map();
  for(const [name,weight] of Object.entries(weights)){
    const payload=sources[name];if(!payload||!(Array.isArray(payload)?payload.length:Object.keys(payload||{}).length))continue;
    const matched=matchMDBListToCatalog(payload,activeCatalog(),{sourceLimit:200,limit:HOME_STANDARD_ROW_LIMIT,mediaType});
    matched.forEach((raw,rank)=>{
      const item=savedItem(raw.id)||raw,id=item.id;logicalById.set(id,item);
      const decay=1/(1+rank*.095),prior=score.get(id)||0;
      score.set(id,prior+weight*decay);sourceHits.set(id,(sourceHits.get(id)||0)+1);
    });
  }
  const currentYear=new Date().getFullYear();
  const ranked=[...score.entries()].map(([id,value])=>{const item=logicalById.get(id),year=yearNumber(item),hits=sourceHits.get(id)||1;let bonus=Math.min(.28,(hits-1)*.065);if((mode==='trending'||mode==='newhot')&&year===currentYear)bonus+=.18;if(mode==='newhot'&&year===currentYear-1)bonus+=.06;return {item,score:value+bonus,hits,tie:Math.abs(hash(`${mode}|${id}`))}}).filter(x=>x.item?.kind===kind).sort((a,b)=>b.score-a.score||b.hits-a.hits||a.tie-b.tie).map(x=>x.item);
  return collapseMovieSources(ranked,activeCatalog()).slice(0,limit);
}
async function blendDiscoverySourcesNative(bundle,mediaType,mode='trending',limit=20){
  const kind=mediaType==='show'?'series':'movie',sources=bundle?.sources||{};
  const weights={
    trending:{tmdbDay:1.65,traktTrending:1.5,justwatch:1.25,tmdbWeek:1.0,imdbPopular:.8,stable:.65,tmdbPopular:.6},
    top20:{stable:1.5,imdbPopular:1.25,tmdbPopular:1.05,justwatch:.85,tmdbWeek:.7,traktTrending:.55},
    newhot:{tmdbDay:1.45,fresh:1.35,justwatch:1.05,traktTrending:1.0,tmdbWeek:.75,stable:.45},
    streaming:{justwatch:1.7,traktTrending:.95,stable:.75,tmdbDay:.65,tmdbWeek:.55},
    watched:{mostWatched:1.7,traktTrending:1.0,tmdbWeek:.8,justwatch:.65,stable:.45},
    boxoffice:{boxOffice:1.8,fresh:1.2,tmdbDay:.8,tmdbWeek:.45}
  }[mode]||{};
  const score=new Map(),sourceHits=new Map(),logicalById=new Map();
  for(const [name,weight] of Object.entries(weights)){
    const payload=sources[name];if(!payload||!(Array.isArray(payload)?payload.length:Object.keys(payload||{}).length))continue;
    const result=await nativeCatalogMatchPayload(payload,mediaType,{sourceLimit:200,limit:HOME_STANDARD_ROW_LIMIT,providerIds:nativeEnabledProviderIds()}).catch(()=>null),matched=cacheNativeItems(result?.items||[]);
    matched.forEach((item,rank)=>{const id=item.id;logicalById.set(id,item);const decay=1/(1+rank*.095);score.set(id,(score.get(id)||0)+weight*decay);sourceHits.set(id,(sourceHits.get(id)||0)+1)});
  }
  const currentYear=new Date().getFullYear();
  return [...score.entries()].map(([id,value])=>{const item=logicalById.get(id),year=yearNumber(item),hits=sourceHits.get(id)||1;let bonus=Math.min(.28,(hits-1)*.065);if((mode==='trending'||mode==='newhot')&&year===currentYear)bonus+=.18;if(mode==='newhot'&&year===currentYear-1)bonus+=.06;return {item,score:value+bonus,hits,tie:Math.abs(hash(`${mode}|${id}`))}}).filter(x=>x.item?.kind===kind).sort((a,b)=>b.score-a.score||b.hits-a.hits||a.tie-b.tie).map(x=>x.item).slice(0,limit);
}

async function legacyDiscoveryFallback(id,apiKey){
  if(!apiKey)return[];
  const mediaType=discoveryRowMediaType(id);
  if(id==='top20-movies'||id==='top20-shows'){
    const slug=mediaType==='movie'?'movies/popular':'shows/popular',payload=await getMDBListOfficialItems({apiKey,slug});
    return matchMDBListToCatalog(payload,activeCatalog(),{limit:HOME_TOP20_LIMIT,mediaType});
  }
  if(id==='trending-movies'||id==='trending-shows'||id==='streaming-movies'||id==='streaming-shows'){
    const payload=await getMDBListStreamingChart({apiKey,mediaType});return matchMDBListToCatalog(payload,activeCatalog(),{limit:HOME_STANDARD_ROW_LIMIT,mediaType});
  }
  return[];
}
async function fetchBuiltInDiscovery(id,apiKey,force=false){
  const mediaType=discoveryRowMediaType(id),mode=discoveryRowMode(id),rowLimit=String(id).startsWith('top20-')?HOME_TOP20_LIMIT:HOME_STANDARD_ROW_LIMIT;
  try{const bundle=await discoveryBundle(mediaType,force),items=nativeCatalogMode?await blendDiscoverySourcesNative(bundle,mediaType,mode,rowLimit):blendDiscoverySources(bundle,mediaType,mode,rowLimit);return {items,enhanced:Boolean(bundle?.enhanced),source:nativeCatalogMode?'swoop-sqlite':'swoop'};}
  catch(err){const fallback=await legacyDiscoveryFallback(id,apiKey).catch(()=>[]);if(fallback.length)return {items:fallback,enhanced:false,source:'legacy',warning:err.message||String(err)};throw err}
}
async function refreshDiscoveryRows(force=false){
  if(discoveryRefreshing||!state.catalog.length)return;
  const apiKey=String(state.settings.mdblistApiKey||'').trim();
  const mandatory=['top20-movies','top20-shows','trending-movies','trending-shows'];
  const wanted=[...new Set([...state.settings.homeRows.filter(id=>WEB_ROW_IDS.has(id)),...mandatory])];
  const custom=state.settings.homeRows.filter(id=>String(id).startsWith('custom:'));
  const now=Date.now(),staleIds=wanted.filter(id=>force||!state.webDiscovery?.[id]?.updatedAt||now-state.webDiscovery[id].updatedAt>discoveryRowTtl(id));
  const staleCustom=apiKey?custom.map(id=>state.mdblistRows.find(r=>`custom:${r.uid}`===id)).filter(r=>r?.source&&(force||!r.updatedAt||now-r.updatedAt>DISCOVERY_REFRESH_MS)):[];
  if(!staleIds.length&&!staleCustom.length)return;
  discoveryRefreshing=true;discoveryMessage='Refreshing Swoop discovery…';
  try{
    if(force)discoveryBundleMemory.clear();
    for(const id of staleIds){try{const result=await fetchBuiltInDiscovery(id,apiKey,false);state.webDiscovery[id]={itemIds:result.items.map(x=>x.id),items:nativeCatalogMode?result.items:undefined,updatedAt:Date.now(),error:'',enhanced:result.enhanced,source:result.source};}catch(err){state.webDiscovery[id]={...(state.webDiscovery[id]||{}),updatedAt:Date.now(),error:err.message||String(err)};}}
    for(const row of staleCustom){try{const payload=await getMDBListItems({apiKey,listId:row.source.listId,username:row.source.username,listName:row.source.listName});row.items=nativeCatalogMode?cacheNativeItems((await nativeCatalogMatchPayload(payload,'movie',{sourceLimit:200,limit:120,providerIds:nativeEnabledProviderIds()})).items||[]):matchMDBListToCatalog(payload,activeCatalog());row.updatedAt=Date.now();row.error='';}catch(err){row.updatedAt=Date.now();row.error=err.message||String(err);}}
    await persist('cache');discoveryMessage='Discovery updated';
  }finally{discoveryRefreshing=false;if((state.page==='home'||modal==='homeRows')&&!detailItem&&!playerItem)render();setTimeout(()=>{discoveryMessage=''},1800)}
}
function card(item,poster=false,opts={}){
  if(!item)return'';
  item=visualItem(item);
  const fallback=item.demoColor||`linear-gradient(135deg,hsl(${Math.abs(hash(item.name))%360} 44% 34%),#080b12)`;
  const trustedRating=item.kind==='movie'||item.kind==='series'?displayRating(item):tenPointRating(item.rating);
  const imdbRating=item.kind==='movie'||item.kind==='series'?displayImdbRating(item):'';
  const sub=item.kind==='live'?(item.group||'Live TV'):(item.kind==='episode'&&item.season?`S${item.season} E${item.episodeNum||''}`:'');
  const art=item.logo?`<img class="card-art" data-swoop-art="${esc(item.logo)}" alt="" loading="lazy">`:'';
  const posterOwnsTitle=Boolean(poster&&['movie','series'].includes(item.kind)&&item.logo);
  const displayTitle=cleanDisplayTitle(item);
  const titleHtml=posterOwnsTitle?'':`<div class="card-title">${esc(displayTitle)}</div>`;
  const subHtml=sub?`<div class="card-sub">${esc(sub)}</div>`:'';
  const liveBadge=item.kind==='live'?`<div class="badge"><span class="live-dot"></span>LIVE</div>`:'';
  const action=item.kind==='live'||item.kind==='episode'?'data-play':'data-detail';
  const hoverAction=item.kind==='live'?'Play channel':item.kind==='episode'?'Play episode':'More info';
  const saved=isInMyList(item)?'<span class="card-saved">✓ MY LIST</span>':'';
  const liveFav=item.kind==='live'&&isLiveFavourite(item)?'<span class="card-live-fav">★ FAVOURITE</span>':'';
  const liveQuality=item.kind==='live'?qualityLabel(item):'';
  const qualityBadge=liveQuality?`<span class="card-quality">${esc(liveQuality)}</span>`:'';
  const sources=Number(item.sourceCount||item.sources?.length||0)>1?`<span class="card-sources">${Number(item.sourceCount||item.sources.length)} SOURCES</span>`:'';
  const watched=item.kind!=='live'&&isWatched(item)?'<span class="card-watched">✓ WATCHED</span>':'';
  const imdbBadge=poster&&['movie','series'].includes(item.kind)&&imdbRating?`<span class="card-imdb-rating"><b>IMDb</b> ${esc(imdbRating)}</span>`:'';
  const progress=Number.isFinite(Number(opts.progress))?Math.max(0,Math.min(100,Number(opts.progress))):null;
  const rank=Number.isFinite(Number(opts.rank))&&Number(opts.rank)>0?Number(opts.rank):null;
  const rankBadge=rank?`<div class="rank-badge"><span>${rank}</span></div>`:'';
  const imdbHydrationAttr=poster&&['movie','series'].includes(item.kind)?` data-imdb-item="${esc(item.id)}"`:'';
  return `<button class="card ${poster?'poster':'landscape'} ${posterOwnsTitle?'poster-art-title':''} ${item.kind==='live'?'live-card':''} ${rank?'ranked-card':''}" ${action}="${esc(item.id)}"${imdbHydrationAttr} style="--card-bg:${fallback}" aria-label="${esc(displayTitle)}">
    <div class="card-bg"></div>${art}<div class="card-shade"></div>${rankBadge}${liveBadge}${saved}${liveFav}${qualityBadge}${sources}${watched}${imdbBadge}
    <div class="card-copy">${titleHtml}${subHtml}<div class="card-hover"><span class="card-hover-icon">${item.kind==='live'||item.kind==='episode'?'▶':'ⓘ'}</span><span>${hoverAction}</span></div></div>
    ${progress!==null?`<div class="progress"><i style="width:${progress}%"></i></div>`:''}</button>`;
}
function profileAvatarHtml(profile,cls=''){
  const av=avatarById(profile?.avatar||'lion');
  const glyph=profile?.name==='+'?'+':(av.glyph||'🦁');
  return `<span class="profile-avatar ${cls} animal-avatar" style="--profile-bg:${av.gradient}" title="${esc(av.label)}"><b>${esc(glyph)}</b></span>`;
}
function profilePickerPage(){
  const profiles=state.profiles||[];
  return `<main class="profile-picker-page"><div class="profile-picker-brand"><span class="brand-mark">S</span><span>SWOOP <b>TV</b></span></div><div class="profile-picker-shell"><div class="eyebrow">PERSONALISED SWOOP</div><h1>Who’s watching?</h1><p>Every profile gets its own theme, Home layout, recommendations, Continue Watching, My List and favourite channels.</p><div class="profile-picker-grid">${profiles.map(p=>{const t=profileTheme(p);return `<button class="profile-choice profile-theme-${esc(t.id)}" data-profile-select="${esc(p.id)}">${profileAvatarHtml(p,'profile-avatar-xl')}<strong>${esc(p.name)}</strong><span>${p.kids?'Kids profile':'Personal profile'}${p.pinHash?' · PIN':''}</span><em class="profile-theme-chip" style="--theme-chip:${esc(t.swatch)}">${esc(t.name)}</em></button>`}).join('')}<button class="profile-choice profile-add-choice" data-profile-add>${profileAvatarHtml({name:'+',avatar:'elephant'},'profile-avatar-xl')}<strong>Add Profile</strong><span>Create another personalised Swoop</span><em class="profile-theme-chip">Choose a theme</em></button></div><div class="profile-picker-actions"><button class="btn secondary" data-profile-manage>Manage Profiles</button><button class="btn secondary" data-page="settings">⚙ Settings</button></div></div></main>`;
}
function profilesModal(){
  return `<div class="modal-backdrop profile-manage-backdrop" data-close-modal><div class="modal profile-manage-modal" data-modal-card><div class="modal-head"><div><div class="eyebrow">HOUSEHOLD</div><h2>Profiles</h2><p>Each person can have a completely different Swoop presentation without changing your shared TV providers.</p></div><button class="icon-btn" data-close>✕</button></div><div class="modal-body"><div class="profile-manage-list">${state.profiles.map(p=>{const t=profileTheme(p);return `<div class="profile-manage-row">${profileAvatarHtml(p,'profile-avatar-lg')}<div><strong>${esc(p.name)}</strong><span>${p.kids?'Kids restrictions on':'Standard profile'}${p.pinHash?' · PIN protected':''} · ${esc(t.name)} theme</span></div><button class="btn secondary compact-btn" data-profile-select="${esc(p.id)}">Switch</button><button class="btn secondary compact-btn" data-profile-edit="${esc(p.id)}">Edit</button></div>`}).join('')}</div><button class="btn accent profile-add-btn" data-profile-add>＋ Add Profile</button></div></div></div>`;
}
function profileEditorModal(){
  const existing=state.profiles.find(p=>p.id===profileEditId)||null,p=existing||makeProfile({name:'New Profile',avatar:PROFILE_AVATARS[state.profiles.length%PROFILE_AVATARS.length].id,profileSettings:{themeId:'chill',backgroundColor:'#050505',backgroundOverride:false,movieSourcePreferences:{},homeRows:[...DEFAULT_HOME_ROWS],smartHomeOrder:true}}),selectedTheme=profileTheme(p);
  return `<div class="modal-backdrop" data-close-modal><div class="modal profile-edit-modal" data-modal-card><div class="modal-head"><div><div class="eyebrow">${existing?'EDIT PROFILE':'NEW PROFILE'}</div><h2>${existing?'Personalise this profile':'Create a profile'}</h2><p>Theme, viewing activity and Home preferences are private to this profile.</p></div><button class="icon-btn" data-close>✕</button></div><div class="modal-body"><form id="profileForm"><input type="hidden" name="id" value="${esc(existing?.id||'')}"><input type="hidden" name="avatar" value="${esc(p.avatar)}" id="profileAvatarValue"><div class="field"><label>Profile name</label><input name="name" maxlength="24" value="${esc(p.name)}" required></div><div class="profile-avatar-picker"><label>Choose an avatar</label><div>${PROFILE_AVATARS.map(av=>`<button type="button" class="profile-avatar-option ${av.id===p.avatar?'active':''}" data-profile-avatar="${av.id}" aria-label="${esc(av.label)}"><span style="--profile-bg:${av.gradient}">${esc(av.glyph)}</span></button>`).join('')}</div></div><div class="profile-theme-picker"><div class="field-label"><strong>Choose a Swoop theme</strong><small>The whole interface changes with this profile.</small></div>${themePickerHtml(selectedTheme.id)}</div><label class="remember-row profile-kids-toggle"><input type="checkbox" name="kids" ${p.kids?'checked':''}><span><strong>Kids profile</strong><small>Hides explicit/adult groups and titles with known mature certifications. Provider metadata varies, so this is a convenience filter rather than a substitute for supervision.</small></span></label><label class="remember-row"><input type="checkbox" name="smartHome" ${p.profileSettings?.smartHomeOrder!==false?'checked':''}><span><strong>Smart Home ordering</strong><small>Automatically moves the most relevant rows higher based on this profile’s viewing history.</small></span></label><div class="field"><label>${p.pinHash?'Change profile PIN (optional)':'Profile PIN (optional)'}</label><input name="pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="8" placeholder="${p.pinHash?'Leave blank to keep current PIN':'4–8 digits'}"><small class="form-hint">A PIN is required before switching into this profile when one is set.</small></div>${p.pinHash?`<label class="profile-remove-pin"><input type="checkbox" name="removePin"> Remove existing PIN</label>`:''}<div class="profile-form-actions"><button class="btn accent" type="submit">${existing?'Save Profile':'Create Profile'}</button>${existing&&state.profiles.length>1?`<button class="btn danger" type="button" data-profile-delete="${esc(existing.id)}">Delete Profile</button>`:''}</div></form></div></div></div>`;
}
function pinModal(){
  const p=state.profiles.find(x=>x.id===pendingProfileId);if(!p)return'';
  return `<div class="modal-backdrop profile-pin-backdrop"><div class="modal profile-pin-modal" data-modal-card><div class="modal-body"><div class="profile-pin-head">${profileAvatarHtml(p,'profile-avatar-xl')}<div><div class="eyebrow">PROFILE LOCKED</div><h2>${esc(p.name)}</h2><p>Enter this profile’s PIN to continue.</p></div></div><form id="profilePinForm"><input name="pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="8" autofocus placeholder="PIN" required>${profilePinError?`<div class="profile-pin-error">${esc(profilePinError)}</div>`:''}<div class="cta-row"><button class="btn accent" type="submit">Unlock</button><button class="btn secondary" type="button" data-pin-cancel>Cancel</button></div></form></div></div></div>`;
}
async function pinDigest(pin,salt=''){
  const text=`${salt}|${String(pin||'')}`;
  if(globalThis.crypto?.subtle){const bytes=new TextEncoder().encode(text),digest=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('')}
  return String(Math.abs(hash(text)));
}
function randomSalt(){try{return [...crypto.getRandomValues(new Uint8Array(12))].map(x=>x.toString(16).padStart(2,'0')).join('')}catch{return `${Date.now()}-${Math.random()}`}}
async function switchProfile(id,{skipPin=false}={}){
  const target=state.profiles.find(p=>p.id===id);if(!target)return;
  if(target.pinHash&&!skipPin){pendingProfileId=id;profilePinError='';modal='pin';profilePickerOpen=false;render();return}
  if(playerItem)await stopPlayback(true);
  const changed=target.id!==state.activeProfileId;
  if(changed){syncActiveProfileFromState();state.activeProfileId=target.id;applyProfileToState(target);detailItem=null;sourceChoiceItem=null;heroRotationIndex=0;}
  profilePickerOpen=false;modal=null;
  if(!libraryRestored&&state.providers.length&&!state.catalog.length){storageRestoring=true;render();const nativeReady=await activateNativeCatalogIfAvailable().catch(()=>false);if(!nativeReady)await ensureDurableLibraryRestored();storageRestoring=false;}
  else if(nativeCatalogMode)await hydrateNativeProfileItems();
  await persist();render();toast(changed?`Switched to ${target.name}`:`Welcome, ${target.name}`);
}
function nav(){
  const desktop=[['home','Home'],['live','Live TV'],['guide','Guide'],['movies','Movies'],['series','TV Shows'],['mylist','My List']];
  const mobile=[['home','⌂','Home'],['live','◉','Live'],['guide','▤','Guide'],['movies','▰','Movies'],['series','▦','Shows']];
  return `<header class="topbar"><button class="brand" data-page="home" aria-label="Swoop TV Home"><i class="brand-mark">S</i><span>SWOOP</span><b>TV</b></button>
  <nav class="desktop-nav">${desktop.map(([p,label])=>`<button class="nav-btn ${state.page===p?'active':''}" data-page="${p}">${label}</button>`).join('')}</nav>
  <div class="top-actions"><button class="icon-btn search-action" data-page="search" aria-label="Search">⌕</button><button class="top-provider" data-modal="provider">☰ Providers <span class="top-provider-count">${state.providers.length||''}</span></button><button class="icon-btn settings-action ${state.page==='settings'?'active':''}" data-page="settings" aria-label="Settings" title="Settings">⚙</button><button class="profile-btn profile-switch-btn" data-profile-picker aria-label="Switch profile">${profileAvatarHtml(activeProfile(),'profile-avatar-nav')}<span>${esc(activeProfile()?.name||'Profile')}</span></button></div></header>
  <nav class="bottom-nav">${mobile.map(([p,icon,label])=>`<button class="${state.page===p?'active':''}" data-page="${p}"><span>${icon}</span>${label}</button>`).join('')}<button class="${state.page==='settings'?'active':''}" data-page="settings"><span>⚙</span>Settings</button></nav>`;
}
function rail(title,data,poster=false,meta='',opts={}){
  if(!data.length)return'';
  return `<section class="section swoop-render-section ${poster?'poster-section':'landscape-section'} ${opts.ranked?'ranked-section':''} ${opts.priority?'home-priority-row':''}"${opts.rowId?` data-home-row-mounted="${esc(opts.rowId)}"`:''}><div class="section-head"><div><h2>${esc(title)}</h2>${meta?`<span class="section-meta">${esc(meta)}</span>`:''}</div>${opts.page?`<button class="section-link" data-page="${opts.page}">Explore all →</button>`:'<span class="rail-arrow">›</span>'}</div><div class="rail">${data.map((x,i)=>card(x,poster,{progress:continueEntry(x.id)?.progress,rank:opts.ranked?i+1:null})).join('')}</div></section>`;
}

function homeRowMarkup(def){
  const data=homeRowItems(def.id);if(!data.length)return'';
  const limit=String(def.id).startsWith('top20-')?HOME_TOP20_LIMIT:HOME_STANDARD_ROW_LIMIT;
  return rail(def.label,data.slice(0,limit),def.poster,discoveryMeta(def.id,data),{page:def.page,ranked:def.ranked,rowId:def.id,priority:PINNED_HOME_ROWS.includes(def.id)});
}
function lazyHomePlaceholder(def){return `<section class="section lazy-home-row swoop-render-section ${def.poster?'poster-placeholder':'landscape-placeholder'}" data-lazy-home-row="${esc(def.id)}"><div class="section-head"><div><h2>${esc(def.label)}</h2><span class="section-meta">Ready as you scroll</span></div></div><div class="lazy-row-skeleton ${def.poster?'poster-skeleton':'landscape-skeleton'}">${Array.from({length:5},()=>'<i></i>').join('')}</div></section>`}
function mountLazyHomeRows(root=document){
  lazyHomeObserver?.disconnect?.();lazyHomeObserver=null;
  const nodes=[...root.querySelectorAll('[data-lazy-home-row]')];if(!nodes.length)return;
  const mount=node=>{const def=homeRowDef(node.dataset.lazyHomeRow);if(!def)return node.remove();const wrap=document.createElement('div');wrap.innerHTML=homeRowMarkup(def);const next=wrap.firstElementChild;if(next){node.replaceWith(next);hydrateArtwork(next);bindDynamicCards(next)}else node.remove()};
  if(!('IntersectionObserver'in window)){nodes.forEach(mount);return}
  lazyHomeObserver=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){lazyHomeObserver.unobserve(entry.target);requestAnimationFrame(()=>mount(entry.target))}},{rootMargin:'500px 0px'});nodes.forEach(n=>lazyHomeObserver.observe(n));
}

function fallbackFeatureItem(){
  const cat=activeCatalog();
  const recent=state.continueWatching.map(x=>savedItem(x.id)||x.item).find(Boolean);
  const cw=recent?.kind==='episode'?savedItem(recent.parentSeriesId):recent;
  const movieList=items('movie');
  return cw||movieList.find(x=>x.backdrop||x.logo)||cat.find(x=>x.kind==='series'&&(x.backdrop||x.logo))||movieList[0]||cat.find(x=>x.kind==='series')||cat.find(x=>x.kind==='live')||null;
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
  const heroRating=displayRating(feature),meta=[feature.year,heroRating?`★ ${heroRating}`:'',feature.sourceCount>1?`${feature.sourceCount} sources`:'',feature.group].filter(Boolean);
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
function listItems(){const out=[],seen=new Set();for(const id of state.myList){const item=savedItem(id);if(item&&!seen.has(item.id)){seen.add(item.id);out.push(item)}}return out}
function continueItems(){const out=[],seen=new Set();for(const x of [...state.continueWatching].sort((a,b)=>(b.lastPlayed||0)-(a.lastPlayed||0))){const item=savedItem(x.id)||x.item;if(item&&!seen.has(item.id)){seen.add(item.id);out.push(item)}}return out}
function home(){
  const cat=activeCatalog(),live=items('live'),movies=items('movie'),shows=cat.filter(x=>x.kind==='series'),homeCounts={live:nativeCatalogMode?nativeTotal('live'):live.length,movie:nativeCatalogMode?nativeTotal('movie'):movies.length,series:nativeCatalogMode?nativeTotal('series'):shows.length};
  const providerName=providerSummaryName(),heroPool=heroCandidates();
  if(heroPool.length)heroRotationIndex=((heroRotationIndex%heroPool.length)+heroPool.length)%heroPool.length;
  const feature=heroPool[heroRotationIndex]||fallbackFeatureItem();
  const rows=selectedHomeRows();
  const rendered=rows.map((def,index)=>largeLibraryMode()&&index>=HOME_EAGER_ROWS?lazyHomePlaceholder(def):homeRowMarkup(def)).join('');
  const needsWeb=rows.some(r=>r.web||r.custom),hasKey=Boolean(String(state.settings.mdblistApiKey||'').trim()),customNeedsKey=rows.some(r=>r.custom)&&!hasKey;
  const discoveryNote=customNeedsKey?`<section class="web-discovery-callout"><div><span class="eyebrow">CUSTOM MDBLIST ROWS</span><h2>Connect MDBList for your own lists</h2><p>Swoop's built-in Top 20 and Trending rows are already automatic. An MDBList key on this device is only needed for custom personal MDBList rows.</p></div><button class="btn accent" data-modal="homeRows">Set up Custom Lists</button></section>`:'';
  const status=discoveryRefreshing?'Refreshing Swoop discovery…':discoveryMessage||'Trending refreshes about every 90 minutes · Top 20 every 4 hours';
  return `<main class="home-main">${hero(feature,providerName,{total:heroPool.length,index:heroRotationIndex})}<div class="content home-content"><div class="library-strip home-library-strip"><div><span class="library-dot"></span><strong>${state.catalog.length?esc(providerName):'Demo Library'}</strong><span>${homeCounts.live.toLocaleString()} live · ${homeCounts.movie.toLocaleString()} movies · ${homeCounts.series.toLocaleString()} shows</span></div><div class="home-library-actions"><span class="discovery-status ${discoveryRefreshing?'busy':''}">${esc(status)}</span><button class="library-manage" data-modal="homeRows">☰ Customize Home</button><button class="library-manage" data-modal="provider">${state.catalog.length?'Providers':'Connect Provider'} →</button></div></div>
    ${discoveryNote}${rendered||`<section class="web-discovery-callout"><div><span class="eyebrow">YOUR HOME</span><h2>Choose what Swoop shows here</h2><p>Select Top 20, Trending, Live TV, genres and more. You can change the row order any time.</p></div><button class="btn accent" data-modal="homeRows">Customize Home</button></section>`}
  </div></main>`;
}
function page(kind,title){
  const nativeCache=nativePageCache[kind],arr=nativeCatalogMode?(nativeCache.items||[]):providerFiltered(items(kind)),limit=viewLimits[kind]||(kind==='live'?96:72),shown=nativeCatalogMode?arr:arr.slice(0,limit),total=nativeCatalogMode?Number(nativeCache.total||nativeTotal(kind)):arr.length,providerName=providerSummaryName(),providerPills=providerFilterOptions();
  const leadRaw=arr.find(x=>visualItem(x).backdrop||visualItem(x).logo)||arr[0];
  const lead=visualItem(leadRaw);
  const groups=nativeCatalogMode?(nativeCategoryCache[kind]||[]).map(x=>x.name).filter(Boolean).slice(0,14):[...new Set(arr.map(x=>x.group).filter(Boolean))].slice(0,10);
  const leadBackdrop=lead?(lead.backdrop||lead.logo):'';
  const leadArt=leadBackdrop?`<img data-swoop-art="${esc(leadBackdrop)}" class="page-hero-art page-hero-backdrop" alt="" loading="eager">`:'';
  const cards=shown.map(x=>card(x,kind!=='live')).join('');
  const leadAction=lead?(kind==='live'?`<button class="btn play-btn page-feature-play" data-play="${esc(lead.id)}">▶ Play ${esc(lead.name)}</button>`:`<button class="btn play-btn page-feature-play" data-detail="${esc(lead.id)}">ⓘ Explore ${esc(lead.name)}</button>`):'';
  const loading=nativeCatalogMode&&nativeCache.loading&&!arr.length?`<div class="native-query-loading"><span class="provider-spinner"></span><strong>Loading ${esc(title)} from the local catalogue…</strong></div>`:'';
  return `<main class="page cinematic-page"><section class="page-hero ${kind==='live'?'live-page-hero':''}">${leadArt}<div class="page-hero-shade"></div><div class="page-hero-copy"><div class="eyebrow">${kind==='live'?'WATCH NOW':kind==='movie'?'ON DEMAND':'BINGE-WORTHY'}</div><h1>${esc(title)}</h1><p>${catalogRawTotal()?`${total.toLocaleString()} ${kind==='live'?'channels':kind==='movie'?'movies':'series'} from ${esc(providerName)}.`:'Demo content — connect a provider to populate your library.'}</p><div class="cta-row">${leadAction}${kind==='live'?'<button class="btn secondary" data-page="guide">▤ Open TV Guide</button>':''}</div></div></section>
    <div class="page-content"><div class="provider-filter-pills"><button class="${providerFilter==='all'?'active':''}" data-provider-filter="all">All Providers</button>${providerPills.map(p=>`<button class="${providerFilter===p.id?'active':''}" data-provider-filter="${esc(p.id)}">${esc(p.name)}</button>`).join('')}</div><div class="page-toolbar"><div class="category-pills"><button data-page-category="${esc(kind)}" data-page-group="">All</button>${groups.map(g=>`<button data-page-category="${esc(kind)}" data-page-group="${esc(g)}">${esc(g)}</button>`).join('')}</div><button class="btn secondary compact-btn" data-modal="provider">＋ Provider</button></div>${loading}${arr.length?`<div class="content-grid ${kind==='live'?'live-content-grid':'poster-content-grid'}">${cards}</div>${shown.length<total?`<div class="load-more-wrap"><button class="btn secondary" data-load-more="${kind}">Load more · showing ${shown.length.toLocaleString()} of ${total.toLocaleString()}</button></div>`:''}`:loading?'':empty('No content yet','Connect a TV provider to populate this section.')}</div></main>`;
}
function livePage(){
  const nativeCache=nativePageCache.live,all=nativeCatalogMode?(nativeCache.items||[]):providerFiltered(items('live')),total=nativeCatalogMode?Number(nativeCache.total||nativeTotal('live')):all.length,providerName=providerSummaryName(),providerPills=providerFilterOptions();
  const byId=new Map(all.map(x=>[x.id,x]));
  const favourites=state.liveFavourites.map(id=>savedItem(id)||byId.get(id)).filter(Boolean);
  const recent=state.recentLive.map(id=>savedItem(id)||byId.get(id)).filter(Boolean).slice(0,16);
  const groups=nativeCatalogMode?(nativeCategoryCache.live||[]).map(x=>x.name).filter(Boolean):[...new Set(all.map(x=>x.group).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  const shown=nativeCatalogMode?all:(liveCategory?all.filter(x=>x.group===liveCategory):all).slice(0,viewLimits.live||180);
  const lead=favourites[0]||recent[0]||all[0];
  const leadVisual=visualItem(lead);
  const art=leadVisual?.logo?`<img class="live-hub-art" data-swoop-art="${esc(leadVisual.logo)}" alt="">`:'';
  const leadFav=lead?isLiveFavourite(lead):false;
  const loading=nativeCatalogMode&&nativeCache.loading&&!all.length?`<div class="native-query-loading"><span class="provider-spinner"></span><strong>Loading channels from the local catalogue…</strong></div>`:'';
  return `<main class="page live-hub-page"><section class="live-hub-hero"><div class="live-hub-backdrop">${art}</div><div class="live-hub-shade"></div><div class="live-hub-copy"><div class="eyebrow">LIVE TV · ${esc(providerName)}</div><h1>${lead?esc(lead.name):'Live TV'}</h1><p>${lead?`Jump straight back into ${esc(lead.name)}, browse favourites, or surf every live channel from one TV-first screen.`:'Connect a TV provider to populate Live TV.'}</p><div class="cta-row">${lead?`<button class="btn play-btn" data-play="${esc(lead.id)}">▶ Watch Live</button><button class="btn secondary" data-live-favourite="${esc(lead.id)}">${leadFav?'★ Favourite':'☆ Add Favourite'}</button>`:''}<button class="btn secondary" data-page="guide">▤ TV Guide</button></div></div><div class="live-hub-stat"><strong>${total.toLocaleString()}</strong><span>LIVE CHANNELS</span><small>${state.liveFavourites.length} favourites · ${state.recentLive.length} recent</small></div></section>
  <div class="page-content live-hub-content"><div class="provider-filter-pills live-provider-filter"><button class="${providerFilter==='all'?'active':''}" data-provider-filter="all">All Providers</button>${providerPills.map(p=>`<button class="${providerFilter===p.id?'active':''}" data-provider-filter="${esc(p.id)}">${esc(p.name)}</button>`).join('')}</div>${favourites.length?rail('Favourite Channels',favourites.slice(0,18),false,`${favourites.length} saved`,{}):''}${recent.length?rail('Recent Channels',recent,false,'Your most recently watched channels',{}):''}
  <section class="live-browser"><div class="section-head live-browser-head"><div><h2>${liveCategory?esc(liveCategory):'All Channels'}</h2><span class="section-meta">${total.toLocaleString()} channels</span></div><button class="btn secondary compact-btn" data-page="guide">Open Guide</button></div><div class="live-category-pills"><button class="${!liveCategory?'active':''}" data-live-category="">All</button>${groups.map(g=>`<button class="${liveCategory===g?'active':''}" data-live-category="${esc(g)}">${esc(g)}</button>`).join('')}</div>${loading}${shown.length?`<div class="content-grid live-content-grid premium-live-grid">${shown.map(x=>card(x,false)).join('')}</div>${shown.length<total?`<div class="load-more-wrap"><button class="btn secondary" data-load-more="live">Load more · showing ${shown.length.toLocaleString()} of ${total.toLocaleString()}</button></div>`:''}`:loading?'':empty('No channels in this category','Choose another Live TV category.')}</section></div></main>`;
}

function myListPage(){
  const arr=listItems();
  return `<main class="page mylist-page"><section class="collection-hero"><div class="eyebrow">YOUR COLLECTION</div><h1>My List</h1><p>Everything you saved for later, in one place.</p><div class="collection-count">${arr.length.toLocaleString()} ${arr.length===1?'title':'titles'}</div></section><div class="page-content">${arr.length?`<div class="content-grid poster-content-grid">${arr.map(x=>card(x,x.kind!=='live')).join('')}</div>`:empty('Your list is empty','Open a movie or TV show and choose Add to My List.')}</div></main>`;
}
function empty(title,copy){return `<div class="empty"><div class="empty-mark">S</div><h3>${esc(title)}</h3><p>${esc(copy)}</p><button class="btn accent" data-modal="provider">Add TV Provider</button></div>`}
function searchPage(){return `<main class="page search-page"><div class="search-hero"><div class="eyebrow">FIND SOMETHING GREAT</div><h1>Search Swoop</h1><div class="searchbox searchbox-large"><span>⌕</span><input id="searchInput" autofocus placeholder="Movies, TV shows, live channels…" /></div></div><div class="page-content"><div id="searchResults" class="content-grid search-results"></div></div></main>`}
function settingsPage(){
  const counts={live:nativeCatalogMode?nativeTotal('live'):items('live').length,movie:nativeCatalogMode?nativeTotal('movie'):items('movie').length,series:nativeCatalogMode?nativeTotal('series'):items('series').length};
  return `<main class="page settings-page"><div class="settings-hero"><div class="eyebrow">${esc(activeProfile()?.name||'SWOOP')} · PROFILE SETTINGS</div><h1>Settings</h1><p>Manage this profile, your unified providers, discovery rows and playback environment.</p></div><div class="page-content settings-list">
  <section class="setting-card setting-card-feature"><div class="setting-icon">TV</div><div class="setting-main"><h3>TV Providers</h3><p>${state.providers.length?`${enabledProviders().length} enabled · ${state.providers.length} connected`:'Demo mode'}</p><div class="setting-stats"><span><strong>${counts.live.toLocaleString()}</strong> Unique Live</span><span><strong>${counts.movie.toLocaleString()}</strong> Unique Movies</span><span><strong>${counts.series.toLocaleString()}</strong> Shows</span><span><strong>${catalogRawTotal().toLocaleString()}</strong> Raw items</span></div><div class="cta-row"><button class="btn accent" data-modal="provider">Manage Providers</button>${state.providers.length?'<button class="btn secondary" data-provider-refresh-all>Refresh All</button>':''}</div></div></section>
  <section class="setting-card profile-setting-card"><div class="setting-icon profile-setting-avatar">${profileAvatarHtml(activeProfile(),'profile-avatar-lg')}</div><div class="setting-main"><h3>${esc(activeProfile()?.name||'Profile')}</h3><p>${activeProfile()?.kids?'Kids restrictions are enabled.':'Personal viewing profile.'} Continue Watching, My List, recommendations, favourite channels, Home order and theme are private to this profile.</p><div class="setting-stats"><span><strong>${state.profiles.length}</strong> Household profiles</span><span><strong>${state.watchHistory.length}</strong> Watched</span><span><strong>${state.liveFavourites.length}</strong> Live favourites</span></div><div class="cta-row"><button class="btn accent" data-profile-picker>Switch Profile</button><button class="btn secondary" data-profile-edit="${esc(activeProfile()?.id||'')}">Edit Profile</button></div></div></section>
  <section class="setting-card performance-setting-card"><div class="setting-icon">⚡</div><div class="setting-main"><h3>Performance</h3><p>${performanceLabel()}. Auto mode reduces off-screen rendering and background metadata work when Swoop detects a very large library.</p><div class="cta-row"><button class="btn ${state.settings.performanceMode!=='cinematic'?'accent':'secondary'}" data-performance-mode="auto">Auto / Recommended</button><button class="btn ${state.settings.performanceMode==='cinematic'?'accent':'secondary'}" data-performance-mode="cinematic">Full Cinematic</button></div><small>${catalogLogicalTotal().toLocaleString()} enabled logical library items · ${nativeCatalogMode?'SQLite query mode active · ':''}large-library optimization starts at ${LARGE_LIBRARY_THRESHOLD.toLocaleString()}.</small></div></section>
  <section class="setting-card"><div class="setting-icon">＋</div><div class="setting-main"><h3>My List & Viewing</h3><p>${state.myList.length.toLocaleString()} saved · ${state.continueWatching.length.toLocaleString()} in progress · ${state.watchHistory.length.toLocaleString()} in viewing history.</p><div class="cta-row"><button class="btn secondary" data-page="mylist">Open My List</button>${state.continueWatching.length?'<button class="btn secondary" data-action="clear-history">Clear Continue Watching</button>':''}${state.watchHistory.length?'<button class="btn secondary" data-action="clear-viewing">Reset Recommendations</button>':''}</div></div></section>
  <section class="setting-card"><div class="setting-icon">▶</div><div class="setting-main"><h3>Smart Sources & Live TV</h3><p>${Object.keys(state.settings.movieSourcePreferences||{}).length.toLocaleString()} remembered movie source choices · ${state.liveFavourites.length.toLocaleString()} favourite live channels. Multi-source movies are ranked by quality/HDR/codec and still ask before playback.</p><div class="setting-stats"><span><strong>BEST</strong> source ranked first</span><span><strong>AUTO</strong> fallback on immediate failure</span><span><strong>FAST</strong> in-process live channel switching</span></div><div class="cta-row"><button class="btn secondary" data-page="live">Open Live TV</button>${Object.keys(state.settings.movieSourcePreferences||{}).length?'<button class="btn secondary" data-action="clear-source-preferences">Reset Source Choices</button>':''}${state.liveFavourites.length?'<button class="btn secondary" data-action="clear-live-favourites">Clear Live Favourites</button>':''}</div></div></section>
  <section class="setting-card"><div class="setting-icon">ROW</div><div class="setting-main"><h3>Home & Web Discovery</h3><p>${state.settings.homeRows.length} Home rows selected · ${state.settings.mdblistApiKey?'MDBList connected':'MDBList key not configured'}. Top 20 and Trending rows refresh automatically when enabled.</p><div class="cta-row"><button class="btn accent" data-modal="homeRows">Customize Home</button><button class="btn secondary" data-modal="mdblist">Add Custom MDBList Row</button></div>${state.mdblistRows.length?state.mdblistRows.map((r,i)=>`<div class="kv"><span>${esc(r.name)}</span><span>${r.items.length} matched · ${esc(relativeRefreshTime(r.updatedAt))} · <button class="nav-btn" data-remove-row="${i}">Remove</button></span></div>`).join(''):''}</div></section>
  <section class="setting-card theme-setting-card"><div class="setting-icon">THEME</div><div class="setting-main"><h3>Theme & Cinematic Artwork</h3><p><strong>${esc(currentTheme().name)}</strong> is active for this profile. Themes change the full Swoop presentation — Home hero, cards, navigation, buttons, badges, detail screens, Guide and loading states.</p><div class="kv"><span>Theme</span><span>${esc(currentTheme().name)} · ${esc(currentTheme().tagline)}</span></div><div class="kv"><span>Background</span><span>${state.settings.backgroundOverride?esc(validHex(state.settings.backgroundColor)):`${esc(currentTheme().bg)} · theme default`}</span></div><div class="kv"><span>Metadata service</span><span>${esc(metadataServiceUrl(state.settings))}</span></div><div class="cta-row"><button class="btn accent" data-modal="homeRows">Choose Theme & Home</button></div></div></section>
  ${NATIVE_WINDOWS?`<section class="setting-card native-ready"><div class="setting-icon">DB</div><div class="setting-main"><h3>Native Catalogue Database</h3><p>${nativeCatalogMode?'SQLite query mode is active. Swoop only brings the current page, Home rows and search results into the UI instead of loading your full provider dump.':'SQLite is installed and will become the catalogue source after the one-time library migration.'}</p><div class="setting-stats"><span><strong>${catalogRawTotal().toLocaleString()}</strong> raw provider items</span><span><strong>${catalogLogicalTotal().toLocaleString()}</strong> logical titles/channels</span><span><strong>FTS5</strong> indexed search</span><span><strong>120</strong> default page window</span></div></div></section><section class="setting-card native-ready"><div class="setting-icon">▶</div><div class="setting-main"><h3>Windows Native Playback</h3><p>Native bridge ready · mpv 0.41.0. Live TV and VOD play outside the browser sandbox for broader IPTV compatibility.</p></div></section>`:`<section class="setting-card"><div class="setting-icon">↗</div><div class="setting-main"><h3>Browser Connection Helper</h3><p>${state.settings.xtreamRelayUrl?esc(state.settings.xtreamRelayUrl):'Not configured'} · Used only for Xtream API/catalog requests when the browser blocks direct access.</p></div></section>`}
  <section class="setting-card"><div class="setting-icon">TM</div><div class="setting-main"><h3>Metadata Credits</h3><p>This product uses the TMDB API but is not endorsed or certified by TMDB. Official trailers are displayed through the YouTube embedded player when available.</p></div></section>
  <section class="setting-card"><div class="setting-icon">◈</div><div class="setting-main"><h3>Privacy & Architecture</h3><p>Swoop TV does not bundle content. ${NATIVE_WINDOWS?'The Windows build uses a loopback-only local bridge for provider API calls and native playback.':'Imported streams play directly from your provider whenever the browser/device supports them.'} Xtream stream URLs can contain provider credentials and are stored locally with the catalog.</p></div></section>
  </div></main>`;
}

function guidePage(){
  const all=providerFiltered(items('live')),channels=all.slice(0,guideLimit),hours=3,slots=Array.from({length:7},(_,i)=>new Date(guideStart+i*30*60000));
  const providerGuide=enabledProviders().length>1?'Unified provider EPG':enabledProviders()[0]?.type==='xtream'?'Xtream EPG':enabledProviders()[0]?.epgUrl?'XMLTV guide':'No EPG source configured';
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
  const channels=providerFiltered(items('live')).slice(0,guideLimit),stale=Date.now()-5*60000;if(!channels.length)return;
  guideLoading=true;guideError='';document.querySelectorAll('.guide-loading span').forEach(el=>el.textContent='Loading programme guide…');
  try{
    // Load XMLTV once per enabled M3U provider represented on screen.
    for(const p of enabledProviders().filter(x=>x.type==='m3u'&&x.epgUrl&&!m3uGuideLoadedProviders.has(x.id))){
      const providerChannels=channels.filter(ch=>{const src=preferredLiveSource(ch);return src.providerId===p.id});if(!providerChannels.length)continue;
      try{const text=NATIVE_WINDOWS?await nativeFetchText(p.epgUrl):await (await fetch(p.epgUrl)).text();const wanted=new Set(providerChannels.map(c=>preferredLiveSource(c).tvgId||c.name).filter(Boolean));const parsed=parseXMLTV(text,wanted);for(const ch of providerChannels){const src=preferredLiveSource(ch),key=src.tvgId||ch.name;epgCache.set(ch.id,{loadedAt:Date.now(),list:parsed[key]||[]});updateGuideRow(ch)}m3uGuideLoadedProviders.add(p.id)}catch{}
    }
    const pending=channels.filter(ch=>!epgCache.get(ch.id)||epgCache.get(ch.id).loadedAt<stale);let cursor=0;
    const worker=async()=>{while(cursor<pending.length){const ch=pending[cursor++],src=preferredLiveSource(ch);if(src.source!=='xtream')continue;const cfg=providerConfigFor(src);try{if(!cfg.server||!cfg.username||!cfg.password)throw new Error('Missing saved login');const payload=await fetchXtreamShortEpg(cfg,src.streamId,12);epgCache.set(ch.id,{loadedAt:Date.now(),list:normalizeXtreamEpg(payload)});updateGuideRow(ch)}catch{epgCache.set(ch.id,{loadedAt:Date.now(),list:[]});updateGuideRow(ch)}}};
    await Promise.all(Array.from({length:Math.min(4,pending.length||1)},worker));
    if(!channels.some(ch=>(epgCache.get(ch.id)?.list||[]).length))guideError='No programme data was returned by the enabled providers for these channels.';
  }catch(err){guideError=err.message||'Could not load programme guide data.'}
  finally{guideLoading=false;const alert=document.querySelector('.guide-alert');if(guideError&&!alert){const shell=document.querySelector('.guide-shell');if(shell)shell.insertAdjacentHTML('afterbegin',`<div class="guide-alert">${esc(guideError)}</div>`)}}
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
  const wrap=document.createElement('div');wrap.innerHTML=hero(pool[heroRotationIndex],providerSummaryName(),{total:pool.length,index:heroRotationIndex});
  const next=wrap.firstElementChild;if(!next)return;current.replaceWith(next);hydrateArtwork(next);bindDynamicCards(next);bindHeroControls(next);
  const item=pool[heroRotationIndex];if(item&&['movie','series'].includes(item.kind))enrichItemMetadata(item,{rerender:false});
}
function scheduleHeroRotation(){
  if(heroRotationTimer){clearInterval(heroRotationTimer);heroRotationTimer=null}
  if(state.page!=='home'||heroCandidates().length<2)return;
  heroRotationTimer=setInterval(()=>{if(document.hidden||state.page!=='home'||modal||detailItem||playerItem)return;const pool=heroCandidates();if(pool.length<2)return;heroRotationIndex=(heroRotationIndex+1)%pool.length;replaceHomeHero()},HERO_ROTATION_MS);
}

function restoringPage(){
  return `<main class="page restoring-page"><div class="restore-card"><div class="provider-spinner" aria-hidden="true"></div><div class="eyebrow">RESTORING SWOOP</div><h1>Loading your TV library…</h1><p id="restoreProgressText">Your profile is ready. Swoop is loading the large provider catalog in the background without blocking the profile screen.</p><div class="restore-progress"><i><b id="restoreProgressBar" style="width:4%"></b></i><span id="restoreProgressCount">Preparing saved library…</span></div><small>Large libraries are restored in smaller chunks so Windows can keep the app responsive.</small></div></main>`;
}
function updateRestoreProgress(info={}){
  const bar=document.querySelector('#restoreProgressBar'),count=document.querySelector('#restoreProgressCount'),text=document.querySelector('#restoreProgressText');
  const total=Math.max(1,Number(info.total||0)),loaded=Math.max(0,Number(info.loaded||0)),pct=info.phase==='finishing'?96:Math.min(92,8+(loaded/total)*82);
  if(bar)bar.style.width=`${pct}%`;
  if(count)count.textContent=info.items?`${Number(info.items).toLocaleString()} ${info.phase==='sqlite'?'items indexed':'library items restored'}`:`${info.phase==='sqlite'?'Preparing local database…':'Restoring saved library…'}`;
  if(text)text.textContent=info.phase==='sqlite'?'Optimizing your library into Swoop’s local SQLite catalogue. This one-time migration makes future launches, browsing and search much lighter.':info.phase==='legacy'?'Upgrading your older Swoop library storage. This happens once and is being processed away from the main screen.':info.phase==='finishing'?'Finishing your library and provider indexes…':'Loading channels, movies and TV shows in responsive chunks…';
}

function backgroundLiveBar(){
  if(!(playerItem?.kind==='live'&&playerUiHidden))return'';const item=visualItem(playerItem),p=currentProgramme(item),q=qualityLabel(item);
  return `<div class="background-live-bar"><div class="background-live-pulse"></div>${item.logo?`<img data-swoop-art="${esc(item.logo)}" alt="">`:''}<div class="background-live-copy"><span>LIVE NOW ${q?`· ${esc(q)}`:''}</span><strong>${esc(item.name)}</strong><small>${p?esc(p.title):esc(item.group||'Live TV')}</small></div><button class="btn secondary compact-btn" data-live-controls>Open Controls</button><button class="btn danger compact-btn" data-live-stop>Stop</button></div>`;
}
function render(){
  applyTheme();
  const oldDetailScroll=document.querySelector('.detail-scroll')?.scrollTop;
  if(Number.isFinite(oldDetailScroll))detailScrollTop=oldDetailScroll;
  artworkObserver?.disconnect?.();artworkObserver=null;visibleMetadataObserver?.disconnect?.();visibleMetadataObserver=null;
  const detailRoute=Boolean(!profilePickerOpen&&detailItem);
  let body;
  if(storageRestoring)body=restoringPage();
  else if(profilePickerOpen)body=profilePickerPage();
  else if(detailRoute)body=detailHtml();
  else if(state.page==='home')body=home();
  else if(state.page==='live')body=livePage();
  else if(state.page==='guide')body=guidePage();
  else if(state.page==='movies')body=page('movie','Movies');
  else if(state.page==='series')body=page('series','TV Shows');
  else if(state.page==='mylist')body=myListPage();
  else if(state.page==='search')body=searchPage();
  else body=settingsPage();
  const shellNav=storageRestoring||profilePickerOpen||detailRoute?'':nav();
  $app.innerHTML=`<div class="app-shell">${shellNav}${body}${modal?modalHtml():''}${!profilePickerOpen&&sourceChoiceItem?sourceChoiceHtml():''}${!profilePickerOpen&&playerItem&&!playerUiHidden?playerHtml():''}${!profilePickerOpen&&!detailRoute?backgroundLiveBar():''}${!profilePickerOpen&&trailerKey?trailerHtml():''}</div>`;
  if(detailRoute){const scroller=document.querySelector('.detail-scroll');if(scroller)scroller.scrollTop=detailScrollTop;}
  bind();bindHeroControls(document);
  if(!profilePickerOpen&&!detailRoute&&state.page==='search')runSearch('');
  hydrateArtwork();
  if(!profilePickerOpen&&!detailRoute&&state.page==='guide')setTimeout(loadGuideEpg,0);
  if(!profilePickerOpen&&!detailRoute&&state.page==='home'){
    mountLazyHomeRows(document);
    if(state.catalog.length)setTimeout(()=>refreshDiscoveryRows(false),largeLibraryMode()?1200:0);
    if(nativeCatalogMode)setTimeout(primeNativeHomeRows,140);
  }
  if(!profilePickerOpen&&!detailRoute&&playerItem?.kind==='live')setTimeout(()=>{loadPlayerNowNext(playerItem);loadLiveMiniGuide(playerItem)},0);
  if(!profilePickerOpen&&state.catalog.length)setTimeout(scheduleMetadataEnrichment,largeLibraryMode()?1800:120);
  if(!profilePickerOpen&&!detailRoute&&nativeCatalogMode){if(state.page==='movies')scheduleNativePage('movie');if(state.page==='series')scheduleNativePage('series');if(state.page==='live')scheduleNativePage('live');}
  if(!detailRoute)scheduleHeroRotation();
}

function providerModal(){
  const xtreamSaved=savedProviderProfiles.find(p=>p.type==='xtream')||{};
  const m3uSaved=savedProviderProfiles.find(p=>p.type==='m3u')||{};
  syncProviderCounts();
  const providers=state.providers.slice().sort((a,b)=>Number(a.priority)-Number(b.priority));
  const providerCards=providers.length?`<section class="provider-manager-list"><div class="provider-manager-title"><div><span class="eyebrow">UNIFIED LIBRARY</span><h3>${providers.length} connected provider${providers.length===1?'':'s'}</h3><p>All enabled providers are combined into one Swoop library. Disable a provider temporarily, change its priority, refresh it, or remove it completely.</p></div><button class="btn secondary compact-btn" data-provider-refresh-all>↻ Refresh All</button></div>${providers.map((p,index)=>{const c=p.counts||providerCatalogCounts(p.id),profile=providerConfigById(p.id),saved=Boolean(profile?.username||profile?.url),status=p.status==='error'?'Needs attention':p.status==='refreshing'?'Refreshing…':p.enabled===false?'Disabled':'Connected';return `<article class="provider-manager-card ${p.enabled===false?'disabled':''}"><div class="provider-manager-rank"><strong>${index+1}</strong><span>PRIORITY</span></div><div class="provider-manager-main"><div class="provider-manager-head"><div><span class="provider-type-badge">${p.type==='xtream'?'XTREAM':'M3U'}</span><h4>${esc(p.name||'TV Provider')}</h4><small>${esc(p.type==='xtream'?(p.server||'Xtream provider'):(p.url||'Local M3U playlist'))}</small><small class="provider-last-refresh">${esc(providerStatusCopy(p))}</small></div><span class="provider-health ${p.status==='error'?'error':p.enabled===false?'off':'ok'}">${esc(status)}</span></div><div class="provider-manager-stats"><span><b>${Number(c.live||0).toLocaleString()}</b> Live</span><span><b>${Number(c.movie||0).toLocaleString()}</b> Movies</span><span><b>${Number(c.series||0).toLocaleString()}</b> Shows</span><span><b>${saved?'✓':'—'}</b> Login saved</span></div><div class="provider-manager-actions"><button class="btn secondary compact-btn" data-provider-toggle="${esc(p.id)}">${p.enabled===false?'Enable':'Disable'}</button><button class="btn secondary compact-btn" data-provider-refresh="${esc(p.id)}">↻ Refresh</button><button class="btn secondary compact-btn" data-provider-edit="${esc(p.id)}">Edit</button><button class="provider-priority-btn" data-provider-up="${esc(p.id)}" ${index===0?'disabled':''}>↑</button><button class="provider-priority-btn" data-provider-down="${esc(p.id)}" ${index===providers.length-1?'disabled':''}>↓</button><button class="btn danger compact-btn" data-provider-remove="${esc(p.id)}">Remove</button></div></div></article>`}).join('')}</section>`:`<section class="provider-manager-empty"><div class="empty-mark">S</div><h3>No providers connected yet</h3><p>Add an Xtream Codes or M3U provider below. You can add more later without replacing the first one.</p></section>`;
  const helper=NATIVE_WINDOWS?`<div class="provider-note native-note"><div class="provider-note-icon">✓</div><div><strong>Windows Native Bridge ready</strong><span>HTTP and HTTPS Xtream servers are supported. No Cloudflare details are needed in this Windows app.</span></div></div>`:`<details class="helper-box compact-helper"><summary>Connection Helper <span>only if direct login fails</span></summary><div class="helper-body"><p class="form-hint">Use your Swoop Connection Helper when a provider blocks browser API requests. This setting applies to this provider only.</p><div class="field"><label>Connection Helper URL</label><input name="relayUrl" type="url" value="${esc(state.settings.xtreamRelayUrl||xtreamSaved.relayUrl||'')}" placeholder="https://your-worker.workers.dev"></div><div class="field"><label>Helper token</label><input name="relayToken" type="password" value="${esc(state.settings.xtreamRelayToken||xtreamSaved.relayToken||'')}" autocomplete="off" placeholder="SWOOP_PROXY_TOKEN"></div></div></details>`;
  return `<div class="modal-backdrop" data-close-modal><div class="modal provider-modal multi-provider-modal" data-modal-card><div class="modal-head provider-modal-head"><div><div class="eyebrow">TV PROVIDERS</div><h2>Provider Manager</h2><p>Combine multiple Xtream and M3U services into one Swoop library. Profiles, My List and Continue Watching stay separate from provider connections.</p></div><button class="icon-btn" data-close aria-label="Close">✕</button></div><div class="modal-body provider-modal-body">${providerCards}<div id="providerSetup"><section class="provider-add-section"><div class="provider-add-heading"><span class="eyebrow">ADD ANOTHER PROVIDER</span><h3>Connect a TV service</h3><p>Adding a provider extends the unified library — it no longer replaces your existing service.</p></div><div class="provider-methods" aria-label="Provider type"><button type="button" class="provider-method active" data-provider-tab="xtream"><span class="provider-method-icon">X</span><span><strong>Xtream Codes</strong><small>Server URL + username + password</small></span><span class="provider-method-check">✓</span></button><button type="button" class="provider-method" data-provider-tab="m3u"><span class="provider-method-icon">M3U</span><span><strong>M3U Playlist</strong><small>Playlist URL or local M3U file</small></span><span class="provider-method-check">✓</span></button></div>
    <form id="xtreamForm" class="provider-form"><div class="provider-form-intro"><div><div class="eyebrow">XTREAM CODES</div><h3>Add Xtream provider</h3><p>Enter the same Xtream details you use in another IPTV player.</p></div><span class="provider-badge">Recommended</span></div><div class="field"><label>Provider name</label><input name="name" value="" placeholder="e.g. Main TV" required></div><div class="field"><label>Server URL</label><input name="server" type="url" value="" placeholder="http://provider.example:port" required></div><div class="split"><div class="field"><label>Username</label><input name="username" value="" autocomplete="username" required></div><div class="field"><label>Password</label><input name="password" type="password" value="" autocomplete="current-password" required></div></div>${helper}<label class="remember-row provider-remember"><input type="checkbox" name="remember" checked><span><strong>Keep this provider signed in on this device</strong><small>Required for automatic refreshes, EPG, series episodes and provider fallback after Swoop restarts.</small></span></label><button class="btn accent provider-primary" type="submit"><span>Add Xtream Provider</span><span>→</span></button></form>
    <form id="m3uForm" class="provider-form" hidden><div class="provider-form-intro"><div><div class="eyebrow">M3U PLAYLIST</div><h3>Add M3U provider</h3><p>Use either a playlist URL or a local M3U/M3U8 file.</p></div></div><div class="field"><label>Provider name</label><input name="name" value="" placeholder="e.g. Backup TV" required></div><div class="field"><label>M3U playlist URL</label><input name="url" type="url" value="" placeholder="http://provider.example/get.php?... "></div><div class="provider-or"><span>or</span></div><div class="field"><label>Choose M3U file</label><input name="file" type="file" accept=".m3u,.m3u8,text/plain,application/x-mpegURL"></div><div class="field"><label>TV guide / XMLTV URL <span class="optional">Optional</span></label><input name="epgUrl" type="url" value="" placeholder="http://provider.example/epg.xml"></div><div class="provider-note"><div class="provider-note-icon">i</div><div><strong>${NATIVE_WINDOWS?'Windows import ready':'Playlist import'}</strong><span>${NATIVE_WINDOWS?'The Windows bridge can fetch HTTP or HTTPS playlist URLs directly.':'Local files work immediately. URL imports require the playlist server to allow browser requests.'}</span></div></div><label class="remember-row provider-remember"><input type="checkbox" name="remember" checked><span><strong>Remember this playlist on this device</strong><small>URL and guide details are saved so Swoop can refresh this source later.</small></span></label><button class="btn accent provider-primary" type="submit"><span>Add M3U Provider</span><span>→</span></button></form></section></div>
    <section id="providerProgress" class="provider-progress" hidden aria-live="polite" aria-busy="true"><div class="provider-progress-top"><div class="provider-spinner" aria-hidden="true"></div><div><div id="providerProgressKicker" class="eyebrow">PLEASE WAIT</div><h3 id="providerProgressTitle">Connecting to your provider…</h3><p id="providerProgressDetail">Swoop is preparing your TV library. Keep this window open.</p></div></div><div class="provider-progress-bar"><span id="providerProgressBar"></span></div><div id="providerProgressSteps" class="provider-progress-steps"></div><div id="providerProgressSummary" class="provider-progress-summary"></div><div class="provider-progress-actions"><button type="button" class="btn secondary" data-provider-progress-back hidden>Back to details</button></div></section><div id="providerStatus" aria-live="polite"></div></div></div></div>`;
}
function mdblistModal(){return `<div class="modal-backdrop" data-close-modal><div class="modal" data-modal-card><div class="modal-head"><h2>Add MDBList Row</h2><button class="icon-btn" data-close>✕</button></div><div class="modal-body"><form id="mdblistForm" class="form-grid"><div class="field"><label>Row name in Swoop TV</label><input name="rowName" value="My MDBList" required></div><div class="field"><label>MDBList API key</label><input name="apiKey" type="password" value="${esc(state.settings.mdblistApiKey||'')}" required></div><div class="field"><label>List ID</label><input name="listId" placeholder="e.g. 12345"></div><div class="divider"></div><p class="form-hint">Or identify the list by username + list slug/name.</p><div class="split"><div class="field"><label>Username</label><input name="username" placeholder="username"></div><div class="field"><label>List name / slug</label><input name="listName" placeholder="best-action-movies"></div></div><button class="btn accent" type="submit">Fetch & Match Catalog</button></form><div id="mdbStatus"></div></div></div></div>`}
function homeRowsModal(){
  const selected=new Set(state.settings.homeRows),defs=allHomeRowDefs(),groups=[...new Set(defs.map(x=>x.group))];
  const lastWeb=Math.max(0,...Object.values(state.webDiscovery||{}).map(x=>Number(x?.updatedAt||0)),...state.mdblistRows.map(x=>Number(x.updatedAt||0)));
  const feature=visualItem(featureItem()),featureArt=feature?(feature.backdrop||feature.logo):'',theme=currentTheme(),bg=state.settings.backgroundOverride?validHex(state.settings.backgroundColor):theme.bg;
  return `<div class="modal-backdrop" data-close-modal><div class="modal home-rows-modal" data-modal-card><div class="modal-head home-rows-head"><div><div class="eyebrow">HOME SCREEN</div><h2>Customize ${esc(activeProfile()?.name||'Swoop')}</h2><p>Pick a complete Swoop theme, then choose this profile’s Home rows and optional colour override.</p></div><button class="icon-btn" data-close>✕</button></div><div class="modal-body home-rows-body">
  <section class="theme-studio-card"><div class="theme-studio-copy"><span class="eyebrow">PROFILE THEME</span><h3>${esc(theme.name)}</h3><p>${esc(theme.description)}</p></div><div class="theme-picker-grid active-theme-picker">${SWOOP_THEMES.map(t=>`<button type="button" class="theme-choice ${t.id===theme.id?'active':''}" data-active-theme="${esc(t.id)}"><span class="theme-swatch" style="--theme-swatch:${esc(t.swatch)}"><i></i><b>${esc(t.name)}</b></span><span><strong>${esc(t.name)}</strong><small>${esc(t.tagline)}</small></span></button>`).join('')}</div></section>
  <section class="home-look-card theme-preview-${esc(theme.id)}" style="--preview-bg:${esc(bg)}"><div class="home-look-preview">${featureArt?`<img data-swoop-art="${esc(featureArt)}" alt="">`:''}<div class="home-look-shade"></div><div class="home-look-copy"><span class="eyebrow">${esc(theme.name.toUpperCase())} PREVIEW</span><strong>${esc(feature?.name||'Your featured title')}</strong><small>${esc(theme.tagline)} · ${state.settings.backgroundOverride?'Custom background':'Theme background'}</small></div></div><div class="home-look-controls"><span class="eyebrow">ADVANCED APPEARANCE</span><h3>Background colour override</h3><p>Each theme has its own base palette. Turn this on only when you want a custom background behind that theme.</p><label class="remember-row theme-bg-toggle"><input type="checkbox" data-bg-override ${state.settings.backgroundOverride?'checked':''}><span><strong>Use a custom background colour</strong><small>Saved only to ${esc(activeProfile()?.name||'this profile')}.</small></span></label><div class="colour-row ${state.settings.backgroundOverride?'':'disabled'}"><input id="homeBgColor" type="color" value="${esc(bg)}" aria-label="Background colour" ${state.settings.backgroundOverride?'':'disabled'}><input id="homeBgHex" type="text" value="${esc(bg)}" maxlength="7" aria-label="Background hex colour" ${state.settings.backgroundOverride?'':'disabled'}><button type="button" class="btn secondary compact-btn" data-bg-reset>Use ${esc(theme.name)} default</button></div><small class="metadata-note">Artwork source: provider images first, enhanced with TMDb backdrops when configured on ${esc(metadataServiceUrl(state.settings))}.</small><label class="remember-row smart-home-toggle"><input type="checkbox" data-smart-home-toggle ${state.settings.smartHomeOrder!==false?'checked':''}><span><strong>Smart Home ordering for ${esc(activeProfile()?.name||'this profile')}</strong><small>Let viewing history move relevant rows higher while Continue Watching and both Top 20 rows stay pinned at the top. Your selected rows remain under your control.</small></span></label></div></section>
  <section class="discovery-key-card"><div><span class="eyebrow">SWOOP DISCOVERY</span><h3>Built-in charts update automatically</h3><p>Top 20 and Trending now blend short-term TMDb activity with streaming/popularity signals supplied by the Swoop metadata service. End users do not need a Trakt or MDBList account. The key below is optional and is only used for custom MDBList rows you create yourself.</p></div><form id="homeDiscoveryForm"><div class="field"><label>Custom MDBList API key <span class="optional">Optional</span></label><input name="apiKey" type="password" value="${esc(state.settings.mdblistApiKey||'')}" placeholder="Only needed for your own MDBList rows"></div><div class="discovery-key-actions"><button class="btn accent" type="submit">Save Custom Key</button><button class="btn secondary" type="button" data-refresh-discovery>Refresh discovery now</button></div><small>${lastWeb?esc(relativeRefreshTime(lastWeb)):'No discovery refresh yet'}${discoveryRefreshing?' · Refreshing now…':''}</small></form></section>
  <div class="home-row-toolbar"><div><strong>${state.settings.homeRows.length} rows selected</strong><span>Continue Watching, Top 20 Movies and Top 20 TV Shows are pinned first. ${state.settings.smartHomeOrder!==false?'Smart ordering personalises everything below them.':'Use ↑ ↓ to control the remaining rows.'}</span></div><div><button class="btn secondary compact-btn" data-modal="mdblist">＋ Custom MDBList Row</button><button class="btn secondary compact-btn" data-reset-home>Reset defaults</button></div></div>
  <div class="home-row-picker">${groups.map(group=>`<section class="home-row-group"><div class="home-row-group-title"><span>${esc(group)}</span></div>${defs.filter(x=>x.group===group).map(def=>{const pinned=PINNED_HOME_ROWS.includes(def.id),on=pinned||selected.has(def.id),index=state.settings.homeRows.indexOf(def.id),data=homeRowItems(def.id),cache=state.webDiscovery?.[def.id],err=cache?.error||(def.custom?state.mdblistRows.find(r=>`custom:${r.uid}`===def.id)?.error:'');return `<div class="home-row-option ${on?'selected':''} ${pinned?'pinned':''}"><button class="home-row-toggle" ${pinned?'disabled':`data-home-toggle="${esc(def.id)}"`} aria-pressed="${on?'true':'false'}"><span class="home-row-check">${pinned?'PIN':on?'✓':'＋'}</span><span><strong>${esc(def.label)}</strong><small>${pinned?'Pinned at the top of Home · ':''}${esc(def.description||`${data.length.toLocaleString()} items currently available`)}</small>${err?`<em>${esc(err)}</em>`:''}</span></button><div class="home-row-order">${on&&!pinned?`<button data-home-up="${esc(def.id)}" ${index<=PINNED_HOME_ROWS.length?'disabled':''} aria-label="Move ${esc(def.label)} up">↑</button><button data-home-down="${esc(def.id)}" ${index<0||index>=state.settings.homeRows.length-1?'disabled':''} aria-label="Move ${esc(def.label)} down">↓</button>`:''}</div></div>`}).join('')}</section>`).join('')}</div>
  <div class="home-row-footer"><span>Theme, rows and background are stored independently for this profile.</span><button class="btn accent" data-close>Done</button></div>
  </div></div></div>`;
}
function modalHtml(){if(modal==='provider')return providerModal();if(modal==='homeRows')return homeRowsModal();if(modal==='profiles')return profilesModal();if(modal==='profileEdit')return profileEditorModal();if(modal==='pin')return pinModal();return mdblistModal()}
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
  const enriched=isDemoItem(item)?{}:(state.metadataCache?.[item.id]||{});
  const info=payload?.info||{},movie=payload?.movie_data||{};
  const providerCover=resolveProviderAsset(info.movie_image||info.cover_big||info.cover||movie.stream_icon||'',item.providerId);
  const providerBackdrop=resolveProviderAsset((Array.isArray(info.backdrop_path)?info.backdrop_path[0]:info.backdrop_path)||(Array.isArray(payload?.backdrop_path)?payload.backdrop_path[0]:payload?.backdrop_path)||'',item.providerId);
  const cover=item.logo||providerCover;
  const backdrop=item.backdrop||providerBackdrop||cover;
  const genres=Array.isArray(enriched.genres)?enriched.genres.filter(Boolean):[];
  const providerYoutube=String(info.youtube_trailer||'').trim();
  const youtubeKey=enriched.trailerKey||(/(?:youtu\.be\/|v=|embed\/)([A-Za-z0-9_-]{6,})/.exec(providerYoutube)?.[1]||(/^[A-Za-z0-9_-]{6,}$/.test(providerYoutube)?providerYoutube:''));
  return {
    title:enriched.title||info.name||movie.name||item.name,
    plot:enriched.plot||info.plot||info.description||movie.plot||item.plot||'',
    cover,backdrop,backdrops:Array.isArray(item.backdrops)?item.backdrops:[],titleLogo:item.titleLogo||'',
    year:enriched.year||info.releasedate||info.releaseDate||info.year||movie.year||item.year||'',
    rating:tenPointRating(enriched.rating),
    genre:genres.length?genres.join(', '):(info.genre||item.genre||item.group||''),
    genres,
    cast:info.cast||'',castList:Array.isArray(enriched.cast)?enriched.cast:[],
    director:enriched.director||info.director||'',
    duration:enriched.runtime||info.duration||info.episode_run_time||movie.duration||item.duration||'',
    country:info.country||'',age:enriched.certification||info.age||info.mpaa_rating||'',
    youtube:youtubeKey,trailerName:enriched.trailerName||'Official Trailer',
    recommendations:Array.isArray(enriched.recommendations)?enriched.recommendations:[]
  };
}

function normalizeEpisode(item,ep,season){
  const info=ep?.info||{};
  const cfg=providerConfigFor(item);let streamUrl='';try{streamUrl=buildXtreamSeriesStreamUrl(cfg,ep)}catch{}
  return {id:`${item.id}:episode:${ep.id??ep.stream_id??`${season}-${ep.episode_num}`}`,providerId:item.providerId,source:'xtream',kind:'episode',name:ep.title||info.title||`Episode ${ep.episode_num||''}`.trim(),group:item.name,logo:resolveProviderAsset(info.movie_image||info.cover||item.logo,item.providerId),backdrop:resolveProviderAsset(info.movie_image||item.backdrop||item.logo,item.providerId),streamUrl,parentSeriesId:item.id,seriesId:item.seriesId,season:String(season||ep.season||''),episodeNum:ep.episode_num||ep.episode||'',plot:info.plot||info.description||'',duration:info.duration||'',rating:info.rating||'',year:info.releasedate||''};
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
    const seasons=seriesSeasons(detailItem,detailPayload||{});if(!detailSeason&&seasons.length)detailSeason=seasons[0].season;const selected=seasons.find(s=>s.season===detailSeason)||seasons[0];
    const resumeEntry=[...state.continueWatching].sort((a,b)=>(b.lastPlayed||0)-(a.lastPlayed||0)).find(x=>x?.item?.parentSeriesId===detailItem.id);
    const resumeEpisode=resumeEntry?.item?detailEpisodeItems.get(resumeEntry.item.id)||resumeEntry.item:null;
    const first=resumeEpisode||selected?.episodes?.[0];if(first){const pct=Math.round(Number(resumeEntry?.progress||0));primary=`<button class="btn play-btn detail-play" data-play="${esc(first.id)}">▶ ${resumeEpisode&&pct>1?`Resume ${pct}%`:`Play S${esc(first.season)} E${esc(first.episodeNum||'1')}`}</button>`;}
    episodeBlock=`<section class="detail-episodes"><div class="detail-section-head"><div><span class="eyebrow">EPISODES</span><h3>${seasons.length?'Seasons':'Episode information'}</h3></div>${seasons.length?`<div class="season-pills">${seasons.map(s=>`<button class="${s.season===detailSeason?'active':''}" data-season="${esc(s.season)}">Season ${esc(s.season)}</button>`).join('')}</div>`:''}</div>${detailLoading?`<div class="detail-loading"><i></i><span>Loading seasons and episodes…</span></div>`:detailError?`<div class="detail-error">${esc(detailError)}</div>`:selected?.episodes?.length?`<div class="episode-list">${selected.episodes.map(ep=>{const ce=continueEntry(ep.id),pct=Math.round(Number(ce?.progress||0));return `<button class="episode-card" data-play="${esc(ep.id)}"><div class="episode-thumb" style="--episode-bg:linear-gradient(135deg,hsl(${Math.abs(hash(ep.name))%360} 38% 28%),#090a0d)">${ep.logo?`<img data-swoop-art="${esc(ep.logo)}" alt="">`:''}<span>▶</span>${pct>1&&pct<95?`<i class="episode-progress"><b style="width:${pct}%"></b></i>`:''}</div><div class="episode-copy"><div><strong>${ep.episodeNum?`${esc(ep.episodeNum)}. `:''}${esc(ep.name)}</strong>${ep.duration?`<span>${esc(ep.duration)}</span>`:''}${pct>1&&pct<95?`<em>Resume · ${pct}%</em>`:''}</div><p>${esc(ep.plot||'Play this episode from your connected provider.')}</p></div></button>`}).join('')}</div>`:`<div class="detail-empty">No episodes were returned for this series.</div>`}</section>`;
  }else if(detailItem.kind==='movie'){
    const ce=continueEntry(detailItem.id),pct=Math.round(Number(ce?.progress||0));primary=`<button class="btn play-btn detail-play" data-play="${esc(detailItem.id)}">▶ ${pct>1&&pct<95?`Resume · ${pct}%`:'Play'}</button>`;
  }else if(detailItem.kind==='live') primary=`<button class="btn play-btn detail-play" data-play="${esc(detailItem.id)}">▶ Watch Live</button>`;
  const watched=isWatched(detailItem);
  const watchedButton=detailItem.kind!=='live'?`<button class="btn secondary detail-watched-toggle ${watched?'watched':''}" data-toggle-watched="${esc(detailItem.id)}"><span>${watched?'✓':'○'}</span> ${watched?'Mark as Unwatched':'Mark as Watched'}</button>`:'';
  const tmdbRelated=matchTmdbRecommendations(meta.recommendations,detailItem.kind);
  const providerRelated=detailItem.kind==='movie'?items('movie').filter(x=>x.id!==detailItem.id&&x.group===detailItem.group):activeCatalog().filter(x=>x.id!==detailItem.id&&x.kind===detailItem.kind&&x.group===detailItem.group);
  const related=[...new Map([...tmdbRelated,...providerRelated].filter(x=>x.id!==detailItem.id).map(x=>[x.id,x])).values()].slice(0,18);
  const sourceProviders=Array.isArray(detailItem.sources)?[...new Set(detailItem.sources.map(x=>providerDisplayName(x)))]:[providerDisplayName(detailItem)];const facts=[['Genre',meta.genre],['Director / Creator',meta.director],['Country',meta.country],['Runtime',meta.duration],['Rating',meta.age],['Providers',sourceProviders.filter(Boolean).join(', ')],['Playback sources',detailItem.sourceCount>1?`${detailItem.sourceCount} available`:'']].filter(([,v])=>v);
  const castBlock=meta.castList.length?`<section class="detail-cast"><div class="detail-section-head"><div><span class="eyebrow">CAST</span><h3>Cast & Characters</h3></div></div><div class="cast-rail">${meta.castList.map(person=>`<div class="cast-card">${person.profile?`<img data-swoop-art="${esc(person.profile)}" alt="">`:`<div class="cast-fallback">${esc((person.name||'?').slice(0,1))}</div>`}<strong>${esc(person.name)}</strong><span>${esc(person.character||'')}</span></div>`).join('')}</div></section>`:'';
  const trailerButton=meta.youtube?`<button class="btn secondary detail-trailer" data-trailer="${esc(meta.youtube)}" data-trailer-title="${esc(meta.trailerName||meta.title)}"><span>▶</span> Trailer</button>`:'';
  return `<main class="detail-overlay detail-route" aria-label="${esc(meta.title)}"><button class="detail-close" data-detail-close aria-label="Back">←</button><div class="detail-scroll"><section class="detail-hero ${hasCinematicBackdrop?'has-backdrop':'poster-fallback'}"><div class="detail-media"><div class="detail-fallback" style="--detail-fallback:${detailItem.demoColor||'linear-gradient(135deg,#151b2a,#050609)'}"></div>${backdrop?`<img class="detail-backdrop" data-swoop-art="${esc(backdrop)}" alt="">`:''}</div><div class="detail-vignette"></div><div class="detail-copy"><div class="eyebrow">${esc(kindLabel(detailItem).toUpperCase())}</div>${meta.titleLogo?`<img class="detail-title-logo" data-swoop-art="${esc(meta.titleLogo)}" alt="${esc(meta.title)}">`:`<h2>${esc(meta.title)}</h2>`}<div class="detail-meta">${[meta.year,meta.rating?`★ ${meta.rating}`:'',meta.age,detailItem.group].filter(Boolean).map(x=>`<span>${esc(x)}</span>`).join('')}</div><p>${esc(meta.plot||`Available from ${providerSummaryName()}.`)}</p><div class="cta-row">${primary}${trailerButton}<button class="btn secondary detail-list ${saved?'saved':''}" data-toggle-list="${esc(detailItem.id)}"><span>${saved?'✓':'＋'}</span> ${saved?'In My List':'My List'}</button>${watchedButton}</div></div>${meta.cover&&!hasCinematicBackdrop?`<img class="detail-poster" data-swoop-art="${esc(meta.cover)}" alt="">`:''}</section>
  ${episodeBlock}${castBlock}<section class="detail-info"><div><span class="eyebrow">ABOUT</span><h3>More about ${esc(meta.title)}</h3></div><div class="detail-facts">${facts.length?facts.map(([k,v])=>`<div><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`).join(''):'<div><span>Source</span><strong>Your connected provider</strong></div>'}</div></section>${related.length?`<section class="detail-related">${rail('More Like This',related,detailItem.kind!=='live')}</section>`:''}</div></main>`;
}
function trailerHtml(){return trailerKey?`<div class="trailer-shell" role="dialog" aria-modal="true"><div class="trailer-card"><button class="trailer-close" data-trailer-close>✕</button><iframe src="https://www.youtube.com/embed/${esc(trailerKey)}?autoplay=1&rel=0" title="${esc(trailerTitle||'Trailer')}" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe><div class="trailer-caption"><span class="eyebrow">TRAILER</span><strong>${esc(trailerTitle||'Official Trailer')}</strong></div></div></div>`:''}

async function resolveNativeCatalogItem(item,{includeSources=true}={}){
  if(!item||!nativeCatalogMode||!item._nativeLogicalKey||item.kind==='episode')return item;
  if(includeSources&&Array.isArray(item.sources)&&item.sources.length)return item;
  // A representative SQLite row already contains a playable provider URL. Avoid a bridge round-trip for single-source titles.
  if(item.streamUrl&&Number(item.sourceCount||1)<=1)return item;
  try{
    const result=await nativeCatalogSources(item._nativeLogicalKey),sources=cacheNativeItems(result?.items||[]);
    if(!sources.length)return item;
    const representative=sources.find(x=>x.providerId===item.providerId)||sources[0];
    const resolved={...item,...representative,id:item.id,name:item.name||representative.name,_nativeLogicalKey:item._nativeLogicalKey,_nativeSourceIds:item._nativeSourceIds||sources.map(x=>x.id),sourceCount:Math.max(Number(item.sourceCount||0),sources.length)};
    if(includeSources&&sources.length>1)resolved.sources=sources;
    cacheNativeItems([resolved]);
    return resolved;
  }catch{return item}
}

async function openDetail(item){
  if(!item)return;
  if(!detailItem){detailReturnScroll=window.scrollY||document.documentElement.scrollTop||0;detailScrollTop=0;}
  // Route immediately. Native source hydration must never make a thumbnail click feel dead.
  detailItem=item;detailSeason='';detailError='';detailPayload=detailCache.get(item.id)||null;detailLoading=false;render();
  const openingId=item.id;
  if(['movie','series'].includes(item.kind))setTimeout(()=>enrichItemMetadata(item,{rerender:true}),0);
  let resolved=item;
  try{resolved=await resolveNativeCatalogItem(item,{includeSources:true})||item}catch{}
  if(detailItem?.id!==openingId)return;
  if(resolved!==detailItem){detailItem=resolved;cacheNativeItems([resolved]);}
  if(detailPayload||resolved.source!=='xtream'||!['movie','series'].includes(resolved.kind)){if(resolved!==item)render();return;}
  const cfg=providerConfigFor(resolved);
  if(!cfg.server||!cfg.username||!cfg.password){detailError=`Reconnect ${providerDisplayName(resolved)} or save its Xtream login to load full title details.`;render();return;}
  detailLoading=true;render();
  try{
    const payload=resolved.kind==='series'?await fetchXtreamSeriesInfo(cfg,resolved.seriesId):await fetchXtreamVodInfo(cfg,resolved.streamId);
    detailCache.set(resolved.id,payload||{});
    if(detailItem?.id===openingId){detailPayload=payload||{};detailLoading=false;render();}
  }catch(err){if(detailItem?.id===openingId){detailLoading=false;detailError=err.message||'Could not load title details.';render();}}
}
function closeDetail(){detailItem=null;detailPayload=null;detailLoading=false;detailError='';detailSeason='';detailEpisodeItems.clear();detailScrollTop=0;render();requestAnimationFrame(()=>window.scrollTo(0,detailReturnScroll||0))}
function toggleMyList(item){if(!item)return;const ids=new Set(logicalItemIds(item)),saved=state.myList.some(id=>ids.has(id));if(saved){state.myList=state.myList.filter(id=>!ids.has(id));toast('Removed from My List')}else{state.myList.unshift(item.id);toast('Added to My List')}persist();render()}
function watchHistoryEntry(itemOrId){
  const item=typeof itemOrId==='string'?savedItem(itemOrId):itemOrId,id=typeof itemOrId==='string'?itemOrId:itemOrId?.id;
  const ids=new Set(item?logicalItemIds(item):[id]);
  return state.watchHistory.find(x=>ids.has(String(x?.id||'')))||null;
}
function isWatched(item){const entry=watchHistoryEntry(item);return Boolean(entry?.completed||entry?.manualWatched)}
function toggleWatched(item){
  if(!item||item.kind==='live')return;
  const ids=new Set(logicalItemIds(item));
  if(isWatched(item)){
    state.watchHistory=state.watchHistory.filter(x=>!ids.has(String(x?.id||'')));
    state.continueWatching=state.continueWatching.filter(x=>!ids.has(String(x?.id||'')));
    toast('Marked as unwatched');
  }else{
    const existing=watchHistoryEntry(item)||{};
    const entry={...existing,id:item.id,item:compactMediaSnapshot(item),lastPlayed:Date.now(),selectedSourceId:item._selectedSourceId||existing.selectedSourceId||'',completed:true,manualWatched:true,completedAt:Date.now()};
    state.watchHistory=state.watchHistory.filter(x=>!ids.has(String(x?.id||'')));state.watchHistory.unshift(entry);state.watchHistory=state.watchHistory.slice(0,HOME_STANDARD_ROW_LIMIT);
    state.continueWatching=state.continueWatching.filter(x=>!ids.has(String(x?.id||'')));
    toast('Marked as watched');
  }
  persist();render();
}
function recordWatchHistory(item,{completed=false}={}){
  if(!item)return;
  const ids=new Set(logicalItemIds(item));
  if(item.kind==='live'){
    state.recentLive=[item.id,...state.recentLive.filter(id=>!ids.has(String(id)))].slice(0,HOME_STANDARD_ROW_LIMIT);
    return;
  }
  const prior=state.watchHistory.find(x=>ids.has(String(x?.id||'')))||{};
  const done=Boolean(completed||prior.completed||prior.manualWatched);
  const entry={...prior,id:item.id,item:compactMediaSnapshot(item),lastPlayed:Date.now(),selectedSourceId:item._selectedSourceId||prior.selectedSourceId||'',completed:done,manualWatched:Boolean(prior.manualWatched),completedAt:done?Number(prior.completedAt||Date.now()):0};
  state.watchHistory=state.watchHistory.filter(x=>!ids.has(String(x?.id||'')));state.watchHistory.unshift(entry);state.watchHistory=state.watchHistory.slice(0,HOME_STANDARD_ROW_LIMIT);
}
function rememberWatching(item){
  if(!item)return;recordWatchHistory(item);
  if(item.kind==='live'){persist();return}
  const old=continueEntry(item.id)||{};
  const entry={id:item.id,item:compactMediaSnapshot(item),lastPlayed:Date.now(),progress:Number(old.progress||0),position:Number(old.position||0),duration:Number(old.duration||0),selectedSourceId:item._selectedSourceId||old.selectedSourceId||''};
  const ids=new Set(logicalItemIds(item));state.continueWatching=state.continueWatching.filter(x=>!ids.has(String(x?.id||'')));state.continueWatching.unshift(entry);state.continueWatching=state.continueWatching.slice(0,HOME_STANDARD_ROW_LIMIT);persist();
}
function resumeSeconds(item){
  const e=continueEntry(item?.id);if(!e)return 0;
  const pos=Number(e.position||0),pct=Number(e.progress||0),duration=Number(e.duration||0);
  if(pos<10)return 0;
  if((pct>0&&pct>=95)||(duration>60&&pos/duration>=.95))return 0;
  return pos;
}
function updateContinueProgress(item,pb,force=false){
  if(!item||item.kind==='live'||!pb)return;
  const pos=Math.max(0,Number(pb.timePos||0)),duration=Math.max(0,Number(pb.duration||0));
  const pct=duration>0?Math.max(0,Math.min(100,(pos/duration)*100)):Math.max(0,Math.min(100,Number(pb.percentPos||0)));
  const complete=Boolean(pb.eofReached)||(duration>60&&pct>=95);
  recordWatchHistory(item,{completed:complete});
  if(complete){const ids=new Set(logicalItemIds(item));state.continueWatching=state.continueWatching.filter(x=>!ids.has(String(x?.id||'')));persist();return}
  if(pos<8&&pct<1&&!force)return;
  const old=continueEntry(item.id)||{};
  const entry={id:item.id,item:compactMediaSnapshot(item),lastPlayed:Date.now(),position:pos||Number(old.position||0),duration:duration||Number(old.duration||0),progress:pct||Number(old.progress||0),selectedSourceId:item._selectedSourceId||old.selectedSourceId||''};
  const ids=new Set(logicalItemIds(item));state.continueWatching=state.continueWatching.filter(x=>!ids.has(String(x?.id||'')));state.continueWatching.unshift(entry);state.continueWatching=state.continueWatching.slice(0,HOME_STANDARD_ROW_LIMIT);
  if(force||Date.now()-lastPlaybackPersist>7000){lastPlaybackPersist=Date.now();persist()}
}
function nextEpisodeFromMap(item){
  if(item?.kind!=='episode')return null;
  const list=[...detailEpisodeItems.values()].filter(x=>x.parentSeriesId===item.parentSeriesId).sort((a,b)=>Number(a.season)-Number(b.season)||Number(a.episodeNum)-Number(b.episodeNum));
  const idx=list.findIndex(x=>x.id===item.id);return idx>=0?list[idx+1]||null:null;
}
async function findNextEpisode(item){
  let next=nextEpisodeFromMap(item);if(next)return next;
  if(item?.kind!=='episode'||!item.seriesId)return null;const cfg=providerConfigFor(item);if(!cfg.server)return null;
  try{const parent=savedItem(item.parentSeriesId)||{id:item.parentSeriesId,seriesId:item.seriesId,name:item.group||'Series',providerId:item.providerId,kind:'series',source:'xtream'};const payload=await fetchXtreamSeriesInfo(cfg,item.seriesId);seriesSeasons(parent,payload);return nextEpisodeFromMap(item)}catch{return null}
}
function clearUpNext(){if(upNextTimer){clearInterval(upNextTimer);upNextTimer=null}upNextItem=null;upNextSeconds=0;document.querySelector('.up-next-overlay')?.remove()}
function showUpNext(next){
  clearUpNext();if(!next)return;upNextItem=next;upNextSeconds=10;
  const shell=document.querySelector('.player-shell');if(!shell)return;
  const el=document.createElement('div');el.className='up-next-overlay';el.innerHTML=`<div class="up-next-card"><span class="eyebrow">UP NEXT</span><h3>${esc(next.name)}</h3><p>Season ${esc(next.season||'')} · Episode ${esc(next.episodeNum||'')}</p><div class="up-next-count">Playing in <strong data-upnext-count>${upNextSeconds}</strong>s</div><div class="cta-row"><button class="btn play-btn" data-upnext-play>▶ Play now</button><button class="btn secondary" data-upnext-cancel>Cancel</button></div></div>`;shell.appendChild(el);
  el.querySelector('[data-upnext-play]').onclick=()=>{clearUpNext();play(next)};el.querySelector('[data-upnext-cancel]').onclick=()=>{clearUpNext();const st=document.querySelector('#playerStatus');if(st)st.textContent='Episode finished'};
  upNextTimer=setInterval(()=>{upNextSeconds--;const c=document.querySelector('[data-upnext-count]');if(c)c.textContent=String(Math.max(0,upNextSeconds));if(upNextSeconds<=0){clearUpNext();play(next)}},1000);
}
async function handlePlaybackFinished(item){
  if(item?.kind==='episode'){const next=await findNextEpisode(item);if(next){showUpNext(next);return}}
  const status=document.querySelector('#playerStatus');if(status)status.textContent=item?.kind==='live'?'Live playback closed':'Playback finished';
}
function updatePlayerProgressUi(pb){
  if(!pb)return;const bar=document.querySelector('#nativeProgressBar'),time=document.querySelector('#nativeProgressTime');
  const pos=Number(pb.timePos||0),dur=Number(pb.duration||0),pct=dur>0?Math.max(0,Math.min(100,pos/dur*100)):Number(pb.percentPos||0);
  if(bar)bar.style.width=`${pct||0}%`;
  const fmt=x=>{x=Math.max(0,Math.floor(Number(x||0)));const h=Math.floor(x/3600),m=Math.floor((x%3600)/60),sec=x%60;return h?`${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`:`${m}:${String(sec).padStart(2,'0')}`};
  if(time)time.textContent=dur>0?`${fmt(pos)} / ${fmt(dur)}`:fmt(pos);
  const tech=document.querySelector('#nativePlaybackTech');if(tech){const res=Number(pb.width)>0&&Number(pb.height)>0?`${Math.round(Number(pb.width))}×${Math.round(Number(pb.height))}`:'',fmtLabel=String(pb.videoFormat||'').toUpperCase(),audio=String(pb.audioCodec||'').toUpperCase();const bits=[res,fmtLabel,audio].filter(Boolean);tech.textContent=bits.length?bits.join(' · '):'Waiting for stream details…'}
}
function stopPlaybackMonitor(){if(playbackMonitorTimer){clearInterval(playbackMonitorTimer);playbackMonitorTimer=null}}
function startPlaybackMonitor(item){
  stopPlaybackMonitor();if(!NATIVE_WINDOWS)return;let endedHandled=false;
  const poll=async()=>{if(!playerItem||playerItem.id!==item.id)return;try{const diag=await nativeDiagnostics(),pb=diag?.playback;updatePlayerProgressUi(pb);if(item.kind!=='live')updateContinueProgress(item,pb,false);const dur=Number(pb?.duration||0),pos=Number(pb?.timePos||0),finished=Boolean(pb?.eofReached)||(dur>60&&pos/dur>=.992);if(finished&&!endedHandled){endedHandled=true;updateContinueProgress(item,{...(pb||{}),eofReached:true},true);stopPlaybackMonitor();handlePlaybackFinished(item);return}if(!diag?.playing&&Date.now()-playerStartedAt>2500&&!endedHandled){endedHandled=true;if(item.kind!=='live')updateContinueProgress(item,pb,true);stopPlaybackMonitor();handlePlaybackFinished(item)}}catch{}};
  poll();playbackMonitorTimer=setInterval(poll,2200);
}
async function loadPlayerNowNext(item){
  if(item?.kind!=='live')return;const box=document.querySelector('#liveNowNext');if(!box)return;
  try{
    let cached=epgCache.get(item.id);
    if(!cached||Date.now()-cached.loadedAt>300000){const src=preferredLiveSource(item),cfg=providerConfigFor(src);if(src.source==='xtream'&&cfg.server){const payload=await fetchXtreamShortEpg(cfg,src.streamId,8);cached={loadedAt:Date.now(),list:normalizeXtreamEpg(payload)};epgCache.set(item.id,cached)}}
    const now=Date.now(),list=cached?.list||[],current=list.find(p=>now>=p.startMs&&now<p.endMs),next=list.find(p=>p.startMs>=now&&p!==current);
    box.innerHTML=current?`<div class="live-program current"><span>NOW</span><strong>${esc(current.title)}</strong><small>${new Date(current.startMs).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}–${new Date(current.endMs).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}</small></div>${next?`<div class="live-program"><span>NEXT</span><strong>${esc(next.title)}</strong><small>${new Date(next.startMs).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}</small></div>`:''}`:`<div class="live-program"><span>LIVE</span><strong>${esc(item.name)}</strong><small>Programme information unavailable</small></div>`;
  }catch{box.innerHTML=`<div class="live-program"><span>LIVE</span><strong>${esc(item.name)}</strong><small>Open Guide for programme information</small></div>`}
}
function adjacentLive(item,step=1){const list=items('live');if(!list.length)return null;const idx=Math.max(0,list.findIndex(x=>x.id===item?.id));return list[(idx+Number(step)+list.length)%list.length]}
function liveMiniGuideChannels(item,count=7){
  const all=items('live');if(!all.length)return[];
  const same=all.filter(x=>x.group===item?.group),pool=same.length>=Math.min(4,count)?same:all;
  const idx=Math.max(0,pool.findIndex(x=>x.id===item?.id)),half=Math.floor(count/2),out=[];
  for(let offset=-half;offset<=half;offset++){const ch=pool[(idx+offset+pool.length)%pool.length];if(ch&&!out.some(x=>x.id===ch.id))out.push(ch)}
  return out.slice(0,count);
}
function currentProgramme(channel){const cached=epgCache.get(channel?.id),now=Date.now(),list=cached?.list||[];return list.find(p=>now>=p.startMs&&now<p.endMs)||null}
async function ensureLiveEpg(channel){
  if(!channel)return;
  const cached=epgCache.get(channel.id);if(cached&&Date.now()-cached.loadedAt<300000)return cached;
  const src=preferredLiveSource(channel),cfg=providerConfigFor(src);if(src.source==='xtream'&&cfg.server&&src.streamId){try{const payload=await fetchXtreamShortEpg(cfg,src.streamId,6),next={loadedAt:Date.now(),list:normalizeXtreamEpg(payload)};epgCache.set(channel.id,next);return next}catch{}}
  return cached||{loadedAt:Date.now(),list:[]};
}
function liveMiniGuideRowsHtml(item){return liveMiniGuideChannels(item).map((ch,index)=>{const p=currentProgramme(ch),active=ch.id===item?.id,q=qualityLabel(ch),number=items('live').findIndex(x=>x.id===ch.id)+1;return `<button class="live-mini-row ${active?'active':''}" data-mini-channel="${esc(ch.id)}"><span class="live-mini-num">${number>0?number:'—'}</span>${ch.logo?`<img data-swoop-art="${esc(ch.logo)}" alt="">`:'<span class="live-mini-logo">TV</span>'}<span class="live-mini-copy"><strong>${esc(ch.name)}</strong><small data-mini-guide-prog="${esc(ch.id)}">${p?esc(p.title):'Loading programme…'}</small></span>${q?`<i>${esc(q)}</i>`:''}${active?'<b>NOW</b>':''}</button>`}).join('')}
async function loadLiveMiniGuide(item){
  if(item?.kind!=='live')return;const token=++liveMiniGuideToken,channels=liveMiniGuideChannels(item);
  await Promise.all(channels.map(ch=>ensureLiveEpg(ch)));
  if(token!==liveMiniGuideToken||playerItem?.id!==item.id)return;
  for(const ch of channels){const el=document.querySelector(`[data-mini-guide-prog="${CSS.escape(ch.id)}"]`),p=currentProgramme(ch);if(el)el.textContent=p?.title||'Programme information unavailable'}
}
async function switchLiveChannel(next){
  if(!next||next.kind!=='live')return;const playable=preferredLiveSource(next);
  if(!(NATIVE_WINDOWS&&playerItem?.kind==='live')){play(playable);return}
  try{
    const status=document.querySelector('#playerStatus');if(status)status.textContent=`Switching to ${next.name}…`;
    await nativeSwitchLive(playable);rememberWatching(next);playerItem=playable;playerStartedAt=Date.now();render();startPlaybackMonitor(playable);loadPlayerNowNext(playable);loadLiveMiniGuide(playable);
    const st=document.querySelector('#playerStatus');if(st)st.textContent='● LIVE · Channel changed';
  }catch(err){toast(err.message||'Could not change channel')}
}
function compactMediaSnapshot(item){if(!item)return item;const {sources,...rest}=item;return rest}
function sourceChoiceHtml(){
  const item=sourceChoiceItem;if(!item)return'';
  const sources=rankSources(Array.isArray(item.sources)?item.sources:[],savedMovieSourcePreference(item)||continueEntry(item.id)?.selectedSourceId||'',providerPriorityMap()),resume=resumeSeconds(item);
  const recommended=sources[0],preferred=savedMovieSourcePreference(item)||continueEntry(item.id)?.selectedSourceId||'';
  return `<div class="source-choice-overlay" role="dialog" aria-modal="true" aria-label="Choose source for ${esc(item.name)}"><div class="source-choice-card smart-source-card"><div class="source-choice-head"><div><span class="eyebrow">SMART SOURCE SELECTION · ${sources.length} OPTIONS</span><h2>Choose how to watch</h2><p>Swoop ranked the confidently matched copies of <strong>${esc(item.name)}</strong> using resolution, HDR, codec and provider clues. You always make the final choice${resume>0?` · resume point ${Math.floor(resume/60)}m ${Math.floor(resume%60)}s`:''}.</p>${recommended?`<button class="btn play-btn smart-best-btn" data-source-best="${esc(recommended.id)}">▶ Play Recommended <small>${esc(sourceTechSummary(recommended))}</small></button>`:''}</div><button class="icon-btn" data-source-close aria-label="Close">✕</button></div><div class="source-choice-list">${sources.map((source,index)=>{const t=sourceTraits(source),label=source._sourceLabel||`Source ${index+1}`,isPreferred=preferred&&preferred===source.id,isRecommended=recommended?.id===source.id;const badges=[t.quality,t.hdr,t.codec,t.audio].filter(Boolean);return `<button class="source-option ${isRecommended?'recommended':''}" data-source-play="${esc(source.id)}"><span class="source-option-main"><strong>${esc(label)}</strong><small>${esc(source.name||item.name)}</small><em>${esc(providerDisplayName(source))} · ${esc(source.group||'Provider source')}</em></span><span class="source-option-tech">${badges.length?badges.map(x=>`<i>${esc(x)}</i>`).join(''):'<i>STANDARD</i>'}</span><span class="source-option-flags">${isPreferred?'<b>PREFERRED</b>':''}${isRecommended?'<b>RECOMMENDED</b>':''}${t.tag?`<i>${esc(t.tag)}</i>`:''}<span>Play →</span></span></button>`}).join('')}</div><div class="source-confidence"><span>✓ Confident duplicate stack</span><small>Matched using ${esc(item._stackConfidence||'provider metadata')}. Choosing a source remembers it for this movie. If a recommended source exits immediately, Swoop can try the next ranked copy automatically.</small></div></div></div>`;
}
function playableFromSource(logical,source,{attempts=[]}={}){const prior=[...new Set([...(attempts||[]),source.id].filter(Boolean))];return {...logical,...source,id:logical.id,name:logical.name,logo:logical.logo||source.logo,backdrop:logical.backdrop||source.backdrop,sources:logical.sources,sourceCount:logical.sourceCount,_stacked:logical._stacked,_stackConfidence:logical._stackConfidence,_selectedSourceId:source.id,_selectedSourceLabel:source._sourceLabel||'',_sourceAttemptIds:prior}}
function nextSourceFallback(item){const logical=savedItem(item?.id);if(!logical||!Array.isArray(logical.sources)||logical.sources.length<2)return null;const attempted=new Set([...(item?._sourceAttemptIds||[]),item?._selectedSourceId].filter(Boolean));const next=rankSources(logical.sources,'',providerPriorityMap()).find(x=>!attempted.has(x.id));return next?{logical,source:next,attempts:[...attempted]}:null}
async function autoFallbackSource(item){const fallback=nextSourceFallback(item);if(!fallback)return false;const status=document.querySelector('#playerStatus'),msg=document.querySelector('#playerMessage');if(status)status.textContent='Trying another source…';if(msg)msg.textContent=`The selected source closed immediately. Swoop is trying ${fallback.source._sourceLabel||'the next ranked source'} automatically.`;await new Promise(r=>setTimeout(r,500));await play(playableFromSource(fallback.logical,fallback.source,{attempts:fallback.attempts}),{sourceSelected:true,fallback:true});return true}
function playerHtml(){
  if(NATIVE_WINDOWS){
    const live=playerItem?.kind==='live',ce=continueEntry(playerItem?.id),pct=Math.round(Number(ce?.progress||0));
    if(live){
      const item=visualItem(playerItem),fav=isLiveFavourite(item),q=qualityLabel(item),logo=item.logo?`<img class="native-live-logo" data-swoop-art="${esc(item.logo)}" alt="">`:'<span class="native-live-logo-fallback">TV</span>';
      return `<div class="player-shell native-player-shell premium-live-player" role="dialog" aria-modal="true" aria-label="${esc(item?.name||'Swoop Live TV')}"><div class="premium-live-layout"><section class="native-live-main"><div class="native-live-channel-head">${logo}<div><div class="eyebrow">● LIVE TV ${q?`· ${esc(q)}`:''}</div><h2>${esc(item?.name||'')}</h2><p>${esc(item?.group||'Live TV')}</p></div><button class="live-fav-control ${fav?'active':''}" data-live-favourite="${esc(item.id)}">${fav?'★ Favourite':'☆ Favourite'}</button></div><div id="playerStatus" class="player-status native-live-status">Launching native playback…</div><div id="liveNowNext" class="live-now-next premium-now-next"><div class="live-program"><span>GUIDE</span><strong>Loading Now & Next…</strong></div></div><div class="native-channel-controls premium-channel-controls"><button class="btn secondary" data-channel-step="-1">‹ Channel</button><button class="btn play-btn" data-player-guide>▤ Full TV Guide</button><button class="btn secondary" data-channel-step="1">Channel ›</button></div><div id="playerMessage" class="native-player-copy">The video plays in the native mpv window while Swoop stays open as your channel-surfing control centre.</div><div class="live-shortcuts"><span id="liveChannelNumber" class="channel-number-indicator"></span><span><kbd>PgUp</kbd>/<kbd>PgDn</kbd> change channel</span><span><kbd>0–9</kbd> jump to channel number</span><span><kbd>F</kbd> fullscreen in mpv</span></div><div class="cta-row"><button class="btn danger" data-native-stop>Stop playback</button><button class="btn secondary" data-close-player>Back to Swoop</button></div></section><aside class="live-mini-guide"><div class="live-mini-head"><div><span class="eyebrow">QUICK GUIDE</span><h3>${esc(item.group||'Nearby Channels')}</h3></div><button class="icon-btn" data-player-guide aria-label="Open full guide">▤</button></div><div class="live-mini-list">${liveMiniGuideRowsHtml(item)}</div></aside></div></div>`;
    }
    const sourceInfo=playerItem?sourceTechSummary(playerItem):'';
    return `<div class="player-shell native-player-shell" role="dialog" aria-modal="true" aria-label="${esc(playerItem?.name||'Swoop Native Player')}"><div class="native-player-card"><div class="eyebrow">WINDOWS NATIVE PLAYER</div><h2>${esc(playerItem?.name||'')}</h2>${playerItem?`<div class="native-source-strip"><span>${esc(playerItem._selectedSourceLabel||playerItem.group||'Provider source')}</span><b>${esc(sourceInfo)}</b></div>`:''}<div id="playerStatus" class="player-status">Launching native playback…</div><div class="native-progress"><div><span>${pct>1?`Resume ${pct}%`:'Playback progress'}</span><strong id="nativeProgressTime">0:00</strong></div><i><b id="nativeProgressBar" style="width:${pct}%"></b></i></div><div class="native-transport"><button class="mini-control" data-native-control="seek" data-native-value="-10">−10s</button><button class="mini-control" data-native-control="toggle-pause">Pause / Resume</button><button class="mini-control" data-native-control="seek" data-native-value="10">+10s</button></div><div id="nativePlaybackTech" class="native-playback-tech">Waiting for stream details…</div><div id="playerMessage" class="native-player-copy">Swoop saves your native playback position every second and resumes from that point next time.</div><div class="cta-row"><button class="btn danger" data-native-stop>Stop playback</button><button class="btn secondary" data-close-player>Back to Swoop</button></div></div></div>`;
  }
  return `<div class="player-shell" role="dialog" aria-modal="true" aria-label="${esc(playerItem?.name||'Swoop Player')}"><video id="swoopVideo" class="swoop-video" controls autoplay playsinline></video><div class="player-top"><button class="player-back" data-close-player>←</button><div><div class="player-title">${esc(playerItem?.name||'')}</div><div id="playerStatus" class="player-status">${playerItem?.kind==='live'?'Preparing live stream…':'Preparing playback…'}</div></div></div><div id="playerMessage" class="player-message" hidden></div></div>`;
}
function setPlayerMessage(message,isError=false){const status=document.querySelector('#playerStatus'),box=document.querySelector('#playerMessage');if(status)status.textContent=isError?'Playback unavailable':'Loading…';if(box){box.hidden=false;box.classList.toggle('error',isError);box.textContent=message}}
async function stopPlayback(capture=true){
  stopPlaybackMonitor();clearUpNext();
  if(NATIVE_WINDOWS){try{const result=await nativeStop();if(capture&&playerItem?.kind!=='live')updateContinueProgress(playerItem,result?.playback,true)}catch{}}
  try{activeHls?.destroy?.()}catch{}activeHls=null;const video=document.querySelector('#swoopVideo');if(video){try{video.pause()}catch{}video.removeAttribute('src');try{video.load()}catch{}}
}
async function closePlayer(){await stopPlayback(true);playerItem=null;playerUiHidden=false;render()}
function hlsCandidate(item){let url=String(item.streamUrl||'');if(item.kind==='live'&&item.source==='xtream')url=url.replace(/\.(?:ts|m3u8)(?=($|\?))/i,'.m3u8');return url}
function loadHlsLibrary(){if(window.Hls)return Promise.resolve(window.Hls);if(window.__swoopHlsPromise)return window.__swoopHlsPromise;window.__swoopHlsPromise=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='https://cdn.jsdelivr.net/npm/hls.js@1.6.16/dist/hls.min.js';script.async=true;script.onload=()=>window.Hls?resolve(window.Hls):reject(new Error('HLS player did not initialise.'));script.onerror=()=>reject(new Error('Could not load the HLS playback engine.'));document.head.appendChild(script)});return window.__swoopHlsPromise}
async function startPlayback(item){
  if(NATIVE_WINDOWS){try{const startSeconds=resumeSeconds(item);const result=await nativePlay(item,{startSeconds});playerStartedAt=Date.now();const status=document.querySelector('#playerStatus');if(status)status.textContent=startSeconds>0?`Resuming from ${Math.floor(startSeconds/60)}m ${Math.floor(startSeconds%60)}s…`:'Native player starting…';const msg=document.querySelector('#playerMessage');if(msg&&item.kind!=='live')msg.textContent=startSeconds>0?'Opening mpv at your saved position…':'Swoop is checking that native playback stays open…';await new Promise(r=>setTimeout(r,1400));const diag=await nativeDiagnostics();if(diag?.playing){if(status)status.textContent=item.kind==='live'?'● LIVE · Native player opened':startSeconds>0?'Resumed in native player':'Playing in native window';if(msg&&item.kind!=='live')msg.textContent=`Playback is running${result?.pid?` · process ${result.pid}`:''}. Swoop will keep your Continue Watching position in sync.`;if(item.kind==='movie'&&item._selectedSourceId)rememberMovieSourcePreference(item,item._selectedSourceId);startPlaybackMonitor(item);if(item.kind==='live'){loadPlayerNowNext(item);loadLiveMiniGuide(item)}}else{if(item.kind==='movie'&&Array.isArray(item.sources)&&item.sources.length>1&&await autoFallbackSource(item))return;const lines=Array.isArray(diag?.logTail)?diag.logTail.filter(Boolean):[];const tail=lines.slice(-6).join(' | ');const code=diag?.exitCode!==null&&diag?.exitCode!==undefined?` Exit code ${diag.exitCode}.`:'';setPlayerMessage(`The native player started but closed immediately.${code}${tail?` mpv: ${tail}`:' Check the Swoop TV Windows Bridge window for the launch result.'}`,true)}}catch(err){if(item.kind==='movie'&&Array.isArray(item.sources)&&item.sources.length>1&&await autoFallbackSource(item))return;setPlayerMessage(err.message||'Could not launch the Windows native player.',true)}return}
  const video=document.querySelector('#swoopVideo');if(!video||!item)return;const url=hlsCandidate(item);if(location.protocol==='https:'&&/^http:\/\//i.test(url)){setPlayerMessage('This provider is sending an HTTP video stream. An HTTPS web app cannot safely play it in Chrome. Swoop stopped the request instead of letting the browser hang. A secure HTTPS/HLS stream or the native Swoop app is required for this source.',true);return}const lower=url.split('?')[0].toLowerCase(),isHls=/\.m3u8$/.test(lower);if(item.kind==='live'&&!isHls){setPlayerMessage('This live stream is not browser-safe HLS. Swoop has deliberately not opened the raw transport stream because that was causing Chrome to become unresponsive.',true);return}if(isHls){if(video.canPlayType('application/vnd.apple.mpegurl')){video.src=url;video.addEventListener('loadedmetadata',()=>{const s=document.querySelector('#playerStatus');if(s)s.textContent=item.kind==='live'?'● LIVE':'Playing'},{once:true});video.addEventListener('timeupdate',()=>{if(item.kind!=='live'&&video.duration)updateContinueProgress(item,{timePos:video.currentTime,duration:video.duration,percentPos:video.currentTime/video.duration*100},false)});video.addEventListener('ended',()=>handlePlaybackFinished(item),{once:true});video.addEventListener('error',()=>setPlayerMessage('The browser could not open this HLS stream. The provider may block browser playback or the stream may use an unsupported codec.',true),{once:true});try{video.currentTime=resumeSeconds(item);await video.play()}catch{}return}try{const Hls=await loadHlsLibrary();if(!Hls.isSupported())throw new Error('This browser does not provide MediaSource playback.');activeHls=new Hls({enableWorker:true,lowLatencyMode:true,backBufferLength:60,maxBufferLength:20});activeHls.attachMedia(video);activeHls.on(Hls.Events.MEDIA_ATTACHED,()=>activeHls?.loadSource(url));activeHls.on(Hls.Events.MANIFEST_PARSED,()=>{const s=document.querySelector('#playerStatus');if(s)s.textContent=item.kind==='live'?'● LIVE':'Playing';if(item.kind!=='live'&&resumeSeconds(item)>0)try{video.currentTime=resumeSeconds(item)}catch{}video.play().catch(()=>{})});video.addEventListener('timeupdate',()=>{if(item.kind!=='live'&&video.duration)updateContinueProgress(item,{timePos:video.currentTime,duration:video.duration,percentPos:video.currentTime/video.duration*100},false)});video.addEventListener('ended',()=>handlePlaybackFinished(item),{once:true});activeHls.on(Hls.Events.ERROR,(_,data)=>{if(!data?.fatal)return;const detail=data?.details?` (${data.details})`:'';setPlayerMessage(`The HLS stream could not be played${detail}. Many IPTV providers allow native apps but block browser HLS/CORS.`,true);try{activeHls?.destroy()}catch{}activeHls=null})}catch(err){setPlayerMessage(err.message||'Could not start HLS playback.',true)}return}if(/\.(mp4|webm|m4v)$/.test(lower)){video.src=url;video.addEventListener('loadedmetadata',()=>{const s=document.querySelector('#playerStatus');if(s)s.textContent='Playing';const resume=resumeSeconds(item);if(resume>0)try{video.currentTime=resume}catch{}},{once:true});video.addEventListener('timeupdate',()=>{if(video.duration)updateContinueProgress(item,{timePos:video.currentTime,duration:video.duration,percentPos:video.currentTime/video.duration*100},false)});video.addEventListener('ended',()=>handlePlaybackFinished(item),{once:true});video.addEventListener('error',()=>setPlayerMessage('The browser could not play this video file or codec.',true),{once:true});try{await video.play()}catch{}return}setPlayerMessage('This video container is not supported safely by the web player yet.',true)
}
async function play(item,{sourceSelected=false}={}){
  if(!item)return;
  if(nativeCatalogMode&&item._nativeLogicalKey){
    const resolved=await resolveNativeCatalogItem(item,{includeSources:true});
    if(resolved)item=resolved;
  }
  if(item.kind==='live'&&Array.isArray(item.sources)&&item.sources.length>1)item=preferredLiveSource(item);
  if(NATIVE_WINDOWS&&item.kind==='live'&&playerItem?.kind==='live'){await switchLiveChannel(item);return}
  if(item.kind==='movie'&&Array.isArray(item.sources)&&item.sources.length>1&&!sourceSelected){sourceChoiceItem=item;render();return}
  if(!item.streamUrl){
    toast(item.source==='demo'?'Demo item — connect your provider for playback.':item.kind==='series'?'Open the series to choose an episode.':'Swoop could not resolve a playable source for this title.');
    if(item.kind==='series')openDetail(item);
    return;
  }
  sourceChoiceItem=null;
  if(playerItem)await stopPlayback(true);
  rememberWatching(item);playerItem=item;playerUiHidden=false;render();requestAnimationFrame(()=>startPlayback(item));
}

function queueArtworkRelay(task){return new Promise((resolve,reject)=>{artworkRelayQueue.push({task,resolve,reject});pumpArtworkRelay()})}
function artworkRelayLimit(){return largeLibraryMode()?3:6}
function pumpArtworkRelay(){while(artworkRelayActive<artworkRelayLimit()&&artworkRelayQueue.length){const job=artworkRelayQueue.shift();artworkRelayActive++;Promise.resolve().then(job.task).then(job.resolve,job.reject).finally(()=>{artworkRelayActive--;pumpArtworkRelay()})}}
async function relayArtworkUrl(url){if(artworkCache.has(url))return artworkCache.get(url);const promise=queueArtworkRelay(async()=>{const blob=await fetchXtreamAssetBlob({relayUrl:sessionRelay.url,relayToken:sessionRelay.token},url);return URL.createObjectURL(blob)}).catch(err=>{artworkCache.delete(url);throw err});artworkCache.set(url,promise);return promise}
function canRelayArtwork(){return !NATIVE_WINDOWS&&Boolean(sessionRelay.url&&sessionRelay.token&&enabledProviders().some(p=>p.type==='xtream'))}
function optimizedArtworkUrl(url,img){const raw=String(url||'');if(!/image\.tmdb\.org\/t\/p\//i.test(raw))return raw;const cls=img?.className||'';let size='w500';if(/backdrop|hero-art|hero-backdrop|detail-backdrop/i.test(cls))size='w1280';else if(/title-logo/i.test(cls))size='w500';else if(/cast/i.test(cls))size='w185';else if(img?.closest?.('.poster, .poster-content-grid'))size='w342';return raw.replace(/\/t\/p\/(?:original|w\d+)\//i,`/t/p/${size}/`)}
function revealArtwork(img){const show=()=>img.classList.add('loaded');if(typeof img.decode==='function')img.decode().then(show).catch(show);else show()}
function loadArtwork(img){if(img.dataset.swoopLoaded==='1')return;img.dataset.swoopLoaded='1';const original=img.dataset.swoopArt||'';if(!original)return;const url=optimizedArtworkUrl(original,img);img.decoding='async';if(!/hero|detail-backdrop|title-logo/i.test(img.className||'')){img.loading='lazy';try{img.fetchPriority='low'}catch{}}const fallback=async()=>{if(!canRelayArtwork())return;try{img.onload=()=>revealArtwork(img);img.src=await relayArtworkUrl(original)}catch{img.removeAttribute('src')}};if(location.protocol==='https:'&&/^http:\/\//i.test(original)&&canRelayArtwork()){fallback();return}img.onload=()=>revealArtwork(img);img.onerror=()=>fallback();img.src=url}
function hydrateArtwork(root=document){const imgs=[...root.querySelectorAll('img[data-swoop-art]')].filter(img=>img.dataset.swoopLoaded!=='1');if(!imgs.length)return;if(!('IntersectionObserver'in window)){imgs.forEach(loadArtwork);return}if(!artworkObserver)artworkObserver=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){artworkObserver?.unobserve(entry.target);loadArtwork(entry.target)}},{rootMargin:largeLibraryMode()?'120px 0px':'280px 0px',threshold:.01});imgs.forEach(img=>artworkObserver.observe(img))}

let searchIndexKey='',searchIndexCache=[];
function searchIndex(){const key=`${activeCatalogContext}|${movieStackPriorityKey}|${liveStackPriorityKey}|${metadataRevision}`;if(searchIndexKey===key&&searchIndexCache.length)return searchIndexCache;const logical=[...items('movie'),...items('series'),...items('live')];searchIndexCache=logical.map(item=>({item,text:`${item.name||''} ${item.group||''} ${item.year||''}`.toLowerCase()}));searchIndexKey=key;return searchIndexCache}
async function runSearch(q){
  const out=document.querySelector('#searchResults');if(!out)return;const term=q.trim();
  if(nativeCatalogMode){
    out.innerHTML='<div class="native-query-loading"><span class="provider-spinner"></span><strong>Searching your local catalogue…</strong></div>';
    try{const result=await nativeCatalogSearch(term,{providerId:providerFilter,providerIds:providerFilter==='all'?nativeEnabledProviderIds():[],limit:80,kinds:['movie','series','live']}),res=cacheNativeItems(result?.items||[]);if(!document.querySelector('#searchResults'))return;out.innerHTML=res.length?res.map(x=>card(x,x.kind!=='live')).join(''):empty('No matches','Try another title, channel or category.');hydrateArtwork(out);bindDynamicCards(out)}catch(err){out.innerHTML=empty('Search unavailable',err.message||'Could not search the local catalogue.')}return;
  }
  const lower=term.toLowerCase();if(!lower){const starter=[...items('movie').slice(0,24),...items('series').slice(0,12)];out.innerHTML=starter.map(x=>card(x,x.kind!=='live')).join('');hydrateArtwork(out);bindDynamicCards(out);return}const res=[];for(const entry of searchIndex()){if(entry.text.includes(lower)){res.push(entry.item);if(res.length>=80)break}}out.innerHTML=res.length?res.map(x=>card(x,x.kind!=='live')).join(''):empty('No matches','Try another title, channel or category.');hydrateArtwork(out);bindDynamicCards(out)
}
function scheduleSearch(q){clearTimeout(searchDebounceTimer);searchDebounceTimer=setTimeout(()=>runSearch(q),largeLibraryMode()?180:60)}
function persist(bulk=false){syncActiveProfileFromState();const snapshot={...state,page:'home',favourites:state.myList};const localOk=saveState(snapshot);if(!bulk)return Promise.resolve(localOk);const saveCatalog=bulk===true||bulk==='catalog';return saveBulkState(snapshot,{catalog:saveCatalog}).then(bulkOk=>localOk&&bulkOk)}
function normalizeProviderPriorities(){state.providers.sort((a,b)=>Number(a.priority)-Number(b.priority));state.providers.forEach((p,i)=>p.priority=i);syncLegacyProvider();sessionXtream=providerConfigById(state.provider?.id)||{server:'',username:'',password:'',relayUrl:'',relayToken:''};resetMovieStackIndex()}
function upsertProviderRecord(record){const i=state.providers.findIndex(p=>p.id===record.id);const existing=i>=0?state.providers[i]:null;const next={...existing,...record,enabled:record.enabled!==false,priority:existing?.priority??state.providers.length,status:record.status||'connected',lastRefreshed:record.lastRefreshed||Date.now()};if(i>=0)state.providers[i]=next;else state.providers.push(next);normalizeProviderPriorities();return next}
function saveProviderCredentials(profile){const id=providerProfileId(profile);const next={...profile,id,savedAt:Date.now()};const i=savedProviderProfiles.findIndex(p=>providerProfileId(p)===id);if(i>=0)savedProviderProfiles[i]=next;else savedProviderProfiles.push(next);sessionProviderConfigs.set(id,next);saveProviderProfiles(savedProviderProfiles);savedProviderProfile=savedProviderProfiles[0]||null;return next}
function removeSavedProviderCredentials(id){savedProviderProfiles=savedProviderProfiles.filter(p=>providerProfileId(p)!==id);sessionProviderConfigs.delete(id);saveProviderProfiles(savedProviderProfiles);savedProviderProfile=savedProviderProfiles[0]||null}
function replaceProviderCatalog(providerId,newItems=[]){state.catalog=[...state.catalog.filter(x=>x.providerId!==providerId),...newItems];resetMovieStackIndex();syncProviderCounts();state.webDiscovery={};epgCache.clear();detailCache.clear()}
function providerStatusCopy(p){if(p.status==='error')return p.lastError||'Provider refresh failed';if(p.status==='refreshing')return'Updating provider catalog…';if(p.enabled===false)return'Provider is disabled';return p.lastRefreshed?`Last refreshed ${new Date(p.lastRefreshed).toLocaleString()}`:'Connected'}
async function refreshProvider(id,{quiet=false}={}){
  const p=providerById(id);if(!p)return false;const cfg=providerConfigById(id)||{};p.status='refreshing';p.lastError='';if(!quiet)render();
  try{
    let resultItems=[],counts={live:0,movie:0,series:0};
    if(p.type==='xtream'){
      if(!cfg.server||!cfg.username||!cfg.password)throw new Error('Saved Xtream login is required to refresh this provider.');
      const auth=await testXtream(cfg);if(String(auth?.user_info?.auth)==='0')throw new Error('Xtream account is not authorised.');
      const result=await importXtream(cfg,p.id);resultItems=result.items;counts=result.counts||counts;
    }else{
      if(!cfg.url&&!p.url)throw new Error('This M3U provider came from a local file and has no URL to refresh. Re-import the file to update it.');
      const url=cfg.url||p.url,text=NATIVE_WINDOWS?await nativeFetchText(url):await (await fetch(url,{cache:'no-store'})).text();resultItems=parseM3U(text,p.id);counts={live:resultItems.filter(x=>x.kind==='live').length,movie:resultItems.filter(x=>x.kind==='movie').length,series:resultItems.filter(x=>x.kind==='series').length};
    }
    if(!resultItems.length)throw new Error('Provider returned an empty catalog.');
    replaceProviderCatalog(p.id,resultItems);if(NATIVE_WINDOWS){await nativeCatalogReplaceProvider(p.id,resultItems);await activateNativeCatalogIfAvailable();}Object.assign(p,{status:'connected',lastRefreshed:Date.now(),lastError:'',counts});
    const saved=savedProviderProfiles.find(x=>providerProfileId(x)===p.id);if(saved){Object.assign(saved,{lastRefreshed:p.lastRefreshed,counts,name:p.name,enabled:p.enabled,priority:p.priority});saveProviderProfiles(savedProviderProfiles)}
    await persist(NATIVE_WINDOWS?'cache':true);if(!quiet){render();toast(`${p.name} refreshed`)}return true;
  }catch(err){p.status='error';p.lastError=err.message||String(err);await persist();if(!quiet){render();toast(`${p.name}: ${p.lastError}`)}return false}
}
async function refreshAllProviders(){const list=enabledProviders();if(!list.length){toast('No enabled providers to refresh');return}for(const p of list)await refreshProvider(p.id,{quiet:true});render();toast('Provider refresh finished')}
async function removeProvider(id){const p=providerById(id);if(!p)return;state.catalog=state.catalog.filter(x=>x.providerId!==id);if(NATIVE_WINDOWS){await nativeCatalogRemoveProvider(id).catch(()=>{});await refreshNativeCatalogStats();}state.providers=state.providers.filter(x=>x.id!==id);removeSavedProviderCredentials(id);normalizeProviderPriorities();syncProviderCounts();state.webDiscovery={};epgCache.clear();detailCache.clear();await persist(NATIVE_WINDOWS?'cache':true);if(nativeCatalogMode&&nativeCatalogStats?.rowCount)await activateNativeCatalogIfAvailable();render();toast(`${p.name} removed`)}
async function toggleProviderEnabled(id){const p=providerById(id);if(!p)return;p.enabled=p.enabled===false;normalizeProviderPriorities();const saved=savedProviderProfiles.find(x=>providerProfileId(x)===id);if(saved){saved.enabled=p.enabled;saveProviderProfiles(savedProviderProfiles)}if(nativeCatalogMode){for(const k of ['movie','series','live'])nativePageCache[k].key='';nativeHomeRowCache.clear();await activateNativeCatalogIfAvailable()}await persist();render();toast(`${p.name} ${p.enabled?'enabled':'disabled'}`)}
function moveProvider(id,delta){const list=state.providers.slice().sort((a,b)=>Number(a.priority)-Number(b.priority)),i=list.findIndex(p=>p.id===id),j=i+delta;if(i<0||j<0||j>=list.length)return;[list[i],list[j]]=[list[j],list[i]];state.providers=list;normalizeProviderPriorities();for(const p of savedProviderProfiles){const idx=state.providers.findIndex(x=>x.id===providerProfileId(p));if(idx>=0)p.priority=idx}saveProviderProfiles(savedProviderProfiles);persist();render()}
function providerFilterOptions(){return enabledProviders().map(p=>({id:p.id,name:p.name}))}
function itemHasProvider(item,id){if(!id||id==='all')return true;if(item.providerId===id)return true;return Array.isArray(item.sources)&&item.sources.some(s=>s.providerId===id)}
function providerFiltered(list){return providerFilter==='all'?list:list.filter(x=>itemHasProvider(x,providerFilter))}

function bindDynamicCards(root=document){
  hydrateVisibleImdbRatings(root);
  root.querySelectorAll('[data-play]').forEach(el=>{
    if(el.dataset.boundPlay)return;el.dataset.boundPlay='1';
    el.onclick=async()=>{
      if(el.dataset.playBusy==='1')return;
      el.dataset.playBusy='1';const original=el.innerHTML;el.classList.add('interaction-pending');
      if(el.classList.contains('detail-play'))el.innerHTML='▶ Opening…';
      try{
        const id=el.dataset.play;
        let item=(detailItem?.id===id?detailItem:null)||detailEpisodeItems.get(id)||savedItem(id);
        if(!item&&nativeCatalogMode){try{const result=await nativeCatalogGet([id]);item=cacheNativeItems(result?.items||[])[0]||null}catch{}}
        if(!item){toast('Swoop could not resolve this title.');return;}
        await play(item);
      }finally{
        if(document.contains(el)){el.dataset.playBusy='0';el.classList.remove('interaction-pending');el.innerHTML=original;}
      }
    }
  });
  root.querySelectorAll('[data-detail]').forEach(el=>{
    if(el.dataset.boundDetail)return;el.dataset.boundDetail='1';
    el.onclick=()=>{const item=savedItem(el.dataset.detail);if(item)openDetail(item);else toast('Opening title…')}
  })
}

function bind(){
  document.querySelectorAll('[data-profile-picker]').forEach(el=>el.onclick=()=>{syncActiveProfileFromState();persist();profilePickerOpen=true;modal=null;profileEditId='';render()});
  document.querySelectorAll('[data-profile-manage]').forEach(el=>el.onclick=()=>{profilePickerOpen=false;modal='profiles';render()});
  document.querySelectorAll('[data-profile-add]').forEach(el=>el.onclick=()=>{profilePickerOpen=false;profileEditId='';modal='profileEdit';render()});
  document.querySelectorAll('[data-profile-edit]').forEach(el=>el.onclick=()=>{profilePickerOpen=false;profileEditId=el.dataset.profileEdit||state.activeProfileId;modal='profileEdit';render()});
  document.querySelectorAll('[data-profile-select]').forEach(el=>el.onclick=()=>switchProfile(el.dataset.profileSelect));
  document.querySelectorAll('[data-profile-avatar]').forEach(el=>el.onclick=()=>{const value=el.dataset.profileAvatar,input=document.querySelector('#profileAvatarValue');if(input)input.value=value;document.querySelectorAll('[data-profile-avatar]').forEach(x=>x.classList.toggle('active',x===el))});
  document.querySelectorAll('[data-profile-theme]').forEach(el=>el.onclick=()=>{const value=themeById(el.dataset.profileTheme).id,input=document.querySelector('#profileThemeValue');if(input)input.value=value;document.querySelectorAll('[data-profile-theme]').forEach(x=>x.classList.toggle('active',x===el))});
  document.querySelector('[data-pin-cancel]')?.addEventListener('click',()=>{pendingProfileId='';profilePinError='';modal=null;profilePickerOpen=true;render()});
  document.querySelector('#profilePinForm')?.addEventListener('submit',async e=>{e.preventDefault();const target=state.profiles.find(p=>p.id===pendingProfileId),pin=String(new FormData(e.currentTarget).get('pin')||'');if(!target)return;const digest=await pinDigest(pin,target.pinSalt);if(digest!==target.pinHash){profilePinError='Incorrect PIN. Try again.';render();return}const id=target.id;pendingProfileId='';profilePinError='';await switchProfile(id,{skipPin:true})});
  document.querySelector('#profileForm')?.addEventListener('submit',async e=>{e.preventDefault();const fd=new FormData(e.currentTarget),id=String(fd.get('id')||''),existing=state.profiles.find(p=>p.id===id)||null,name=String(fd.get('name')||'Profile').trim(),avatar=String(fd.get('avatar')||'lion'),kids=Boolean(fd.get('kids')),smartHome=Boolean(fd.get('smartHome')),themeId=themeById(String(fd.get('themeId')||existing?.profileSettings?.themeId||'chill')).id,pin=String(fd.get('pin')||'').trim(),removePin=Boolean(fd.get('removePin'));if(!name){toast('Enter a profile name');return}if(pin&&!/^\d{4,8}$/.test(pin)){toast('Profile PIN must be 4–8 digits');return}if(existing?.id===state.activeProfileId)syncActiveProfileFromState();let next=existing?normalizeProfile(state.profiles.find(p=>p.id===id)||existing):makeProfile({name,avatar,kids,profileSettings:{themeId:'chill',backgroundColor:'#050505',backgroundOverride:false,movieSourcePreferences:{},homeRows:[...DEFAULT_HOME_ROWS],smartHomeOrder:true}});next={...next,name:name.slice(0,24),avatar:avatarById(avatar).id,kids,profileSettings:{...(next.profileSettings||{}),smartHomeOrder:smartHome,themeId}};if(kids){const rawById=x=>state.catalog.find(item=>item.id===x)||next.continueWatching.find(e=>e.id===x)?.item||next.watchHistory.find(e=>e.id===x)?.item||null;next.myList=next.myList.filter(id=>{const item=rawById(id);return !item||profileAllowsMedia(next,item,state.metadataCache?.[item.id]||{})});next.continueWatching=next.continueWatching.filter(e=>!e?.item||profileAllowsMedia(next,e.item,state.metadataCache?.[e.id]||{}));next.watchHistory=next.watchHistory.filter(e=>!e?.item||profileAllowsMedia(next,e.item,state.metadataCache?.[e.id]||{}));}if(removePin){next.pinHash='';next.pinSalt=''}else if(pin){next.pinSalt=randomSalt();next.pinHash=await pinDigest(pin,next.pinSalt)}if(existing){const i=state.profiles.findIndex(p=>p.id===existing.id);state.profiles[i]=next;if(existing.id===state.activeProfileId){applyProfileToState(next)}}else{state.profiles.push(next);state.activeProfileId=next.id;applyProfileToState(next)}profileEditId='';modal=null;profilePickerOpen=false;await persist();render();toast(existing?'Profile updated':`Welcome, ${next.name}`)});
  document.querySelectorAll('[data-profile-delete]').forEach(el=>el.onclick=async()=>{const id=el.dataset.profileDelete;if(state.profiles.length<=1){toast('Swoop needs at least one profile');return}const wasActive=id===state.activeProfileId;state.profiles=state.profiles.filter(p=>p.id!==id);if(wasActive){state.activeProfileId=state.profiles[0].id;applyProfileToState(state.profiles[0])}profileEditId='';modal='profiles';await persist();render();toast('Profile deleted')});
  document.querySelectorAll('[data-page]').forEach(el=>el.onclick=()=>{state.page=el.dataset.page;if(state.page==='guide')guideStart=Math.floor(Date.now()/1800000)*1800000;render()});
  document.querySelectorAll('[data-modal]').forEach(el=>el.onclick=()=>{modal=el.dataset.modal;render()});
  document.querySelectorAll('[data-close]').forEach(el=>el.onclick=()=>{modal=null;render()});
  document.querySelectorAll('[data-close-modal]').forEach(el=>el.onclick=e=>{if(e.target===el){modal=null;render()}});
  bindDynamicCards(document);
  document.querySelectorAll('[data-source-close]').forEach(el=>el.onclick=()=>{sourceChoiceItem=null;render()});
  document.querySelectorAll('[data-source-play]').forEach(el=>el.onclick=()=>{const logical=sourceChoiceItem,source=logical?.sources?.find(x=>x.id===el.dataset.sourcePlay);if(logical&&source){rememberMovieSourcePreference(logical,source.id);play(playableFromSource(logical,source),{sourceSelected:true})}});
  document.querySelectorAll('[data-source-best]').forEach(el=>el.onclick=()=>{const logical=sourceChoiceItem,source=logical?.sources?.find(x=>x.id===el.dataset.sourceBest);if(logical&&source){rememberMovieSourcePreference(logical,source.id);play(playableFromSource(logical,source),{sourceSelected:true})}});
  document.querySelectorAll('[data-detail-close]').forEach(el=>el.onclick=closeDetail);
  document.querySelectorAll('[data-toggle-list]').forEach(el=>el.onclick=()=>toggleMyList(savedItem(el.dataset.toggleList)||detailItem));
  document.querySelectorAll('[data-toggle-watched]').forEach(el=>el.onclick=()=>toggleWatched(savedItem(el.dataset.toggleWatched)||detailItem));
  document.querySelectorAll('[data-season]').forEach(el=>el.onclick=()=>{detailSeason=el.dataset.season;render()});
  document.querySelectorAll('[data-close-player]').forEach(el=>el.onclick=()=>{if(playerItem?.kind==='live'){playerUiHidden=true;state.page='live';render()}else closePlayer()});
  document.querySelectorAll('[data-live-controls]').forEach(el=>el.onclick=()=>{playerUiHidden=false;render()});
  document.querySelectorAll('[data-live-stop]').forEach(el=>el.onclick=()=>closePlayer());
  document.querySelectorAll('[data-native-stop]').forEach(el=>el.onclick=async()=>{try{const result=await nativeStop();stopPlaybackMonitor();if(playerItem?.kind!=='live')updateContinueProgress(playerItem,result?.playback,true);const status=document.querySelector('#playerStatus');if(status)status.textContent='Playback stopped'}catch{}});
  document.querySelectorAll('[data-native-control]').forEach(el=>el.onclick=async()=>{try{const result=await nativeControl(el.dataset.nativeControl,el.dataset.nativeValue!==undefined?Number(el.dataset.nativeValue):null);updatePlayerProgressUi(result?.playback)}catch(err){toast(err.message||'Player control failed')}});
  document.querySelectorAll('[data-channel-step]').forEach(el=>el.onclick=()=>{const next=adjacentLive(playerItem,Number(el.dataset.channelStep||1));if(next)switchLiveChannel(next)});
  document.querySelectorAll('[data-mini-channel]').forEach(el=>el.onclick=()=>{const next=savedItem(el.dataset.miniChannel);if(next)switchLiveChannel(next)});
  document.querySelectorAll('[data-live-favourite]').forEach(el=>el.onclick=()=>{const item=savedItem(el.dataset.liveFavourite)||playerItem;if(item)toggleLiveFavourite(item)});
  document.querySelectorAll('[data-live-category]').forEach(el=>el.onclick=()=>{liveCategory=el.dataset.liveCategory||'';viewLimits.live=96;if(nativeCatalogMode)nativePageCache.live.key='';render()});
  document.querySelectorAll('[data-player-guide]').forEach(el=>el.onclick=async()=>{if(playerItem?.kind==='live'){playerUiHidden=true;state.page='guide';render()}else{await closePlayer();state.page='guide';render()}});
  document.querySelectorAll('[data-trailer]').forEach(el=>el.onclick=()=>{trailerKey=el.dataset.trailer||'';trailerTitle=el.dataset.trailerTitle||detailItem?.name||'Trailer';render()});
  document.querySelectorAll('[data-trailer-close]').forEach(el=>el.onclick=()=>{trailerKey='';trailerTitle='';render()});
  document.querySelectorAll('[data-load-more]').forEach(el=>el.onclick=()=>{const kind=el.dataset.loadMore;viewLimits[kind]=(viewLimits[kind]||(kind==='live'?96:72))+(kind==='live'?96:72);if(nativeCatalogMode&&nativePageCache[kind])nativePageCache[kind].key='';render()});
  document.querySelectorAll('[data-search-term]').forEach(el=>el.onclick=()=>{state.page='search';render();const input=document.querySelector('#searchInput');if(input){input.value=el.dataset.searchTerm;runSearch(input.value)}});document.querySelectorAll('[data-page-category]').forEach(el=>el.onclick=()=>{const kind=el.dataset.pageCategory,group=el.dataset.pageGroup||'';if(nativeCatalogMode&&['movie','series'].includes(kind)){pageCategory[kind]=group;viewLimits[kind]=72;nativePageCache[kind].key='';render()}else{state.page='search';render();const input=document.querySelector('#searchInput');if(input){input.value=group;runSearch(group)}}});
  document.querySelector('[data-guide-now]')?.addEventListener('click',()=>{guideStart=Math.floor(Date.now()/1800000)*1800000;render()});
  document.querySelector('[data-guide-more]')?.addEventListener('click',()=>{guideLimit+=24;m3uGuideLoaded=false;m3uGuideLoadedProviders.clear();render()});
  document.querySelectorAll('[data-provider-filter]').forEach(el=>el.onclick=()=>{providerFilter=el.dataset.providerFilter||'all';viewLimits.live=96;viewLimits.movie=72;viewLimits.series=72;if(nativeCatalogMode)for(const k of ['live','movie','series'])nativePageCache[k].key='';render()});
  document.querySelectorAll('[data-provider-toggle]').forEach(el=>el.onclick=()=>toggleProviderEnabled(el.dataset.providerToggle));
  document.querySelectorAll('[data-provider-refresh]').forEach(el=>el.onclick=()=>refreshProvider(el.dataset.providerRefresh));
  document.querySelectorAll('[data-provider-edit]').forEach(el=>el.onclick=()=>{const id=el.dataset.providerEdit,p=providerById(id),cfg=providerConfigById(id)||p;if(!p)return;const tab=document.querySelector(`[data-provider-tab="${p.type}"]`);tab?.click();const form=document.querySelector(p.type==='xtream'?'#xtreamForm':'#m3uForm');if(!form)return;const set=(name,value)=>{const input=form.querySelector(`[name="${name}"]`);if(input)input.value=value||''};set('name',p.name);if(p.type==='xtream'){set('server',cfg.server||p.server);set('username',cfg.username||'');set('password',cfg.password||'');set('relayUrl',cfg.relayUrl||p.relayUrl||'');set('relayToken',cfg.relayToken||'')}else{set('url',cfg.url||p.url||'');set('epgUrl',cfg.epgUrl||p.epgUrl||'')}form.scrollIntoView({behavior:'smooth',block:'start'});toast(`Editing ${p.name}`)});
  document.querySelectorAll('[data-provider-remove]').forEach(el=>el.onclick=()=>removeProvider(el.dataset.providerRemove));
  document.querySelectorAll('[data-provider-up]').forEach(el=>el.onclick=()=>moveProvider(el.dataset.providerUp,-1));
  document.querySelectorAll('[data-provider-down]').forEach(el=>el.onclick=()=>moveProvider(el.dataset.providerDown,1));
  document.querySelectorAll('[data-provider-refresh-all]').forEach(el=>el.onclick=()=>refreshAllProviders());
  document.querySelector('[data-action="clear-history"]')?.addEventListener('click',()=>{state.continueWatching=[];persist();render();toast('Continue Watching cleared')});
  document.querySelector('[data-action="clear-viewing"]')?.addEventListener('click',()=>{state.watchHistory=[];persist();render();toast('Recommendation history reset')});
  document.querySelector('[data-action="clear-source-preferences"]')?.addEventListener('click',()=>{state.settings.movieSourcePreferences={};persist();render();toast('Remembered movie source choices cleared')});
  document.querySelector('[data-action="clear-live-favourites"]')?.addEventListener('click',()=>{state.liveFavourites=[];persist();render();toast('Favourite channels cleared')});
  document.querySelectorAll('[data-remove-row]').forEach(el=>el.onclick=()=>{const row=state.mdblistRows[Number(el.dataset.removeRow)];if(row)state.settings.homeRows=state.settings.homeRows.filter(id=>id!==`custom:${row.uid}`);state.mdblistRows.splice(Number(el.dataset.removeRow),1);persist('cache');render()});
  const search=document.querySelector('#searchInput');if(search)search.oninput=e=>scheduleSearch(e.target.value);
  document.querySelectorAll('[data-provider-tab]').forEach(el=>el.onclick=()=>{document.querySelectorAll('[data-provider-tab]').forEach(x=>x.classList.toggle('active',x===el));document.querySelector('#m3uForm').hidden=el.dataset.providerTab!=='m3u';document.querySelector('#xtreamForm').hidden=el.dataset.providerTab!=='xtream';document.querySelector('#providerStatus').innerHTML=''});
  document.querySelector('[data-provider-progress-back]')?.addEventListener('click',providerProgressBack);
  document.querySelector('#homeDiscoveryForm')?.addEventListener('submit',async e=>{e.preventDefault();const fd=new FormData(e.currentTarget),key=String(fd.get('apiKey')||'').trim();state.settings.mdblistApiKey=key;persist();toast(key?'Custom MDBList key saved':'Custom MDBList key cleared');await refreshDiscoveryRows(true)});
  const bgPicker=document.querySelector('#homeBgColor'),bgHex=document.querySelector('#homeBgHex');
  const setBg=value=>{const c=validHex(value);state.settings.backgroundColor=c;state.settings.backgroundOverride=true;if(bgPicker){bgPicker.value=c;bgPicker.disabled=false}if(bgHex){bgHex.value=c;bgHex.disabled=false}applyTheme();persist()};
  if(bgPicker)bgPicker.oninput=e=>setBg(e.target.value);
  if(bgHex)bgHex.onchange=e=>setBg(e.target.value);
  document.querySelectorAll('[data-active-theme]').forEach(el=>el.onclick=()=>{const t=themeById(el.dataset.activeTheme);state.settings.themeId=t.id;if(!state.settings.backgroundOverride)state.settings.backgroundColor=t.bg;applyTheme();persist();render();toast(`${t.name} theme applied to ${activeProfile()?.name||'this profile'}`)});
  document.querySelector('[data-bg-override]')?.addEventListener('change',e=>{const enable=Boolean(e.target.checked);if(enable&&!state.settings.backgroundOverride)state.settings.backgroundColor=currentTheme().bg;state.settings.backgroundOverride=enable;applyTheme();persist();render()});
  document.querySelector('[data-bg-reset]')?.addEventListener('click',()=>{state.settings.backgroundOverride=false;state.settings.backgroundColor=currentTheme().bg;applyTheme();persist();render();toast(`${currentTheme().name} background restored`)});
  document.querySelector('[data-refresh-discovery]')?.addEventListener('click',()=>refreshDiscoveryRows(true));
  document.querySelector('[data-smart-home-toggle]')?.addEventListener('change',e=>{state.settings.smartHomeOrder=Boolean(e.target.checked);persist();render();toast(state.settings.smartHomeOrder?'Smart Home ordering enabled':'Smart Home ordering disabled')});
  document.querySelectorAll('[data-performance-mode]').forEach(el=>el.onclick=()=>{state.settings.performanceMode=el.dataset.performanceMode||'auto';persist();render();toast(state.settings.performanceMode==='cinematic'?'Full cinematic rendering enabled':'Automatic performance mode enabled')});
  document.querySelectorAll('[data-home-toggle]').forEach(el=>el.onclick=()=>{const id=el.dataset.homeToggle;if(PINNED_HOME_ROWS.includes(id))return;const index=state.settings.homeRows.indexOf(id);if(index>=0)state.settings.homeRows.splice(index,1);else state.settings.homeRows.push(id);state.settings.homeRows=normalizeHomeRows(state.settings.homeRows);persist();render()});
  document.querySelectorAll('[data-home-up]').forEach(el=>el.onclick=()=>{const id=el.dataset.homeUp,i=state.settings.homeRows.indexOf(id);if(i>PINNED_HOME_ROWS.length){[state.settings.homeRows[i-1],state.settings.homeRows[i]]=[state.settings.homeRows[i],state.settings.homeRows[i-1]];state.settings.homeRows=normalizeHomeRows(state.settings.homeRows);persist();render()}});
  document.querySelectorAll('[data-home-down]').forEach(el=>el.onclick=()=>{const id=el.dataset.homeDown,i=state.settings.homeRows.indexOf(id);if(!PINNED_HOME_ROWS.includes(id)&&i>=PINNED_HOME_ROWS.length&&i<state.settings.homeRows.length-1){[state.settings.homeRows[i+1],state.settings.homeRows[i]]=[state.settings.homeRows[i],state.settings.homeRows[i+1]];state.settings.homeRows=normalizeHomeRows(state.settings.homeRows);persist();render()}});
  document.querySelector('[data-reset-home]')?.addEventListener('click',()=>{state.settings.homeRows=normalizeHomeRows([...DEFAULT_HOME_ROWS,...state.mdblistRows.map(r=>`custom:${r.uid}`)]);persist();render();toast('Home rows reset')});
  document.querySelector('#m3uForm')?.addEventListener('submit',async e=>{e.preventDefault();const fd=new FormData(e.currentTarget),file=fd.get('file'),url=String(fd.get('url')||'').trim(),name=String(fd.get('name')||'M3U Provider').trim()||'M3U Provider',epgUrl=String(fd.get('epgUrl')||'').trim(),remember=Boolean(fd.get('remember'));providerProgressStart('m3u',name);try{providerProgressUpdate({step:'read',progress:12,title:`Reading ${name}…`,detail:file&&file.size?'Swoop is reading the M3U file from this device.':'Swoop is downloading this provider playlist.'});let text;if(file&&file.size)text=await file.text();else if(url){if(NATIVE_WINDOWS)text=await nativeFetchText(url);else{const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw new Error(`Playlist returned HTTP ${r.status}`);text=await r.text()}}else throw new Error('Choose an M3U file or enter a playlist URL.');providerProgressMark('read','Complete');providerProgressUpdate({step:'parse',progress:55,title:'Parsing channels…',detail:'Swoop is reading channel names, groups, logos and stream addresses.'});await new Promise(r=>setTimeout(r,40));const providerId=`m3u-${Math.abs(hash(`${url||name}`))}`,cat=parseM3U(text,providerId);if(!cat.length)throw new Error('No playable entries were found in that M3U playlist.');providerProgressMark('parse',`${cat.length.toLocaleString()} items`);providerProgressUpdate({step:'save',progress:86,title:'Adding provider to your unified library…',detail:`Merging ${cat.length.toLocaleString()} items without replacing your other providers.`});const counts={live:cat.filter(x=>x.kind==='live').length,movie:cat.filter(x=>x.kind==='movie').length,series:cat.filter(x=>x.kind==='series').length};replaceProviderCatalog(providerId,cat);if(NATIVE_WINDOWS){providerProgressUpdate({step:'save',progress:91,title:'Indexing local catalogue…',detail:'Swoop is writing this provider into SQLite so future browsing only loads the rows you need.'});await nativeCatalogReplaceProvider(providerId,cat,{onProgress:info=>providerProgressUpdate({step:'save',progress:91+Math.round((info.loaded/Math.max(1,info.total))*6),stepDetail:`${info.loaded.toLocaleString()} / ${info.total.toLocaleString()} indexed`})});await activateNativeCatalogIfAvailable();}upsertProviderRecord({id:providerId,type:'m3u',name,url,epgUrl,enabled:true,status:'connected',lastRefreshed:Date.now(),counts});if(remember&&url)saveProviderCredentials({id:providerId,type:'m3u',name,url,epgUrl,enabled:true,priority:providerById(providerId)?.priority??state.providers.length-1,lastRefreshed:Date.now(),counts});else if(url)sessionProviderConfigs.set(providerId,{id:providerId,type:'m3u',name,url,epgUrl});state.mdblistRows.forEach(r=>{r.items=[];r.updatedAt=0;r.error=''});state.webDiscovery={};m3uGuideLoaded=false;await persist(NATIVE_WINDOWS?'cache':true);providerProgressMark('save','Ready');providerProgressSuccess(`${name} added · ${counts.live.toLocaleString()} live · ${counts.movie.toLocaleString()} movies · ${counts.series.toLocaleString()} shows`);setTimeout(()=>{modal=null;state.page='home';render()},1000)}catch(err){providerProgressError(err.message||String(err))}});
  document.querySelector('#xtreamForm')?.addEventListener('submit',async e=>{e.preventDefault();const fd=new FormData(e.currentTarget),relayUrl=String(fd.get('relayUrl')||'').trim(),relayToken=String(fd.get('relayToken')||''),name=String(fd.get('name')||'Xtream Provider').trim()||'Xtream Provider',cfg={server:String(fd.get('server')).trim(),username:String(fd.get('username')),password:String(fd.get('password')),relayUrl,relayToken};providerProgressStart('xtream',name);try{providerProgressUpdate({step:'contact',progress:7,title:`Contacting ${name}…`,detail:NATIVE_WINDOWS?'Using the Windows Native Bridge to reach this Xtream server.':relayUrl?'Using the Swoop Connection Helper for this provider.':'Connecting directly to this Xtream server.'});const profile=await testXtream(cfg);providerProgressMark('contact','Reached');providerProgressUpdate({step:'auth',progress:18,title:'Verifying your Xtream login…',detail:'Checking that the account is active and authorised.'});if(String(profile?.user_info?.auth)==='0')throw new Error('Xtream account was not authorised.');providerProgressMark('auth','Authorised');providerProgressUpdate({step:'live',progress:26,title:'Loading this provider library…',detail:'Live TV, Movies and TV Shows are loading. Your existing providers remain available.'});const providerId=`xtream-${Math.abs(hash(`${cfg.server}|${cfg.username}`))}`,completedSections=new Set();const result=await importXtream(cfg,providerId,info=>{if(info?.section){completedSections.add(info.section);providerProgressMark(info.section,`${Number(info.count||0).toLocaleString()} items`);const next=['live','movie','series'].find(x=>!completedSections.has(x))||'save',progress=next==='live'?30:next==='movie'?47:next==='series'?64:80,nextLabel=next==='live'?'Live TV':next==='movie'?'Movies':next==='series'?'TV Shows':'your unified Swoop library';providerProgressUpdate({step:next,progress,title:next==='save'?'Provider catalog loaded — merging into Swoop…':`Loading ${nextLabel}…`,detail:next==='save'?'Swoop is adding this provider without removing your existing library.':'The remaining sections are still loading.'})}});if(!result.items.length)throw new Error('Connected, but the provider returned an empty catalog.');providerProgressUpdate({step:'save',progress:88,title:'Adding provider to your unified library…',detail:'Swoop is saving this source, rebuilding duplicate stacks and refreshing discovery.'});const remember=Boolean(fd.get('remember')),counts=result.counts||{live:result.items.filter(x=>x.kind==='live').length,movie:result.items.filter(x=>x.kind==='movie').length,series:result.items.filter(x=>x.kind==='series').length};replaceProviderCatalog(providerId,result.items);if(NATIVE_WINDOWS){providerProgressUpdate({step:'save',progress:90,title:'Indexing local catalogue…',detail:'Swoop is writing this provider into SQLite so the UI never needs the whole library in memory again.'});await nativeCatalogReplaceProvider(providerId,result.items,{onProgress:info=>providerProgressUpdate({step:'save',progress:90+Math.round((info.loaded/Math.max(1,info.total))*7),stepDetail:`${info.loaded.toLocaleString()} / ${info.total.toLocaleString()} indexed`})});await activateNativeCatalogIfAvailable();}upsertProviderRecord({id:providerId,type:'xtream',name,server:cfg.server,connection:NATIVE_WINDOWS?'windows-native':relayUrl?'helper':'direct',relayUrl,enabled:true,status:'connected',lastRefreshed:Date.now(),counts});sessionProviderConfigs.set(providerId,{...cfg,id:providerId,type:'xtream',name});if(remember)saveProviderCredentials({id:providerId,type:'xtream',name,...cfg,enabled:true,priority:providerById(providerId)?.priority??state.providers.length-1,lastRefreshed:Date.now(),counts});state.settings.xtreamRelayUrl=relayUrl||state.settings.xtreamRelayUrl;state.settings.xtreamRelayToken=remember&&relayToken?relayToken:state.settings.xtreamRelayToken;state.mdblistRows.forEach(r=>{r.items=[];r.updatedAt=0;r.error=''});state.webDiscovery={};await persist(NATIVE_WINDOWS?'cache':true);providerProgressMark('save','Ready');providerProgressSuccess(`${name} added · ${counts.live.toLocaleString()} live · ${counts.movie.toLocaleString()} movies · ${counts.series.toLocaleString()} shows`);setTimeout(()=>{modal=null;state.page='home';render()},1100)}catch(err){providerProgressError(err.message||String(err))}});
  document.querySelector('#mdblistForm')?.addEventListener('submit',async e=>{e.preventDefault();if(!state.catalog.length){setStatus('#mdbStatus','Import an IPTV catalog first so Swoop TV has something to match against.','err');return}const fd=new FormData(e.currentTarget),apiKey=String(fd.get('apiKey')||'').trim();try{setStatus('#mdbStatus','Fetching MDBList and matching it against your provider catalog…');const payload=await getMDBListItems({apiKey,listId:String(fd.get('listId')||'').trim(),username:String(fd.get('username')||'').trim(),listName:String(fd.get('listName')||'').trim()});const matched=nativeCatalogMode?[...cacheNativeItems((await nativeCatalogMatchPayload(payload,'movie',{sourceLimit:300,limit:150,providerIds:nativeEnabledProviderIds()})).items||[]),...cacheNativeItems((await nativeCatalogMatchPayload(payload,'show',{sourceLimit:300,limit:150,providerIds:nativeEnabledProviderIds()})).items||[])]:matchMDBListToCatalog(payload,activeCatalog());state.settings.mdblistApiKey=apiKey;const uid=`mdb-${Date.now()}-${Math.abs(hash(String(fd.get('rowName')||'MDBList')))%10000}`;const source={listId:String(fd.get('listId')||'').trim(),username:String(fd.get('username')||'').trim(),listName:String(fd.get('listName')||'').trim()};state.mdblistRows.push({uid,name:String(fd.get('rowName')||'MDBList'),items:matched,source,updatedAt:Date.now(),error:''});state.settings.homeRows.push(`custom:${uid}`);persist('cache');setStatus('#mdbStatus',`Matched ${matched.length} titles from this MDBList to your provider catalog. It is now enabled on Home and will refresh automatically.`,'ok');setTimeout(()=>{modal=null;state.page='home';render()},650)}catch(err){setStatus('#mdbStatus',err.message||String(err),'err')}});
}

window.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&trailerKey){trailerKey='';trailerTitle='';render();return}
  if(e.key==='Escape'&&playerItem){if(playerItem.kind==='live'&&!playerUiHidden){playerUiHidden=true;render()}else closePlayer();return}
  if(e.key==='Escape'&&sourceChoiceItem){sourceChoiceItem=null;render();return}
  if(e.key==='Escape'&&detailItem){closeDetail();return}
  if(e.key==='Escape'&&modal){modal=null;render();return}
  if(playerItem?.kind==='live'&&!['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName)){
    if(e.key==='PageUp'||e.key==='PageDown'){e.preventDefault();const next=adjacentLive(playerItem,e.key==='PageUp'?-1:1);if(next)switchLiveChannel(next);return}
    if(/^\d$/.test(e.key)){
      e.preventDefault();channelNumberBuffer=(channelNumberBuffer+e.key).slice(-4);const indicator=document.querySelector('#liveChannelNumber');if(indicator)indicator.textContent=`Channel ${channelNumberBuffer}`;
      if(channelNumberTimer)clearTimeout(channelNumberTimer);channelNumberTimer=setTimeout(()=>{const n=Number(channelNumberBuffer),next=items('live')[n-1];channelNumberBuffer='';if(indicator)indicator.textContent='';if(next)switchLiveChannel(next);else toast(`Channel ${n} is not available`)},800);return;
    }
  }
  if((e.key==='ArrowRight'||e.key==='ArrowLeft'||e.key==='ArrowDown'||e.key==='ArrowUp')&&!['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName)){const focusables=[...document.querySelectorAll('button:not([hidden]),[tabindex="0"]')].filter(x=>x.offsetParent!==null);const i=focusables.indexOf(document.activeElement);if(i>=0){e.preventDefault();focusables[(i+(e.key==='ArrowRight'||e.key==='ArrowDown'?1:-1)+focusables.length)%focusables.length].focus()}}
});
if(!NATIVE_WINDOWS&&'serviceWorker'in navigator&&location.protocol.startsWith('http'))navigator.serviceWorker.register('./sw.js').catch(()=>{});

async function restoreDurableLibrary(){
  if(libraryRestored||state.catalog.length){libraryRestored=true;return true}
  const bulk=await loadBulkState({onProgress:updateRestoreProgress});
  if(!bulk){libraryRestored=true;return false}
  if(Array.isArray(bulk.catalog)){state.catalog=bulk.catalog;resetMovieStackIndex();}
  if(bulk.webDiscovery&&typeof bulk.webDiscovery==='object')state.webDiscovery=bulk.webDiscovery;
  if(!invalidateMetadataArtwork&&bulk.metadataCache&&typeof bulk.metadataCache==='object')state.metadataCache=bulk.metadataCache;else if(invalidateMetadataArtwork||bulk.droppedLegacyMetadata)state.metadataCache={};metadataRevision++;
  if(Array.isArray(bulk.mdblistRows)&&bulk.mdblistRows.length){const compact=new Map((state.mdblistRows||[]).map(r=>[r.uid,r]));state.mdblistRows=bulk.mdblistRows.map(r=>({...compact.get(r.uid),...r}));}
  syncProviderCounts();normalizeProviderPriorities();
  sessionRelay={url:state.settings.xtreamRelayUrl||state.provider?.relayUrl||savedProviderProfile?.relayUrl||'',token:state.settings.xtreamRelayToken||state.provider?.relayToken||savedProviderProfile?.relayToken||''};
  sessionXtream=providerConfigById(state.provider?.id)||{server:'',username:'',password:'',relayUrl:'',relayToken:''};
  if(bulk.legacy&&!NATIVE_WINDOWS)await persist('catalog');
  if(NATIVE_WINDOWS&&state.catalog.length){
    updateRestoreProgress({phase:'sqlite',loaded:0,total:state.catalog.length,items:0});
    await migrateCatalogToNative();
    await activateNativeCatalogIfAvailable();
    await retireBrowserCatalog();
  }
  libraryRestored=true;
  return true;
}
async function ensureDurableLibraryRestored(){
  if(libraryRestored||state.catalog.length){libraryRestored=true;storageRestoring=false;return true}
  if(libraryRestorePromise)return libraryRestorePromise;
  libraryRestorePromise=(async()=>{try{return await restoreDurableLibrary()}finally{storageRestoring=false;libraryRestorePromise=null}})();
  return libraryRestorePromise;
}

render();
