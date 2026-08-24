import fs from 'node:fs';
import {parseM3U} from './src/m3u.js';
import {matchMDBListToCatalog, normalizeMediaTitle, getMDBListOfficialItems, getMDBListStreamingChart} from './src/mdblist.js';
import {buildXtreamApiUrl, buildXtreamSeriesStreamUrl, testXtream, importXtream, fetchXtreamAssetBlob, fetchXtreamVodInfo, fetchXtreamShortEpg, fetchXtreamSimpleEpg, fetchXtreamLiveCategories, buildXtreamXmltvUrl} from './src/xtream.js';
import worker from './cloudflare-worker/worker.js';
import {buildMovieStackIndex, collapseMovieSources, cleanDisplayTitle, rankSources, sourceTraits} from './src/sourceStack.js';
import {makeProfile, normalizeProfile, profileAllowsMedia, profileGenreAffinity, smartRankRows} from './src/profiles.js';
import {buildLiveStackIndex, selectLiveSource} from './src/liveStack.js';
import {SWOOP_THEMES, themeById} from './src/themes.js';
import {prepareNativeCatalogItems} from './src/nativeCatalog.js';
import {fetchTitleMetadata, fetchTitleImdbRating, fetchPersonCredits, metadataIdentityMatches} from './src/tmdb.js';

function assert(condition, message){if(!condition) throw new Error(message)}

const sample=`#EXTM3U\n#EXTINF:-1 tvg-id="abc" group-title="Sports",Arena Sports\nhttps://example.com/live/1.m3u8\n#EXTINF:-1 group-title="Movies",Signal Run\nhttps://example.com/movie/2.mp4`;
const items=parseM3U(sample,'test');
assert(items.length===2,'M3U count failed');
assert(items[0].kind==='live'&&items[1].kind==='movie','M3U kind failed');

const catalog=[{id:'m1',kind:'movie',name:'Signal Run',year:'2026',tmdbId:'42'}];
const matches=matchMDBListToCatalog([{title:'Signal Run',year:2026,tmdb:42}],catalog);
assert(matches.length===1&&matches[0].id==='m1','MDBList match failed');


const messyCatalog=[{id:'m2',kind:'movie',name:'TOP - Michael (2026)',year:'2026'}];
const messyMatch=matchMDBListToCatalog([{title:'Michael',year:2026,tmdb:123}],messyCatalog,{mediaType:'movie',limit:20});
assert(messyMatch.length===1&&messyMatch[0].id==='m2','IPTV-prefixed title matching failed');
assert(normalizeMediaTitle('EN - 4K - The Example (2025)')==='the example','IPTV title cleanup failed');


// v0.7.20 ranked discovery must obey exact release identity and be able to fill a 100-title rail.
const odysseyCatalog=[{id:'ody25',kind:'movie',name:'Odyssey (2025)',year:'2025'}];
assert(matchMDBListToCatalog([{title:'The Odyssey',year:2026,tmdb:999}],odysseyCatalog,{mediaType:'movie',limit:100}).length===0,'Discovery matching must not substitute Odyssey (2025) for The Odyssey (2026)');
assert(matchMDBListToCatalog([{title:'Odyssey',year:2025,tmdb:998}],odysseyCatalog,{mediaType:'movie',limit:100}).length===1,'Exact title/year discovery match should still resolve');
assert(!odysseyCatalog[0].tmdbId,'Discovery matching must not write external IDs onto provider catalogue items');
const deepCatalog=Array.from({length:140},(_,i)=>({id:`deep-${i+1}`,kind:'movie',name:`Deep Ranked ${i+1} (2026)`,year:'2026'}));
const deepPayload=Array.from({length:180},(_,i)=>({title:`Deep Ranked ${i+1}`,year:2026,tmdb:10000+i}));
assert(matchMDBListToCatalog(deepPayload,deepCatalog,{mediaType:'movie',sourceLimit:600,limit:100}).length===100,'Deep ranked matching must be able to fill a 100-title rail');



// Built-in web discovery endpoints + order-preserving matching.
let discoveryUrl='';
const discoveryRealFetch=globalThis.fetch;
globalThis.fetch=async url=>{discoveryUrl=String(url);return new Response(JSON.stringify([{title:'Signal Run',year:2026,tmdb:42}]),{status:200,headers:{'content-type':'application/json'}})};
const officialPayload=await getMDBListOfficialItems({apiKey:'test-key',slug:'movies/popular'});
assert(discoveryUrl.includes('/lists/official/movies/popular/items')&&discoveryUrl.includes('apikey=test-key'),'MDBList official ranked-discovery endpoint failed');
assert(matchMDBListToCatalog(officialPayload,catalog,{sourceLimit:20,limit:20}).length===1,'MDBList official matching failed');
const chartPayload=await getMDBListStreamingChart({apiKey:'test-key',mediaType:'show'});
assert(discoveryUrl.includes('/justwatch/streaming-charts/show'),'MDBList JustWatch show chart endpoint failed');
assert(Array.isArray(chartPayload),'MDBList streaming chart payload failed');
globalThis.fetch=discoveryRealFetch;


// Confident multi-source movie stacking.
const duplicateCatalog=[
  {id:'br-amz',kind:'movie',name:'AMZ - Blade Runner 2049 (2017)',year:'2017',logo:'https://img.example/br2049.jpg',streamUrl:'http://one/movie.mp4',group:'Popular Movies 4K'},
  {id:'br-nf',kind:'movie',name:'NF - Blade Runner 2049 (2017)',year:'2017',logo:'https://img.example/br2049.jpg',streamUrl:'http://two/movie.mp4',group:'Popular Movies'},
  {id:'br-en',kind:'movie',name:'EN - Blade Runner 2049 (2017)',year:'2017',logo:'https://img.example/br2049.jpg',streamUrl:'http://three/movie.mp4',group:'English Movies'},
  {id:'br-old',kind:'movie',name:'EN - Blade Runner (1982)',year:'1982',logo:'https://img.example/br1982.jpg',streamUrl:'http://four/movie.mp4',group:'English Movies'}
];
const stackIndex=buildMovieStackIndex(duplicateCatalog);
assert(stackIndex.stacked.length===2,'Movie source stacking should collapse three confident duplicates into one title');
const brStack=stackIndex.bySourceId.get('br-amz');
assert(brStack?._stacked&&brStack.sourceCount===3,'Stacked movie source count failed');
assert(brStack.name==='Blade Runner 2049','Stacked movie clean title failed');
assert(stackIndex.bySourceId.get('br-old').id==='br-old','Different release year must not be stacked');
assert(collapseMovieSources(duplicateCatalog,duplicateCatalog).length===2,'Collapsed display list failed');
assert(cleanDisplayTitle({name:'NF - Blade Runner 2049 (2017)'})==='Blade Runner 2049','Source-prefix display cleanup failed');
assert(cleanDisplayTitle({name:'Lioness (2023) (US)'})==='Lioness','TV series year/market suffix display cleanup failed');
assert(cleanDisplayTitle({name:'-MAX - Lanterns'})==='Lanterns','Leading-ornament Max prefix cleanup failed');
assert(cleanDisplayTitle({name:'-AMZ - Reacher'})==='Reacher','Leading-ornament Amazon prefix cleanup failed');
assert(cleanDisplayTitle({name:'-A+ - Ted Lasso'})==='Ted Lasso','Apple TV+ shorthand prefix cleanup failed');
assert(cleanDisplayTitle({name:'-NF - Stranger Things'})==='Stranger Things','Leading-ornament Netflix prefix cleanup failed');
assert(sourceTraits({name:'-A+ - Ted Lasso'}).tag==='Apple TV','Apple TV+ provider source-tag normalization failed');
assert(metadataIdentityMatches({kind:'series',name:'-NF - Stranger Things',year:'2016'},{title:'Stranger Things',year:'2016'})===true,'Provider-prefixed TV metadata identity cleanup failed');
assert(metadataIdentityMatches({kind:'series',name:'Lioness (2023) (US)',year:''},{title:'Lioness',year:'2023'})===true,'TV series metadata identity should preserve year while cleaning market suffixes');
assert(normalizeMediaTitle('AMZ - Blade Runner 2049 (2017)')==='blade runner 2049','AMZ prefix normalization failed');

