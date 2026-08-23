import {parseM3U} from './src/m3u.js';
import {matchMDBListToCatalog, normalizeMediaTitle, getMDBListOfficialItems, getMDBListStreamingChart} from './src/mdblist.js';
import {buildXtreamApiUrl, buildXtreamSeriesStreamUrl, testXtream, importXtream, fetchXtreamAssetBlob, fetchXtreamVodInfo, fetchXtreamShortEpg} from './src/xtream.js';
import worker from './cloudflare-worker/worker.js';

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



// Built-in web discovery endpoints + order-preserving matching.
let discoveryUrl='';
const discoveryRealFetch=globalThis.fetch;
globalThis.fetch=async url=>{discoveryUrl=String(url);return new Response(JSON.stringify([{title:'Signal Run',year:2026,tmdb:42}]),{status:200,headers:{'content-type':'application/json'}})};
const officialPayload=await getMDBListOfficialItems({apiKey:'test-key',slug:'movies/popular'});
assert(discoveryUrl.includes('/lists/official/movies/popular/items')&&discoveryUrl.includes('apikey=test-key'),'MDBList official Top 20 endpoint failed');
assert(matchMDBListToCatalog(officialPayload,catalog,{sourceLimit:20,limit:20}).length===1,'MDBList official matching failed');
const chartPayload=await getMDBListStreamingChart({apiKey:'test-key',mediaType:'show'});
assert(discoveryUrl.includes('/justwatch/streaming-charts/show'),'MDBList JustWatch show chart endpoint failed');
assert(Array.isArray(chartPayload),'MDBList streaming chart payload failed');
globalThis.fetch=discoveryRealFetch;

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
    get_vod_streams:[{stream_id:22,name:'Signal Run',category_id:'2',container_extension:'mp4'}],
    get_series_categories:[{category_id:'3',category_name:'Series'}],
    get_series:[{series_id:33,name:'Night Shift',category_id:'3'}]
  }[action]||{};
  return new Response(JSON.stringify(payload),{status:200,headers:{'content-type':'application/json'}});
};
const imported=await importXtream({server:'http://tv.example:8080',username:'demo',password:'secret',relayUrl:'https://relay.example.workers.dev',relayToken:token},'progress-test',info=>progressSections.push(info.section));
assert(imported.counts.live===1&&imported.counts.movie===1&&imported.counts.series===1,'Xtream import counts failed');
assert(progressSections.includes('live')&&progressSections.includes('movie')&&progressSections.includes('series'),'Xtream progress callbacks failed');


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
assert(detailActions.some(x=>x.action==='get_short_epg'&&String(x.params?.stream_id)==='11'),'EPG action/param failed');

// Connection Helper allowlist supports VOD detail metadata.
globalThis.fetch=async (url)=>new Response(JSON.stringify({info:{plot:'Worker detail'}}),{status:200,headers:{'content-type':'application/json'}});
const vodWorkerRequest=new Request('https://relay.example.workers.dev/',{
  method:'POST',headers:{'content-type':'application/json','authorization':`Bearer ${token}`},
  body:JSON.stringify({server:'http://tv.example:8080',username:'demo',password:'secret',action:'get_vod_info',params:{vod_id:22}})
});
const vodWorkerResponse=await worker.fetch(vodWorkerRequest,{SWOOP_PROXY_TOKEN:token});
assert(vodWorkerResponse.status===200,'Worker VOD info allowlist failed');


// Swoop owner-managed TMDb metadata endpoint.
globalThis.fetch=async (url,options={})=>{
  const u=String(url);
  assert(String(options?.headers?.Authorization||'').startsWith('Bearer '),'TMDb bearer token missing');
  if(u.includes('api.themoviedb.org/3/search/movie')) return new Response(JSON.stringify({results:[{id:77,title:'Michael',release_date:'2026-01-01'}]}),{status:200,headers:{'content-type':'application/json'}});
  if(u.includes('api.themoviedb.org/3/movie/77')) {
    assert(u.includes('append_to_response=images'),'TMDb images were not appended to details');
    return new Response(JSON.stringify({id:77,title:'Michael',release_date:'2026-01-01',overview:'Backdrop test',vote_average:7.8,poster_path:'/poster.jpg',backdrop_path:'/fallback.jpg',images:{backdrops:[{file_path:'/best-backdrop.jpg',width:1920,height:1080,aspect_ratio:1.7778,vote_average:8.6,vote_count:20},{file_path:'/other.jpg',width:1280,height:720,aspect_ratio:1.7778,vote_average:5.0,vote_count:3}],logos:[{file_path:'/logo.png',width:900,height:280,iso_639_1:'en',vote_average:8.0}]}}),{status:200,headers:{'content-type':'application/json'}});
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

globalThis.fetch=realFetch;
console.log('Swoop TV v0.3.2 tests passed');
