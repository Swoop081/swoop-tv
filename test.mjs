import {parseM3U} from './src/m3u.js';
import {matchMDBListToCatalog} from './src/mdblist.js';
import {buildXtreamApiUrl, testXtream} from './src/xtream.js';
import worker from './cloudflare-worker/worker.js';

function assert(condition, message){if(!condition) throw new Error(message)}

const sample=`#EXTM3U\n#EXTINF:-1 tvg-id="abc" group-title="Sports",Arena Sports\nhttps://example.com/live/1.m3u8\n#EXTINF:-1 group-title="Movies",Signal Run\nhttps://example.com/movie/2.mp4`;
const items=parseM3U(sample,'test');
assert(items.length===2,'M3U count failed');
assert(items[0].kind==='live'&&items[1].kind==='movie','M3U kind failed');

const catalog=[{id:'m1',kind:'movie',name:'Signal Run',year:'2026',tmdbId:'42'}];
const matches=matchMDBListToCatalog([{title:'Signal Run',year:2026,tmdb:42}],catalog);
assert(matches.length===1&&matches[0].id==='m1','MDBList match failed');

const api=buildXtreamApiUrl('http://tv.example:8080/player_api.php','user name','p@ss','get_series_info',{series_id:22});
assert(api.startsWith('http://tv.example:8080/player_api.php?'),'Xtream URL base failed');
assert(api.includes('username=user+name')&&api.includes('series_id=22'),'Xtream URL query failed');

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

globalThis.fetch=realFetch;
console.log('Swoop TV v0.1.1 tests passed');