const rankedSources=rankSources([
  {id:'s1080',kind:'movie',name:'NF - Sample Movie 1080p H.264',group:'Movies'},
  {id:'s4k',kind:'movie',name:'AMZ - Sample Movie 4K Dolby Vision HEVC Atmos',group:'Movies 4K'}
]);
assert(rankedSources[0].id==='s4k','Smart source ranking should prefer the stronger 4K/Dolby Vision source');
const smartTraits=sourceTraits(rankedSources[0]);
assert(smartTraits.quality==='4K'&&smartTraits.hdr==='Dolby Vision'&&smartTraits.codec==='HEVC'&&smartTraits.audio==='Atmos','Smart source technical badges failed');


// v0.6.0 household profile model + Kids restrictions + smart row order.
const p1=makeProfile({id:'p1',name:'Justin',avatar:'cyan',myList:['m1'],profileSettings:{homeRows:['continue','action-movies'],backgroundColor:'#050505',smartHomeOrder:true}});
const p2=normalizeProfile({id:'p2',name:'Kids',avatar:'kids',kids:true,profileSettings:{homeRows:['family-movies'],smartHomeOrder:true}});
assert(p1.myList[0]==='m1'&&p2.kids===true,'Profile creation/normalization failed');
assert(profileAllowsMedia(p2,{name:'Family Adventure',group:'Kids',certification:'PG'})===true,'Kids profile should allow family PG content');
assert(profileAllowsMedia(p2,{name:'Late Night',group:'Adult XXX'})===false,'Kids profile explicit-category filter failed');
assert(profileAllowsMedia(p2,{name:'Crime Film',certification:'MA15+'})===false,'Kids profile mature-certification filter failed');
const affinity=profileGenreAffinity([{id:'a'},{id:'b'}],id=>({id,genre:id==='a'?'Action':'Action'}),item=>new Set([item.genre.toLowerCase()]));
const rankedRows=smartRankRows([{id:'comedy-movies',label:'Comedy Movies'},{id:'action-movies',label:'Action Movies'}],affinity);
assert(rankedRows[0].id==='action-movies','Smart profile Home ranking failed');

const api=buildXtreamApiUrl('http://tv.example:8080/player_api.php','user name','p@ss','get_series_info',{series_id:22});
assert(api.startsWith('http://tv.example:8080/player_api.php?'),'Xtream URL base failed');
assert(api.includes('username=user+name')&&api.includes('series_id=22'),'Xtream URL query failed');

const episodeUrl=buildXtreamSeriesStreamUrl({server:'http://tv.example:8080',username:'user name',password:'p@ss'},{id:901,container_extension:'mkv'});
assert(episodeUrl==='http://tv.example:8080/series/user%20name/p%40ss/901.mkv','Xtream series stream URL failed');


let relayCapture=null;
const realFetch=globalThis.fetch;
globalThis.fetch=async (url,options={})=>{
  relayCapture={url:String(url),options};
  return new Response(JSON.stringify({user_info:{auth:1}}),{status:200,headers:{'content-type':'application/json'}});
};
const profile=await testXtream({server:'http://tv.example:8080',username:'demo',password:'secret',relayUrl:'https://relay.example.workers.dev',relayToken:'1234567890123456'});
assert(profile.user_info.auth===1,'Xtream relay profile failed');
assert(relayCapture.url==='https://relay.example.workers.dev','Xtream relay URL failed');
assert(relayCapture.options.method==='POST','Xtream relay method failed');
assert(relayCapture.options.headers.authorization==='Bearer 1234567890123456','Xtream relay auth failed');
const relayBody=JSON.parse(relayCapture.options.body);
assert(relayBody.server==='http://tv.example:8080'&&relayBody.username==='demo','Xtream relay body failed');

globalThis.fetch=async (url)=>{
  relayCapture={url:String(url)};
  return new Response(JSON.stringify({user_info:{auth:1}}),{status:200,headers:{'content-type':'application/json'}});
};
const token='this-is-a-long-private-test-token';
const workerRequest=new Request('https://relay.example.workers.dev/',{
  method:'POST',
  headers:{'content-type':'application/json','authorization':`Bearer ${token}`,'origin':'https://swoop.example'},
  body:JSON.stringify({server:'http://tv.example:8080',username:'demo',password:'secret',action:'get_live_streams',params:{}})
});
const workerResponse=await worker.fetch(workerRequest,{SWOOP_PROXY_TOKEN:token});
assert(workerResponse.status===200,'Worker valid request failed');
assert(relayCapture.url.includes('/player_api.php?')&&relayCapture.url.includes('action=get_live_streams'),'Worker upstream URL failed');
assert(workerResponse.headers.get('access-control-allow-origin')==='https://swoop.example','Worker CORS failed');

const blockedRequest=new Request('https://relay.example.workers.dev/',{
  method:'POST',headers:{'content-type':'application/json','authorization':`Bearer ${token}`},
  body:JSON.stringify({server:'http://127.0.0.1:8080',username:'demo',password:'secret',action:'get_live_streams'})
});
const blockedResponse=await worker.fetch(blockedRequest,{SWOOP_PROXY_TOKEN:token});
assert(blockedResponse.status===400,'Worker private-network guard failed');


// Artwork helper client path
let assetRelayCapture=null;
globalThis.fetch=async (url,options={})=>{
  assetRelayCapture={url:String(url),options};
  return new Response(new Uint8Array([137,80,78,71]),{status:200,headers:{'content-type':'image/png'}});
};
const assetBlob=await fetchXtreamAssetBlob({relayUrl:'https://relay.example.workers.dev',relayToken:token},'http://logos.example/channel.png');
assert(assetBlob.type==='image/png','Artwork client blob type failed');
assert(JSON.parse(assetRelayCapture.options.body).mode==='asset','Artwork client relay mode failed');

// Worker artwork relay path
globalThis.fetch=async (url)=>{
  assetRelayCapture={url:String(url)};
  return new Response(new Uint8Array([137,80,78,71]),{status:200,headers:{'content-type':'image/png','content-length':'4'}});
};
const assetRequest=new Request('https://relay.example.workers.dev/',{
  method:'POST',headers:{'content-type':'application/json','authorization':`Bearer ${token}`,'origin':'https://swoop.example'},
  body:JSON.stringify({mode:'asset',url:'http://logos.example/channel.png'})
});
const assetResponse=await worker.fetch(assetRequest,{SWOOP_PROXY_TOKEN:token});
assert(assetResponse.status===200,'Worker artwork relay failed');
assert(assetResponse.headers.get('content-type')==='image/png','Worker artwork content type failed');


// Xtream import progress callbacks
const progressSections=[];
globalThis.fetch=async (url,options={})=>{
  const body=JSON.parse(options.body||'{}');
  const action=body.action||'';
  const payload={
    get_live_categories:[{category_id:'1',category_name:'Sports'}],
    get_live_streams:[{stream_id:11,name:'Arena',category_id:'1',container_extension:'ts'}],
    get_vod_categories:[{category_id:'2',category_name:'Movies'}],
    get_vod_streams:[{stream_id:22,name:'Signal Run',category_id:'2',container_extension:'mp4',added:'1787530200'}],
    get_series_categories:[{category_id:'3',category_name:'Series'}],
    get_series:[{series_id:33,name:'Night Shift',category_id:'3',last_modified:'1787531200'}]
  }[action]||{};
  return new Response(JSON.stringify(payload),{status:200,headers:{'content-type':'application/json'}});
};
const imported=await importXtream({server:'http://tv.example:8080',username:'demo',password:'secret',relayUrl:'https://relay.example.workers.dev',relayToken:token},'progress-test',info=>progressSections.push(info.section));
assert(imported.counts.live===1&&imported.counts.movie===1&&imported.counts.series===1,'Xtream import counts failed');
assert(progressSections.includes('live')&&progressSections.includes('movie')&&progressSections.includes('series'),'Xtream progress callbacks failed');
assert(imported.items.find(x=>x.kind==='movie')?.providerAddedAt===1787530200000,'Xtream VOD provider-added timestamp capture failed');
assert(imported.items.find(x=>x.kind==='series')?.providerAddedAt===1787531200000,'Xtream series provider-added timestamp capture failed');
assert(imported.items.find(x=>x.kind==='live')?.providerCategoryOrder===0&&imported.items.find(x=>x.kind==='live')?.providerCategoryId==='1','Xtream live provider-category ordering metadata failed');


