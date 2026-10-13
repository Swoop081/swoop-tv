const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('assets/js/app.js','utf8');
function functionSource(name,nextMarker){
 const start=source.indexOf('function '+name+'(');
 assert.ok(start>=0,name+' exists');
 const end=source.indexOf(nextMarker,start);
 assert.ok(end>start,name+' boundary exists');
 return source.slice(start,end);
}
test('movie and episode URLs retain provider credentials, IDs and extensions',()=>{
 const snippet=functionSource('vodUrl','const WATCH_KEY');
 const ctx={xtream:{base:'http://provider.test:8080',user:'user+test',pass:'pass/@test'}};
 vm.createContext(ctx);vm.runInContext(snippet,ctx);
 assert.equal(ctx.vodUrl({stream_id:123,container_extension:'mkv'}),'http://provider.test:8080/movie/user%2Btest/pass%2F%40test/123.mkv');
 assert.equal(ctx.vodUrl({stream_id:123},{id:456,container_extension:'ts'}),'http://provider.test:8080/series/user%2Btest/pass%2F%40test/456.ts');
});
test('curated movie sources only use provider-confirmed IDs and extensions',()=>{
 const snippet=functionSource('curatedMovieSources','let curatedSourceIndex');
 const ctx={xtream:{vod:[{stream_id:42,name:'Example Film (2024)',container_extension:'mkv'},{stream_id:43,name:'Different Film (2024)',container_extension:'mp4'}]},canonicalVodTitle:s=>String(s).replace(/\\s*\\(2024\\)/,'').toLowerCase(),canonicalVodYear:e=>String(e.year||e.name||'').match(/2024/)?.[0]||''};
 vm.createContext(ctx);vm.runInContext(snippet,ctx);
 const result=ctx.curatedMovieSources({name:'Example Film',year:'2024',streams:[{id:42,ext:'mp4'},{id:43,ext:'mp4'},{id:99,ext:'mp4'}]});
 assert.deepEqual(JSON.parse(JSON.stringify(result)),[{id:'42',ext:'mkv',name:'Example Film (2024)'}]);
});
test('VLC receives the URL constructed by vodUrl',()=>{
 assert.match(source,/vlc-x-callback:\/\/x-callback-url\/stream\?url="\+encodeURIComponent\(url\)/);
 assert.match(source,/playVod\(vodUrl\(\{stream_id:source\.id,container_extension:source\.ext\}\)\)/);
});