// Detail metadata + EPG helper calls
const detailActions=[];
globalThis.fetch=async (url,options={})=>{
  const body=JSON.parse(options.body||'{}');
  detailActions.push(body);
  if(body.action==='get_vod_info') return new Response(JSON.stringify({info:{plot:'Test plot'}}),{status:200,headers:{'content-type':'application/json'}});
  if(body.action==='get_short_epg') return new Response(JSON.stringify({epg_listings:[{title:'VGVzdA==',start_timestamp:100,stop_timestamp:200}]}),{status:200,headers:{'content-type':'application/json'}});
  return new Response('{}',{status:200,headers:{'content-type':'application/json'}});
};
const vodInfo=await fetchXtreamVodInfo({server:'http://tv.example:8080',username:'demo',password:'secret',relayUrl:'https://relay.example.workers.dev',relayToken:token},22);
assert(vodInfo.info.plot==='Test plot','Xtream VOD detail fetch failed');
const epgInfo=await fetchXtreamShortEpg({server:'http://tv.example:8080',username:'demo',password:'secret',relayUrl:'https://relay.example.workers.dev',relayToken:token},11,8);
assert(Array.isArray(epgInfo.epg_listings),'Xtream EPG fetch failed');
assert(detailActions.some(x=>x.action==='get_vod_info'&&String(x.params?.vod_id)==='22'),'VOD detail action/param failed');
assert(detailActions.some(x=>x.action==='get_short_epg'&&String(x.params?.stream_id)==='11'&&String(x.params?.limit)==='8'),'EPG action/standard limit param failed');
assert(buildXtreamXmltvUrl('http://tv.example:8080','demo','secret').includes('/xmltv.php?')&&buildXtreamXmltvUrl('http://tv.example:8080','demo','secret').includes('username=demo'),'Xtream XMLTV URL builder failed');

// Connection Helper allowlist supports VOD detail metadata.
globalThis.fetch=async (url)=>new Response(JSON.stringify({info:{plot:'Worker detail'}}),{status:200,headers:{'content-type':'application/json'}});
const vodWorkerRequest=new Request('https://relay.example.workers.dev/',{
  method:'POST',headers:{'content-type':'application/json','authorization':`Bearer ${token}`},
  body:JSON.stringify({server:'http://tv.example:8080',username:'demo',password:'secret',action:'get_vod_info',params:{vod_id:22}})
});
const vodWorkerResponse=await worker.fetch(vodWorkerRequest,{SWOOP_PROXY_TOKEN:token});
assert(vodWorkerResponse.status===200,'Worker VOD info allowlist failed');


// Swoop TV owner-managed TMDb metadata endpoint.
globalThis.fetch=async (url,options={})=>{
  const u=String(url);
  assert(String(options?.headers?.Authorization||'').startsWith('Bearer '),'TMDb bearer token missing');
  if(u.includes('api.themoviedb.org/3/search/movie')) return new Response(JSON.stringify({results:[{id:77,title:'Michael',release_date:'2026-01-01'}]}),{status:200,headers:{'content-type':'application/json'}});
  if(u.includes('api.themoviedb.org/3/movie/77')) {
    assert(u.includes('append_to_response=images'),'TMDb images were not appended to details');
    return new Response(JSON.stringify({id:77,title:'Michael',release_date:'2026-01-01',overview:'Backdrop test',vote_average:7.8,runtime:122,genres:[{name:'Drama'}],poster_path:'/poster.jpg',backdrop_path:'/fallback.jpg',images:{backdrops:[{file_path:'/best-backdrop.jpg',width:1920,height:1080,aspect_ratio:1.7778,vote_average:8.6,vote_count:20},{file_path:'/other.jpg',width:1280,height:720,aspect_ratio:1.7778,vote_average:5.0,vote_count:3}],logos:[{file_path:'/logo.png',width:900,height:280,iso_639_1:'en',vote_average:8.0}]},credits:{cast:[{id:123,name:'Actor One',character:'Lead',profile_path:'/actor.jpg'}],crew:[{name:'Director One',job:'Director'}]},videos:{results:[{site:'YouTube',key:'abc123xyz',type:'Trailer',official:true,name:'Official Trailer'}]},recommendations:{results:[{id:88,title:'Related Film',release_date:'2025-02-02',poster_path:'/r.jpg'}]},release_dates:{results:[{iso_3166_1:'AU',release_dates:[{certification:'M'}]}]}}),{status:200,headers:{'content-type':'application/json'}});
  }
  throw new Error(`Unexpected TMDb URL ${u}`);
};
const metadataReq=new Request('https://relay.example.workers.dev/',{method:'POST',headers:{'content-type':'application/json','origin':'http://127.0.0.1:38673'},body:JSON.stringify({mode:'metadata',mediaType:'movie',title:'TOP - Michael (2026)',year:'2026'})});
const metadataRes=await worker.fetch(metadataReq,{SWOOP_PROXY_TOKEN:token,TMDB_API_TOKEN:'tmdb-test-token'});
assert(metadataRes.status===200,'Worker metadata request failed');
const metadataJson=await metadataRes.json();
assert(metadataJson.metadata?.backdrop==='https://image.tmdb.org/t/p/original/best-backdrop.jpg','TMDb backdrop mapping failed');
assert(metadataJson.metadata?.backdrops?.length>=2,'TMDb backdrop gallery mapping failed');
assert(metadataJson.metadata?.titleLogo==='https://image.tmdb.org/t/p/w500/logo.png','TMDb title logo mapping failed');
assert(metadataJson.metadata?.cast?.[0]?.name==='Actor One'&&metadataJson.metadata?.cast?.[0]?.id==='123','TMDb cast mapping/person ID failed');
assert(metadataJson.metadata?.director==='Director One','TMDb director mapping failed');
assert(metadataJson.metadata?.trailerKey==='abc123xyz','TMDb trailer mapping failed');
assert(metadataJson.metadata?.recommendations?.[0]?.tmdbId==='88','TMDb recommendations mapping failed');
assert(metadataJson.metadata?.certification==='M'&&metadataJson.metadata?.runtime==='122 min','TMDb certification/runtime mapping failed');

// v0.7.22 cast-member filmography endpoint + client request.
globalThis.fetch=async (url,options={})=>{
  const u=String(url);
  assert(String(options?.headers?.Authorization||'').startsWith('Bearer '),'TMDb person bearer token missing');
  if(u.includes('api.themoviedb.org/3/search/person'))return new Response(JSON.stringify({results:[{id:123,name:'Actor One',profile_path:'/actor.jpg'}]}),{status:200,headers:{'content-type':'application/json'}});
  if(u.includes('api.themoviedb.org/3/person/123'))return new Response(JSON.stringify({id:123,name:'Actor One',known_for_department:'Acting',profile_path:'/actor-big.jpg',combined_credits:{cast:[
    {id:801,media_type:'movie',title:'Film One',release_date:'2025-03-01',character:'Lead',poster_path:'/film-one.jpg',popularity:12},
    {id:802,media_type:'tv',name:'Show One',first_air_date:'2024-09-02',character:'Host',poster_path:'/show-one.jpg',popularity:9},
    {id:801,media_type:'movie',title:'Film One',release_date:'2025-03-01',character:'Lead',poster_path:'/film-one.jpg',popularity:12}
  ]}}),{status:200,headers:{'content-type':'application/json'}});
  throw new Error(`Unexpected person URL ${u}`);
};
const personReq=new Request('https://relay.example.workers.dev/',{method:'POST',headers:{'content-type':'application/json','origin':'http://127.0.0.1:38673'},body:JSON.stringify({mode:'person-credits',name:'Actor One'})});
const personRes=await worker.fetch(personReq,{TMDB_API_TOKEN:'tmdb-test-token',SWOOP_PROXY_TOKEN:token});
assert(personRes.status===200,'Worker person credits request failed');
const personJson=await personRes.json();
assert(personJson.person?.id==='123'&&personJson.person?.credits?.length===2,'Worker person-credit identity/dedupe failed');
assert(personJson.person?.credits?.some(x=>x.media_type==='movie'&&x.tmdb==='801'&&x.year==='2025'),'Worker movie person credit mapping failed');
assert(personJson.person?.credits?.some(x=>x.media_type==='tv'&&x.tmdb==='802'&&x.year==='2024'),'Worker TV person credit mapping failed');
let personClientBody=null;
globalThis.fetch=async (url,options={})=>{personClientBody=JSON.parse(options.body||'{}');return new Response(JSON.stringify({person:{id:'123',name:'Actor One',credits:[]}}),{status:200,headers:{'content-type':'application/json'}});};
const personClient=await fetchPersonCredits({settings:{metadataServiceUrl:'https://metadata.example.workers.dev'},personId:'123',name:'Actor One'});
assert(personClientBody?.mode==='person-credits'&&personClientBody?.personId==='123'&&personClient?.name==='Actor One','Client person credits request failed');

// v0.7.13 lightweight viewport IMDb rating endpoint.
globalThis.fetch=async (url,options={})=>{
  const u=String(url);
  if(u.includes('api.themoviedb.org/3/search/movie'))return new Response(JSON.stringify({results:[{id:77,title:'Michael',release_date:'2026-01-01'}]}),{status:200,headers:{'content-type':'application/json'}});
  if(u.includes('api.themoviedb.org/3/movie/77/external_ids'))return new Response(JSON.stringify({imdb_id:'tt1234567'}),{status:200,headers:{'content-type':'application/json'}});
  if(u.includes('api.mdblist.com/rating/movie/imdb')){
    const body=JSON.parse(options.body||'{}');
    assert(body.ids?.[0]==='tt1234567','IMDb rating request must use resolved IMDb ID');
    return new Response(JSON.stringify({ratings:[{rating:8.4}]}),{status:200,headers:{'content-type':'application/json'}});
  }
  throw new Error(`Unexpected IMDb rating URL ${u}`);
};
const imdbRatingReq=new Request('https://relay.example.workers.dev/',{method:'POST',headers:{'content-type':'application/json','origin':'http://127.0.0.1:38673'},body:JSON.stringify({mode:'imdb-rating',mediaType:'movie',title:'Michael',year:'2026'})});
const imdbRatingRes=await worker.fetch(imdbRatingReq,{TMDB_API_TOKEN:'tmdb-test-token',MDBLIST_API_KEY:'mdb-test-key',SWOOP_PROXY_TOKEN:token});
assert(imdbRatingRes.status===200,'Worker lightweight IMDb rating request failed');
const imdbRatingJson=await imdbRatingRes.json();
assert(imdbRatingJson.rating?.tmdbId==='77'&&imdbRatingJson.rating?.imdbId==='tt1234567'&&imdbRatingJson.rating?.imdbRating==='8.4','Worker lightweight IMDb rating mapping failed');

let clientRatingBody=null;
globalThis.fetch=async (url,options={})=>{clientRatingBody=JSON.parse(options.body||'{}');return new Response(JSON.stringify({rating:{tmdbId:'77',imdbId:'tt1234567',imdbRating:'8.4',title:'Michael',year:'2026'}}),{status:200,headers:{'content-type':'application/json'}});};
const clientRating=await fetchTitleImdbRating({settings:{metadataServiceUrl:'https://metadata.example.workers.dev'},item:{id:'m77',kind:'movie',name:'Michael',year:'2026'}});
assert(clientRatingBody?.mode==='imdb-rating'&&clientRating?.imdbRating==='8.4','Client lightweight IMDb rating request failed');

assert(metadataIdentityMatches({kind:'movie',name:'Odyssey (2025)',year:'2025'},{title:'Odyssey',year:'2025'})===true,'Exact title/year identity should match');
assert(metadataIdentityMatches({kind:'movie',name:'Odyssey (2025)',year:'2025'},{title:'The Odyssey',year:'2026'})===false,'Different-year metadata must never attach to a provider title');

// v0.7.15 strict title-year guard: never fall back from an explicit provider year
// to a different release just because the title is similar.
let odysseySearchCalls=0,odysseyUnfilteredCalls=0;
globalThis.fetch=async (url,options={})=>{
  const u=String(url);
  if(u.includes('api.themoviedb.org/3/search/movie')){
    odysseySearchCalls++;
    const parsed=new URL(u);
    if(!parsed.searchParams.get('year'))odysseyUnfilteredCalls++;
    return new Response(JSON.stringify({results:parsed.searchParams.get('year')==='2025'?[]:[{id:999,title:'The Odyssey',release_date:'2026-07-17'}]}),{status:200,headers:{'content-type':'application/json'}});
  }
  throw new Error(`Unexpected strict-match URL ${u}`);
};
const odysseyReq=new Request('https://relay.example.workers.dev/',{method:'POST',headers:{'content-type':'application/json','origin':'http://127.0.0.1:38673'},body:JSON.stringify({mode:'metadata',mediaType:'movie',title:'Odyssey',year:'2025'})});
const odysseyRes=await worker.fetch(odysseyReq,{TMDB_API_TOKEN:'tmdb-test-token',SWOOP_PROXY_TOKEN:token});
const odysseyJson=await odysseyRes.json();
assert(odysseyJson.metadata===null,'Explicit 2025 provider title must not inherit The Odyssey (2026) metadata');
assert(odysseySearchCalls===1&&odysseyUnfilteredCalls===0,'Worker must not retry a year-qualified miss as an unfiltered title search');

let clientFallbackCalls=0;
globalThis.fetch=async (url,options={})=>{
  clientFallbackCalls++;
  const body=JSON.parse(options.body||'{}');
  if(body.mode==='imdb-rating')return new Response(JSON.stringify({rating:{tmdbId:'999',imdbId:'tt9999999',imdbRating:'8.5',title:'The Odyssey',year:'2026'}}),{status:200,headers:{'content-type':'application/json'}});
  if(body.mode==='metadata')return new Response(JSON.stringify({metadata:{tmdbId:'999',imdbId:'tt9999999',imdbRating:'8.5',title:'The Odyssey',year:'2026',poster:'https://image.tmdb.org/t/p/w500/wrong.jpg'}}),{status:200,headers:{'content-type':'application/json'}});
  throw new Error('Unexpected client identity request');
};
const rejectedMetadata=await fetchTitleMetadata({settings:{metadataServiceUrl:'https://metadata.example.workers.dev'},item:{id:'ody-2025',kind:'movie',name:'Odyssey',year:'2025'}});
const rejectedRating=await fetchTitleImdbRating({settings:{metadataServiceUrl:'https://metadata.example.workers.dev'},item:{id:'ody-2025',kind:'movie',name:'Odyssey',year:'2025'}});
assert(rejectedMetadata===null&&rejectedRating===null&&clientFallbackCalls>=3,'Client must reject wrong-year artwork and IMDb ratings even when an older worker returns them');

// v0.7.2 blended Swoop TV discovery service: TMDb + owner-managed MDBList signals.
globalThis.fetch=async (url,options={})=>{
  const u=String(url);
  if(u.includes('api.themoviedb.org/3/trending/movie/day'))return new Response(JSON.stringify({results:[{id:501,title:'Hot Today',release_date:'2026-08-20',popularity:99}]}),{status:200});
  if(u.includes('api.themoviedb.org/3/trending/movie/week'))return new Response(JSON.stringify({results:[{id:502,title:'Hot Week',release_date:'2026-08-01',popularity:88}]}),{status:200});
  if(u.includes('api.themoviedb.org/3/movie/popular')){const page=Number(new URL(u).searchParams.get('page')||1);return new Response(JSON.stringify({results:[{id:502+page,title:`Popular Film ${page}`,release_date:'2026-07-01',popularity:77-page}]}),{status:200});}
  if(u.includes('api.themoviedb.org/3/movie/now_playing'))return new Response(JSON.stringify({results:[{id:504,title:'Now Playing',release_date:'2026-08-22',popularity:66}]}),{status:200});
  if(u.includes('api.mdblist.com/justwatch/streaming-charts/movie'))return new Response(JSON.stringify([{title:'Stream Hit',year:2026,tmdb:505}]),{status:200});
  if(u.includes('api.mdblist.com/lists/official/movies/popular/items'))return new Response(JSON.stringify([{title:'Stable Hit',year:2026,tmdb:506}]),{status:200});
  if(u.includes('api.mdblist.com/lists/official/movies/trakt-trending/items'))return new Response(JSON.stringify([{title:'Trakt Hit',year:2026,tmdb:507}]),{status:200});
  if(u.includes('api.mdblist.com/lists/official/movies/trakt-most-watched/items'))return new Response(JSON.stringify([{title:'Watched Hit',year:2026,tmdb:508}]),{status:200});
  if(u.includes('api.mdblist.com/lists/official/movies/imdb-most-popular/items'))return new Response(JSON.stringify([{title:'IMDb Hit',year:2026,tmdb:509}]),{status:200});
  if(u.includes('api.mdblist.com/lists/official/movies/trakt-weekend-box-office/items'))return new Response(JSON.stringify([{title:'Box Office Hit',year:2026,tmdb:510}]),{status:200});
  if(u.includes('api.mdblist.com/lists/snoak/')){
    if(!u.includes('/items'))return new Response(JSON.stringify([{slug:u.split('/').pop(),updated_at:new Date().toISOString(),dynamic:true}]),{status:200});
    if(u.includes('/todays-most-popular-movies/items'))return new Response(JSON.stringify({movies:[{title:'Snoak JustWatch Hit',release_year:2026,tmdb_id:601,imdb_id:'tt0000601'}]}),{status:200});
    if(u.includes('/todays-most-popular-movies-on-television-stats/items'))return new Response(JSON.stringify({movies:[{title:'Snoak TV Stats Hit',release_year:2026,tmdb_id:602}]}),{status:200});
    if(u.includes('/top-10-movies-of-the-day/items'))return new Response(JSON.stringify({movies:[{title:'Snoak IMDb Hit',release_year:2026,tmdb_id:603}]}),{status:200});
    if(u.includes('/most-popular-movies-on-rotten-tomatoes/items'))return new Response(JSON.stringify({movies:[{title:'Snoak Rotten Hit',release_year:2026,tmdb_id:604}]}),{status:200});
    if(u.includes('/trending-movies/items'))return new Response(JSON.stringify({movies:[{title:'Snoak Trakt Hit',release_year:2026,tmdb_id:605}]}),{status:200});
    if(u.includes('/trakts-trending-movies-digital/items'))return new Response(JSON.stringify({movies:[{title:'Snoak Digital Hit',release_year:2026,tmdb_id:606}]}),{status:200});
    if(u.includes('/latest-movies-digital-release/items'))return new Response(JSON.stringify({movies:[{title:'Snoak Latest Hit',release_year:2026,tmdb_id:607}]}),{status:200});
    if(u.includes('/action-movies/items'))return new Response(JSON.stringify({movies:[{title:'Snoak Action Hit',release_year:2026,tmdb_id:608}]}),{status:200});
  }
  return new Response(JSON.stringify({error:'not found'}),{status:404});
};
const discoveryReq=new Request('https://relay.example.workers.dev/',{method:'POST',headers:{'content-type':'application/json','origin':'http://127.0.0.1:38673'},body:JSON.stringify({mode:'discovery',mediaType:'movie'})});
const discoveryRes=await worker.fetch(discoveryReq,{TMDB_API_TOKEN:'tmdb-test-token',MDBLIST_API_KEY:'mdb-test-key',SWOOP_PROXY_TOKEN:token});
assert(discoveryRes.status===200,'Worker discovery request failed');
const discoveryJson=await discoveryRes.json();
assert(discoveryJson.enhanced===true,'Owner-managed MDBList discovery flag failed');
assert(discoveryJson.sources?.tmdbDay?.[0]?.tmdb==='501','TMDb daily trending source failed');
assert(discoveryJson.sources?.tmdbPopular?.length===20&&discoveryJson.sources.tmdbPopular.at(-1)?.tmdb==='522','Top 100 discovery must fetch a deeper multi-page TMDb popularity pool');
assert(discoveryJson.sources?.justwatch?.[0]?.tmdb==='505','JustWatch discovery source failed');
assert(discoveryJson.sources?.traktTrending?.[0]?.tmdb==='507','Trakt trending discovery source failed');
assert(discoveryJson.sources?.mostWatched?.[0]?.tmdb==='508','Most watched discovery source failed');
assert(discoveryJson.sources?.boxOffice?.[0]?.tmdb==='510','Box office discovery source failed');
assert(discoveryJson.snoak===true&&discoveryJson.sources?.snoakJustwatch?.[0]?.tmdb==='601','Snoak JustWatch primary discovery source failed');
assert(discoveryJson.sources?.snoakTvStats?.[0]?.tmdb==='602'&&discoveryJson.sources?.snoakTrakt?.[0]?.tmdb==='605','Snoak Television Stats / Trakt discovery sources failed');
assert(discoveryJson.sources?.snoakLatest?.[0]?.tmdb==='607','Snoak latest-streaming discovery source failed');
const snoakListReq=new Request('https://relay.example.workers.dev/',{method:'POST',headers:{'content-type':'application/json','origin':'http://127.0.0.1:38673'},body:JSON.stringify({mode:'snoak-list',listKey:'genre-action-movies'})});
const snoakListRes=await worker.fetch(snoakListReq,{TMDB_API_TOKEN:'tmdb-test-token',MDBLIST_API_KEY:'mdb-test-key',SWOOP_PROXY_TOKEN:token});
assert(snoakListRes.status===200,'Allow-listed Snoak genre route failed');
const snoakListJson=await snoakListRes.json();
assert(snoakListJson.source==='snoak/mdblist'&&snoakListJson.items?.[0]?.tmdb==='608','Snoak curated genre payload mapping failed');
const badSnoakRes=await worker.fetch(new Request('https://relay.example.workers.dev/',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({mode:'snoak-list',listKey:'arbitrary-user-list'})}),{MDBLIST_API_KEY:'mdb-test-key'});
assert(badSnoakRes.status===400,'Snoak route must reject non-allow-listed lists');


// v0.7.2 large-library startup/storage stability guards.
const storageSource=fs.readFileSync(new URL('./src/storage.js',import.meta.url),'utf8');
const appSource=fs.readFileSync(new URL('./app.js',import.meta.url),'utf8');
const cssSource=fs.readFileSync(new URL('./styles.css',import.meta.url),'utf8');
assert(storageSource.includes("bulk-manifest-v2")&&storageSource.includes('CATALOG_CHUNK_SIZE=2000'),'Chunked durable catalog storage missing');
assert(storageSource.includes("storage-worker.js"),'Legacy bulk background-worker migration missing');
assert(appSource.includes('activeCatalogSourceRef')&&appSource.includes('activeCatalogCache'),'Stable active-catalog cache missing');
assert(!/render\(\);\s*restoreDurableLibrary\(\);\s*$/.test(appSource),'Large library must not restore while Who’s Watching is on screen');

// v0.7.1 profile theme engine.
assert(SWOOP_THEMES.length===4,'Expected four launch themes');
assert(['chill','prime-time','rewind','vice'].every(id=>themeById(id).id===id),'Theme IDs missing');
assert(themeById('vice').accent==='#ff4fc3'&&themeById('rewind').accent==='#ffd51f','Theme palettes missing');

// v0.7.0 multi-provider live dedupe + provider-priority source selection.
const liveMulti=[
  {id:'p1:l1',providerId:'p1',kind:'live',source:'xtream',name:'FOX Footy HD',group:'Sports',tvgId:'fox-footy',streamUrl:'http://p1/live/1.ts'},
  {id:'p2:l9',providerId:'p2',kind:'live',source:'xtream',name:'FOX Footy 1080p',group:'Sports',tvgId:'fox-footy',streamUrl:'http://p2/live/9.ts'},
  {id:'p2:l10',providerId:'p2',kind:'live',source:'xtream',name:'ESPN',group:'Sports',tvgId:'espn',streamUrl:'http://p2/live/10.ts'}
];
const liveIndex=buildLiveStackIndex(liveMulti,{p1:0,p2:1});
assert(liveIndex.stacked.length===2,'Multi-provider live dedupe failed');
const fox=liveIndex.stacked.find(x=>x.sourceCount===2);
assert(fox&&fox._stackConfidence==='EPG channel ID','Live duplicate confidence missing');
const foxSource=selectLiveSource(fox,{p1:0,p2:1});
assert(foxSource.streamUrl&&foxSource.id===fox.id,'Live stacked source selection failed');
const rankedProvider=rankSources([
  {id:'a',providerId:'p2',name:'Film',kind:'movie'},
  {id:'b',providerId:'p1',name:'Film',kind:'movie'}
],'',{p1:0,p2:1});
assert(rankedProvider[0].id==='b','Movie source provider-priority tie-break failed');

const nativePs=fs.readFileSync(new URL('./windows-native/SwoopTV.ps1',import.meta.url),'utf8');
assert(nativePs.includes('--input-ipc-server=')&&nativePs.includes("'/native/control'")&&nativePs.includes("'--start='"),'Windows mpv IPC/resume bridge missing');
assert(nativePs.includes('swoop-progress.lua')&&nativePs.includes('mpv-playback-state.json')&&nativePs.includes("mp.commandv('seek'"),'Windows durable progress/resume sidecar missing');
assert(nativePs.includes("'load-url'")&&nativePs.includes("@('loadfile',$switchUrl,'replace')"),'Windows in-process live channel switching missing');
assert(nativePs.includes("'--cache-secs=15'")&&nativePs.includes("'--demuxer-readahead-secs=20'")&&!nativePs.includes("'--profile=low-latency'"),'Proven compatibility playback profile must remain unchanged');
assert(appSource.includes('Recommended For You')&&appSource.includes('UP NEXT')&&appSource.includes('Loading Now & Next'),'Personalization/Up Next/live UI missing');
assert(appSource.includes('if(pos<10)return 0')&&!appSource.includes('pct>0&&pct<95?pos:0'),'Resume must accept a saved time position even when IPTV duration/percentage is unavailable');
assert(appSource.includes('SMART SOURCE SELECTION')&&appSource.includes('Play Recommended')&&appSource.includes('sourceChoiceItem')&&appSource.includes('playableFromSource'),'Smart multi-source chooser UI/flow missing');
assert(appSource.includes('QUICK GUIDE')&&appSource.includes('switchLiveChannel')&&appSource.includes('Favourite Channels')&&appSource.includes('backgroundLiveBar'),'Premium Live TV hub/player UI missing');
assert(appSource.includes('Who’s watching?')&&appSource.includes('profilePickerPage')&&appSource.includes('switchProfile')&&appSource.includes('Kids profile'),'Household profile UI/flow missing');
assert(!appSource.includes('Because You Watched')&&appSource.includes('Recommended For You')&&appSource.includes('PINNED_HOME_ROWS'),'Home recommendation cleanup/pinned hierarchy missing');
assert(appSource.includes('xtream-${Math.abs(hash(`${cfg.server}|${cfg.username}`))}')&&appSource.includes('m3u-${Math.abs(hash(`${url||name}`))}'),'Stable provider identity for profile continuity missing');
assert(appSource.includes('Profile Theme Engine')||appSource.includes('Choose a Swoop TV theme')||appSource.includes('themePickerHtml'),'Profile-linked theme UI missing');
assert(appSource.includes("PROFILE_SETTING_KEYS=['themeId','backgroundColor','backgroundOverride'"),'Theme persistence keys missing');

globalThis.fetch=realFetch;
assert(appSource.includes('Provider Manager')&&appSource.includes('Refresh All')&&appSource.includes('providerFiltered'),'Multi-provider manager/filter UI missing');
assert(appSource.includes('replaceProviderCatalog')&&appSource.includes('enabledProviders')&&appSource.includes('providerPriorityMap'),'Unified provider catalog/priority logic missing');
// v0.7.3 performance guards retained in v0.7.4.
{
  const app = fs.readFileSync(new URL('./app.js', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
  assert(/LARGE_LIBRARY_THRESHOLD=12000/.test(app),'Large-library threshold missing');
  assert(/data-lazy-home-row/.test(app),'Lazy Home row placeholders missing');
  assert(/mountLazyHomeRows/.test(app),'Lazy Home row mounting missing');
  assert(/scheduleSearch/.test(app),'Debounced search missing');
  assert(/data-performance-mode/.test(app),'Performance setting missing');
  assert(/content-visibility:auto/.test(css),'Off-screen content visibility missing');
  assert(/data-performance="lean"/.test(css),'Lean visual mode missing');
}

// v0.7.4 native SQLite catalogue foundation.
{
  const prepared=prepareNativeCatalogItems(duplicateCatalog.slice(0,3));
  assert(prepared.every(x=>x._dbLogicalKey==='title-year:blade runner 2049|2017'),'Native catalogue logical movie identity must preserve confident title+year stacking across provider/source labels');
  assert(prepared.every(x=>x._dbCleanName==='blade runner 2049'),'Native catalogue cleaned title failed');
  const sqlitePs=fs.readFileSync(new URL('./windows-native/SwoopTV.ps1',import.meta.url),'utf8');
  const nativeModule=fs.readFileSync(new URL('./src/nativeCatalog.js',import.meta.url),'utf8');
  const swSource=fs.readFileSync(new URL('./sw.js',import.meta.url),'utf8');
  assert(sqlitePs.includes('sqlite-tools-win-x64-3530400.zip')&&sqlitePs.includes('F46EE2475DE4CBE287E6E5F7D43C838796B14E7379CD216BDBB28D391429F9FC'),'Pinned/verified SQLite Windows runtime missing');
  assert(sqlitePs.includes('CREATE TABLE IF NOT EXISTS catalog')&&sqlitePs.includes('CREATE VIRTUAL TABLE IF NOT EXISTS catalog_fts USING fts5'),'SQLite catalogue/FTS schema missing');
  assert(sqlitePs.includes("'/native/catalog/query'")&&sqlitePs.includes("'/native/catalog/search'")&&sqlitePs.includes("'/native/catalog/categories'")&&sqlitePs.includes("'/native/catalog/match'"),'Native catalogue query endpoints missing');
  assert(sqlitePs.includes('ROW_NUMBER() OVER(PARTITION BY logical_key')&&sqlitePs.includes('COUNT(DISTINCT logical_key)'),'Database-level logical-title grouping missing');
  assert(sqlitePs.includes('bm25(catalog_fts)'),'FTS5 ranked search missing');
  assert(sqlitePs.includes('stack:${k}:')&&!sqlitePs.includes('stack:$k:'),'PowerShell native stack ID interpolation guard failed');
  assert(nativeModule.includes('chunkSize=2000')&&nativeModule.includes('/native/catalog/append'),'Chunked native provider import missing');
  assert(appSource.includes('activateNativeCatalogIfAvailable')&&appSource.includes('migrateCatalogToNative')&&appSource.includes('nativePageCache'),'Native catalogue activation/paged UI integration missing');
  assert(appSource.includes('nativeCatalogSearch')&&appSource.includes('nativeCatalogMatchPayload')&&appSource.includes('hydrateNativeProfileItems'),'Native FTS/discovery/profile hydration integration missing');
  assert(storageSource.includes('retireBrowserCatalog')&&storageSource.includes('nativeCatalog:true'),'Browser bulk catalogue retirement after SQLite migration missing');
  assert(swSource.includes('swoop-tv-v0726-shell')&&swSource.includes('./src/nativeCatalog.js'),'v0.7.26 PWA cache/native module wiring missing');
  assert(sqlitePs.includes("'--cache-secs=15'")&&sqlitePs.includes("'--demuxer-readahead-secs=20'")&&!sqlitePs.includes("'--profile=low-latency'"),'Native catalogue work must not change proven mpv playback profile');
}

assert(appSource.includes('_nativeSourceIds')&&appSource.includes('resolveNativeCatalogItem'),'Native source alias/playback hydration hotfix missing');
assert(appSource.includes("nativeItemCache.set(String(alias),item)")&&appSource.includes('logicalItemIds(item)'),'Native source-ID alias cache missing');
const sqlitePsHotfix=fs.readFileSync(new URL('./windows-native/SwoopTV.ps1',import.meta.url),'utf8');
const swHotfix=fs.readFileSync(new URL('./sw.js',import.meta.url),'utf8');
assert(sqlitePsHotfix.includes("GROUP_CONCAT(item_id,'|') OVER(PARTITION BY logical_key)")&&sqlitePsHotfix.includes("_nativeSourceIds"),'SQLite logical source-ID propagation missing');
assert(sqlitePsHotfix.includes("version='0.7.26'")&&swHotfix.includes('swoop-tv-v0726-shell'),'v0.7.26 version/cache wiring missing');
assert(appSource.includes('Mark as Watched')&&appSource.includes('Mark as Unwatched')&&appSource.includes('toggleWatched'),'Watched/unwatched controls missing');
assert(appSource.includes("const PINNED_HOME_ROWS=['continue','top20-movies','top20-shows']"),'Pinned Home row order missing');
assert(appSource.includes('card-watched')&&appSource.includes('completed:true'),'Watched card/completion state missing');
const profilesSource=fs.readFileSync(new URL('./src/profiles.js',import.meta.url),'utf8');
for(const animal of ['Lion','Elephant','Monkey','Tiger','Zebra','Giraffe','Rhino','Meerkat'])assert(profilesSource.includes(`label:'${animal}'`),`Animal avatar missing: ${animal}`);
assert(appSource.includes('posterOwnsTitle')&&appSource.includes('poster-art-title'),'Poster cards must allow artwork to own the visible title');
assert(appSource.includes("source.name||item.name"),'Smart Source Selection must retain full raw source titles');
assert(appSource.includes('function tenPointRating')&&appSource.includes('function displayRating')&&appSource.includes('rating:tenPointRating(enriched.rating)'),'Trusted 0–10 TMDb rating display guard missing');
assert(appSource.includes('if(!history.length)return[]')&&appSource.includes('if(affinity<=0)return {item,score:0,tie:0}'),'Recommended For You cold-start/genre-affinity guard missing');
assert(appSource.includes('function isDemoItem(item)')&&appSource.includes("if(isDemoItem(item))return {...item,logo:'',backdrop:'',titleLogo:'',plot:'',rating:'',imdbRating:'',tmdbId:'',imdbId:''}"),'Disconnected demo artwork cache guard missing');
assert(appSource.includes("if(!item||isDemoItem(item)||!['movie','series'].includes(item.kind))return null;"),'Demo metadata lookup exclusion missing');
assert(appSource.includes('const enriched=isDemoItem(item)?{}:'),'Demo detail metadata guard missing');
assert(appSource.indexOf('<h3>TV Providers</h3>')<appSource.indexOf("profileAvatarHtml(activeProfile(),'profile-avatar-lg')")&&appSource.indexOf("profileAvatarHtml(activeProfile(),'profile-avatar-lg')")<appSource.indexOf('<h3>Performance</h3>'),'Settings hierarchy must begin TV Providers → Profile → Performance');
assert(appSource.includes('const HOME_RANKED_ROW_LIMIT=100;')&&appSource.includes('const HOME_STANDARD_ROW_LIMIT=100;'),'Home rail 100-item limits missing');
assert(appSource.includes("label:'Top 100 Movies'")&&appSource.includes("label:'Top 100 TV Shows'")&&appSource.includes('rank-three-digit'),'Top 100 ranked labels/three-digit rank treatment missing');
assert(appSource.includes("String(def.id).startsWith('top20-')?HOME_RANKED_ROW_LIMIT:HOME_STANDARD_ROW_LIMIT"),'Ranked Home rows must expand to 100 while retaining legacy row IDs');
assert(appSource.includes('limit:HOME_STANDARD_ROW_LIMIT')&&appSource.includes('rowLimit=String(id).startsWith(\'top20-\')?HOME_RANKED_ROW_LIMIT:HOME_STANDARD_ROW_LIMIT'),'Native/web discovery Home row limits must support 100 items');
assert(appSource.includes('function displayImdbRating')&&appSource.includes('card-imdb-rating')&&!appSource.includes("[item.year,trustedRating?`★ ${trustedRating}`"),'Poster cards must hide year/generic star metadata and expose the IMDb badge');
const workerSource=fs.readFileSync(new URL('./cloudflare-worker/worker.js',import.meta.url),'utf8');
assert(workerSource.includes('fetchMdbImdbRating')&&workerSource.includes('handleImdbRating')&&workerSource.includes('/rating/${mediaType}/imdb')&&workerSource.includes("mode || '') === 'imdb-rating'")&&workerSource.includes("version:'0.1.16'"),'IMDb viewport rating worker wiring missing');
assert(appSource.includes('IMDB_RATING_SCHEMA=2')&&appSource.includes('delete meta.imdbRating')&&appSource.includes('delete meta.imdbRatingCheckedAt'),'IMDb rating cache must selectively refresh without clearing artwork metadata');
assert(appSource.includes('visibleMetadataQueue')&&appSource.includes('hydrateVisibleImdbRatings')&&appSource.includes('data-imdb-item')&&appSource.includes('fetchTitleImdbRating'),'Viewport-driven IMDb rating hydration missing');
assert(appSource.includes('imdbRatingCheckedAt')&&appSource.includes('30*86400000'),'Long-lived IMDb rating cache missing');
assert(appSource.includes('suspendBaseViewForDetail')&&appSource.includes('restoreSuspendedBaseView'),'Detail route must preserve and restore the rendered browse DOM');
assert(appSource.includes('patchDetailHeroFromState')&&appSource.includes('patchDetailSectionsFromState')&&appSource.includes("enrichItemMetadata(item,{rerender:false})"),'Detail metadata/source hydration must patch in place rather than force full rerenders');
assert(appSource.includes('detail-title-slot')&&appSource.includes("title:cleanDisplayTitle({name:enriched.title||info.name||movie.name||item.name})"),'Detail title must use stable slot + cleaned provider title');
assert(appSource.includes('patchMountedHomeRows')&&appSource.includes('primeNativeHomeRows'),'Home background hydration must patch mounted rows instead of rebuilding the whole page');
const detailCss=fs.readFileSync(new URL('./styles.css',import.meta.url),'utf8');
assert(detailCss.includes('.detail-title-slot:has(.detail-title-logo.loaded) .detail-title-text')&&detailCss.includes('.detail-backdrop-retiring'),'Stable title-logo/backdrop crossfade CSS missing');
const tmdbClientSource=fs.readFileSync(new URL('./src/tmdb.js',import.meta.url),'utf8');
assert(tmdbClientSource.includes('cleanMetadataTitle')&&tmdbClientSource.includes("'amz'")&&tmdbClientSource.includes("'netflix'"),'Metadata client must strip common provider prefixes before TMDb matching');
assert(tmdbClientSource.includes("'a+'")&&tmdbClientSource.includes('[-–—|:•·]'),'Metadata client must handle punctuated provider prefixes and Apple TV+ shorthand');
assert(appSource.includes('TITLE_LOOKUP_SCHEMA=2')&&appSource.includes('needsTitleLookupPrefixRepair')&&appSource.includes('titleLookupSchema:TITLE_LOOKUP_SCHEMA'),'Corrected provider-prefixed title lookups must selectively retry stale no-logo cache entries once');

assert(appSource.includes("label:'Recently Added Movies'")&&appSource.includes("label:'Recently Added TV Shows'")&&appSource.includes("sort:'provider-added'"),'Provider recently-added Home rails missing');
assert(appSource.includes('function providerAddedNumber')&&appSource.includes('providerAddedNumber(b)-providerAddedNumber(a)'),'Browser provider-added sort/fallback missing');
assert(sqlitePsHotfix.includes("'provider-added'")&&sqlitePsHotfix.includes("json_extract(raw_json,'$.providerAddedAt')")&&sqlitePsHotfix.includes('provider_sequence DESC'),'Native SQLite provider-added sort missing');
assert(appSource.includes('METADATA_ARTWORK_SCHEMA=4'),'v0.7.15 must invalidate legacy ambiguous metadata cache once');
assert(workerSource.includes('strictSearchMatch')&&workerSource.includes('resolveTmdbIdentity')&&!workerSource.includes("delete params[type==='tv'?'first_air_date_year':'year']"),'Strict title-year TMDb fallback guard missing');
assert(tmdbClientSource.includes('metadataIdentityMatches')&&tmdbClientSource.includes('requestedYear!==resolvedYear'),'Client-side metadata identity guard missing');
assert(tmdbClientSource.includes("year:item.year || identityYear(item.name || '')"),'Metadata requests must extract a provider year from TV series names when the year field is blank');
assert(appSource.includes('titleLogoCheckedAt')&&appSource.includes('detailTitleLogoState')&&appSource.includes("classList.toggle('logo-pending'")&&cssSource.includes('.detail-title-slot.logo-pending .detail-title-text'),'Logo-first detail title fallback wiring missing');
assert(workerSource.includes('US|USA|UK|GB|AU|AUS|CA|CAN|NZ')&&workerSource.includes("version:'0.1.16'"),'Worker TV series suffix cleanup/version missing');

// v0.7.20 ranked rail stability / strict discovery matching.
assert(appSource.includes('DISCOVERY_MATCH_SCHEMA=5')&&appSource.includes('if(!invalidateDiscovery&&aux.webDiscovery)'), 'Discovery cache schema must invalidate pre-fix ranked matches, including native aux cache');
assert(appSource.includes("sourceLimit=mode==='top20'?600:200")&&appSource.includes('sourceLimit:800'), 'Top 100 discovery must scan a deeper candidate pool');
assert(appSource.includes('bindRailStability')&&appSource.includes("current.dataset.deferredRefresh='1'")&&appSource.includes('left>6'), 'Scrolled Home rails must defer async DOM replacement');
assert(detailCss.includes('.ranked-section .rail{grid-auto-columns:minmax(205px,15.6vw);padding-left:10px;scroll-snap-type:none;scroll-behavior:auto}'), 'Ranked rails must use unsnapped native horizontal scrolling');
assert(sqlitePsHotfix.includes('Select-Object -First 800')&&sqlitePsHotfix.includes('(cand.year=0 OR c.year=cand.year)'), 'Native discovery matching must scan deeply and require exact title/year');
assert(workerSource.includes('tmdbFetchPages')&&workerSource.includes("},20)")&&workerSource.includes('slice(0,500)'), 'Worker must provide a deep Top 100 candidate pool');


// v0.7.22 clickable cast / local-library filmography browsing.
assert(workerSource.includes('handlePersonCredits')&&workerSource.includes("mode || '') === 'person-credits'")&&workerSource.includes('combined_credits')&&workerSource.includes("id:x.id?String(x.id):''"),'Worker cast-person identity/credits route missing');
assert(tmdbClientSource.includes('fetchPersonCredits')&&tmdbClientSource.includes("mode:'person-credits'"),'Client cast-person service missing');
assert(appSource.includes('data-person-name')&&appSource.includes('function openPerson')&&appSource.includes('function personHtml')&&appSource.includes('matchPersonCreditsToLibrary'),'Clickable cast filmography route missing');
assert(appSource.includes("nativeCatalogMatchPayload(moviePayload,'movie',{sourceLimit:800,limit:800")&&appSource.includes("nativeCatalogMatchPayload(showPayload,'show',{sourceLimit:800,limit:800"),'Native cast filmography matching depth missing');
assert(appSource.includes('suspendDetailViewForPerson')&&appSource.includes('suspendPersonViewForDetail')&&appSource.includes('restoreSuspendedPersonView'),'Cast/detail nested navigation preservation missing');
assert(detailCss.includes('.person-route')&&detailCss.includes('.person-progress-track')&&detailCss.includes('.cast-card:hover'),'Cast route/progress/interaction styling missing');
assert(sqlitePsHotfix.includes('Math]::Min(800,[int]$Data.limit)'),'Native matcher must allow larger actor filmography result sets');

// v0.7.22 Snoak daily discovery integration.
assert(appSource.includes('SNOAK_CURATED_ROWS')&&appSource.includes('fetchSwoopCuratedList')&&appSource.includes("mode==='snoak'"),'Snoak curated Home-row client wiring missing');
assert(appSource.includes('snoakJustwatch:1.8')&&appSource.includes('snoakTrakt:2.05')&&appSource.includes('snoakLatest:2.0'),'Snoak primary discovery weights missing');
assert(appSource.includes('DISCOVERY_MATCH_SCHEMA=5'),'Snoak discovery release must invalidate older ranked caches');
assert(workerSource.includes('SNOAK_LISTS')&&workerSource.includes("'movies-justwatch'")&&workerSource.includes("mode || '') === 'snoak-list'")&&workerSource.includes('SNOAK_STALE_MS'),'Worker Snoak allow-list/freshness route missing');
assert(workerSource.includes('cacheTtl:21600')&&workerSource.includes("version:'0.1.16'"),'Snoak Worker cache/version wiring missing');

// v0.7.23 category-first TV Guide.
assert(appSource.includes("let guideLimit=48,guideCategory=''"),'TV Guide must start with a bounded 48-channel category window');
assert(appSource.includes('function guideCategories()')&&appSource.includes('data-guide-category')&&appSource.includes('guide-categories'),'Category navigator wiring missing');
assert(appSource.includes("nativeCatalogQuery({kind:'live',providerIds:nativeEnabledProviderIds(),group:guideCategory,limit:guideLimit"),'Native Guide must query only the selected live category');
assert(appSource.includes('guideLimit+=48')&&appSource.includes('guideChannelCache')&&appSource.includes('guideChannelRequests'),'Guide category pagination/cache/request coalescing missing');
assert(appSource.includes('m3uGuideTextCache')&&appSource.includes('10*60*1000')&&appSource.includes('parseXMLTV(text,wanted)'),'Category-aware cached XMLTV loading missing');
assert(appSource.includes("nativeCatalogCategories('live',{providerIds:nativeEnabledProviderIds(),limit:200})"),'Native Guide category discovery depth missing');
assert(sqlitePsHotfix.includes('[Math]::Min(200,[int]($Data.limit))'),'Native Windows category endpoint must permit 200 live categories');
assert(detailCss.includes('.guide-browser{display:grid;grid-template-columns:250px minmax(0,1fr)')&&detailCss.includes('.guide-category.active'),'Category-first Guide desktop layout styling missing');

// v0.7.26 provider-order Guide + Xtream EPG repair.
assert(appSource.includes('ensureGuideProviderCategoryOrder')&&appSource.includes('fetchXtreamLiveCategories')&&appSource.includes('guideProviderCategoryCache'),'Guide category order must come from the provider category API');
assert(sqlitePsHotfix.includes("json_extract(raw_json,'$.providerCategoryOrder')")&&sqlitePsHotfix.includes('provider_order ASC,first_seen ASC'),'Native category fallback must preserve provider/first-seen order');
assert(appSource.includes('fetchXtreamSimpleEpg')&&appSource.includes('fetchXtreamXmltvText')&&appSource.includes('xtreamGuideTextCache'),'Guide EPG must use short/simple APIs plus XMLTV fallback');
assert(workerSource.includes("mode || '') === 'xmltv'")&&workerSource.includes('/xmltv.php?')&&workerSource.includes("'limit', 'epg_limit'")&&workerSource.includes("version:'0.1.16'"),'Worker Xtream EPG/XMLTV repair wiring missing');
assert(sqlitePsHotfix.includes("'/native/xtream-xmltv'")&&sqlitePsHotfix.includes('Invoke-XtreamXmltv'),'Windows native XMLTV fallback missing');

// v0.7.18 visible progress / long-task reassurance.
assert(appSource.includes('provider-inline-progress')&&appSource.includes('data-provider-progress-percent')&&appSource.includes('refreshProgress'),'Provider refresh percentage/progress UI missing');
assert(appSource.includes('task-progress-hud')&&appSource.includes('Still running — Swoop TV has not frozen.')&&appSource.includes('longTaskElapsedLabel'),'Persistent long-task progress HUD/reassurance missing');
assert(appSource.includes('providerProgressPercent')&&appSource.includes('restoreProgressPercent'),'Provider-connect / restore numeric percentages missing');
assert(appSource.includes('guide-load-progress')&&appSource.includes('data-guide-load-percent')&&appSource.includes('updateGuideProgress'),'TV Guide progress feedback missing');
assert(appSource.includes('activity-progress indeterminate')&&detailCss.includes('.activity-progress.indeterminate')&&detailCss.includes('@keyframes swoopProgressShine'),'Indeterminate/moving activity feedback missing for unknown-duration work');
console.log('Swoop TV v0.7.26 tests passed');
