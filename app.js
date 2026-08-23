import {parseM3U} from './src/m3u.js';
import {testXtream, importXtream, fetchXtreamAssetBlob} from './src/xtream.js';
import {getMDBListItems, matchMDBListToCatalog} from './src/mdblist.js';
import {loadState, saveState, clearState} from './src/storage.js';
import {demoCatalog} from './src/demo.js';

const DEFAULT_STATE={page:'home', catalog:[], provider:null, favourites:[], continueWatching:[], mdblistRows:[], settings:{mdblistApiKey:'',xtreamRelayUrl:'',xtreamRelayToken:''}};
const loaded=loadState()||{};
const state=Object.assign({},DEFAULT_STATE,loaded,{settings:{...DEFAULT_STATE.settings,...(loaded.settings||{})}});
let modal=null, toastTimer=null, playerItem=null, activeHls=null;
const viewLimits={live:180,movie:120,series:120};
let sessionRelay={url:state.settings.xtreamRelayUrl||state.provider?.relayUrl||'',token:state.settings.xtreamRelayToken||state.provider?.relayToken||''};
const artworkCache=new Map();
const artworkRelayQueue=[]; let artworkRelayActive=0; const ARTWORK_RELAY_LIMIT=6;
const $app=document.querySelector('#app');

function esc(s=''){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function activeCatalog(){return state.catalog.length?state.catalog:demoCatalog}
function items(kind){return activeCatalog().filter(x=>x.kind===kind)}
function card(item,poster=false,opts={}){
  const fallback=item.demoColor||`linear-gradient(135deg,hsl(${Math.abs(hash(item.name))%360} 42% 38%),#0e1526)`;
  const sub=item.kind==='live'?(item.group||'Live TV'):[item.year,item.rating?`★ ${item.rating}`:''].filter(Boolean).join('  ·  ');
  const art=item.logo?`<img class="card-art" data-swoop-art="${esc(item.logo)}" alt="" loading="lazy">`:'';
  return `<button class="card ${poster?'poster':''}" data-play="${esc(item.id)}" style="--card-bg:${fallback}" aria-label="${esc(item.name)}">
    <div class="card-bg"></div>${art}<div class="card-shade"></div>${item.kind==='live'?`<div class="badge"><span class="live-dot"></span>LIVE</div>`:''}
    <div class="card-copy"><div class="card-title">${esc(item.name)}</div><div class="card-sub">${esc(sub)}</div></div>
    ${opts.progress?`<div class="progress"><i style="width:${opts.progress}%"></i></div>`:''}</button>`;
}
function hash(s=''){let h=0;for(let i=0;i<s.length;i++)h=((h<<5)-h)+s.charCodeAt(i)|0;return h}
function nav(){const pages=[['home','⌂','Home'],['live','◉','Live TV'],['movies','▰','Movies'],['series','▦','TV Shows'],['search','⌕','Search']];return `
  <header class="topbar"><div class="brand"><i class="brand-mark"></i>SWOOP TV</div>
  <nav class="desktop-nav">${pages.map(([p,,label])=>`<button class="nav-btn ${state.page===p?'active':''}" data-page="${p}">${label}</button>`).join('')}</nav>
  <div class="top-actions"><button class="icon-btn" data-page="search" aria-label="Search">⌕</button><button class="icon-btn" data-modal="provider"><span class="label-hide">＋ Provider</span></button><button class="icon-btn" data-page="settings" aria-label="Settings">⚙</button></div></header>
  <nav class="bottom-nav">${pages.map(([p,icon,label])=>`<button class="${state.page===p?'active':''}" data-page="${p}"><span>${icon}</span>${label}</button>`).join('')}</nav>`}
function rail(title,data,poster=false,meta=''){if(!data.length)return'';return `<section class="section"><div class="section-head"><h2>${esc(title)}</h2><span class="section-meta">${esc(meta)}</span></div><div class="rail">${data.map((x,i)=>card(x,poster,{progress:title==='Continue Watching'?(28+i*11)%86:0})).join('')}</div></section>`}
function home(){
  const cat=activeCatalog(), live=cat.filter(x=>x.kind==='live'), movies=cat.filter(x=>x.kind==='movie'), shows=cat.filter(x=>x.kind==='series');
  const providerName=state.provider?.name||'Demo Library';
  return `<main><section class="hero"><div class="hero-art"></div><div class="hero-content"><div class="eyebrow">${state.catalog.length?'YOUR LIBRARY IS READY':'SWOOP TV v0.1.3'}</div><h1>Your TV.<br>Your way.</h1><p>${state.catalog.length?`${esc(providerName)} is connected. Browse live channels, movies and series from one cinematic interface.`:'Connect an M3U playlist or Xtream provider to replace this demo catalog with your own authorised TV library.'}</p><div class="cta-row"><button class="btn accent" data-modal="provider">${state.catalog.length?'Manage Provider':'Add TV Provider'}</button><button class="btn secondary" data-page="live">Open Live TV</button></div></div></section>
  <div class="content">${rail('Live Now',live.slice(0,12),false,`${live.length} channels`)}${rail('Continue Watching',[...movies,...shows].slice(0,8),true)}${state.mdblistRows.map(r=>rail(r.name,r.items,true,`${r.items.length} available`)).join('')}${rail('Movies',[...movies].slice(0,12),true,`${movies.length} titles`)}${rail('TV Shows',[...shows].slice(0,12),true,`${shows.length} series`)}</div></main>`;
}
function page(kind,title){
  const arr=items(kind), limit=viewLimits[kind]||120, shown=arr.slice(0,limit);
  const cards=kind==='live'
    ?shown.map((x,i)=>`<button class="channel-card" data-play="${esc(x.id)}"><div class="channel-logo"><span>${esc((x.name||'?').slice(0,2).toUpperCase())}</span>${x.logo?`<img class="channel-logo-img" data-swoop-art="${esc(x.logo)}" alt="" loading="lazy">`:''}</div><div><div class="channel-now">${esc(x.name)}</div><div class="channel-next">${esc(x.group||'Live TV')} · Select to play</div></div><div class="channel-num">${String(i+1).padStart(3,'0')}</div></button>`).join('')
    :shown.map(x=>card(x,true)).join('');
  return `<main class="page"><div class="page-title-row"><div><h1>${title}</h1><div class="subtle">${state.catalog.length?`${arr.length} items from ${esc(state.provider?.name||'your provider')}`:'Demo content — connect a provider to populate your library.'}</div></div><button class="btn secondary" data-modal="provider">＋ Provider</button></div>${arr.length?`<div class="${kind==='live'?'channel-grid':'grid'}">${cards}</div>${shown.length<arr.length?`<div class="load-more-wrap"><button class="btn secondary" data-load-more="${kind}">Load more · showing ${shown.length} of ${arr.length}</button></div>`:''}`:empty('No content yet','Connect a TV provider to populate this section.')}</main>`
}
function empty(title,copy){return `<div class="empty"><h3>${esc(title)}</h3><p>${esc(copy)}</p><button class="btn accent" data-modal="provider">Add TV Provider</button></div>`}
function searchPage(){return `<main class="page"><div class="page-title-row"><div><h1>Search</h1><div class="subtle">Search channels, movies and TV shows.</div></div><div class="searchbox"><input id="searchInput" autofocus placeholder="Search Swoop TV…" /></div></div><div id="searchResults" class="grid"></div></main>`}
function settingsPage(){const counts={live:items('live').length,movie:items('movie').length,series:items('series').length};return `<main class="page"><div class="page-title-row"><div><h1>Settings</h1><div class="subtle">Provider, discovery and local-device configuration.</div></div></div><div class="settings-list">
  <section class="setting-card"><h3>Provider</h3><div class="kv"><span>Connected source</span><span>${esc(state.provider?.name||'Demo mode')}</span></div><div class="kv"><span>Catalog</span><span>${counts.live} live · ${counts.movie} movies · ${counts.series} series</span></div><div class="cta-row"><button class="btn secondary" data-modal="provider">Manage provider</button>${state.catalog.length?'<button class="btn danger" data-action="disconnect">Disconnect</button>':''}</div></section>
  <section class="setting-card"><h3>MDBList discovery rows</h3><p class="form-hint">Connect an MDBList API key and list to create a Swoop TV row containing only titles that also exist in your imported catalog.</p><div class="cta-row"><button class="btn secondary" data-modal="mdblist">Add MDBList row</button></div>${state.mdblistRows.length?state.mdblistRows.map((r,i)=>`<div class="kv"><span>${esc(r.name)}</span><span>${r.items.length} matched · <button class="nav-btn" data-remove-row="${i}">Remove</button></span></div>`).join(''):''}</section>
  <section class="setting-card"><h3>Browser connection helper</h3><div class="kv"><span>Xtream API relay</span><span>${state.settings.xtreamRelayUrl?esc(state.settings.xtreamRelayUrl):'Not configured'}</span></div><p class="form-hint">If an Xtream login works in another IPTV app but the browser says “Failed to fetch”, configure the included Cloudflare Worker in the provider screen. Only Xtream API/catalog requests use the helper; video remains provider-to-device.</p></section>
  <section class="setting-card"><h3>Privacy & playback architecture</h3><p class="form-hint">Swoop TV does not bundle content. Imported stream URLs play directly from your provider whenever the browser/device supports them. Xtream stream URLs may contain provider credentials and are stored locally with the imported catalog. The separate login fields and relay token are retained only when you enable the Remember option during import.</p></section>
  </div></main>`}
function render(){let body;if(state.page==='home')body=home();else if(state.page==='live')body=page('live','Live TV');else if(state.page==='movies')body=page('movie','Movies');else if(state.page==='series')body=page('series','TV Shows');else if(state.page==='search')body=searchPage();else body=settingsPage();$app.innerHTML=`<div class="app-shell">${nav()}${body}${modal?modalHtml():''}${playerItem?playerHtml():''}</div>`;bind();if(state.page==='search')runSearch('');hydrateArtwork()}
function providerModal(){return `<div class="modal-backdrop" data-close-modal><div class="modal" data-modal-card><div class="modal-head"><h2>Add TV Provider</h2><button class="icon-btn" data-close>✕</button></div><div class="modal-body"><div class="tabs"><button class="active" data-provider-tab="m3u">M3U Playlist</button><button data-provider-tab="xtream">Xtream</button></div>
  <form id="m3uForm" class="form-grid"><div class="field"><label>Provider name</label><input name="name" value="My TV" required></div><div class="field"><label>M3U playlist URL</label><input name="url" type="url" placeholder="https://provider.example/playlist.m3u"></div><div class="field"><label>Or choose an M3U file</label><input name="file" type="file" accept=".m3u,.m3u8,text/plain,application/x-mpegURL"></div><div class="field"><label>Optional XMLTV / EPG URL</label><input name="epgUrl" type="url" placeholder="https://provider.example/epg.xml"></div><p class="form-hint">Browser URL imports require the playlist server to allow cross-origin requests. Local M3U files work without CORS.</p><button class="btn accent" type="submit">Import M3U</button></form>
  <form id="xtreamForm" class="form-grid" hidden><div class="field"><label>Provider name</label><input name="name" value="My TV" required></div><div class="field"><label>Server URL</label><input name="server" type="url" placeholder="http://provider.example:port" required></div><div class="split"><div class="field"><label>Username</label><input name="username" autocomplete="username" required></div><div class="field"><label>Password</label><input name="password" type="password" autocomplete="current-password" required></div></div>
  <details class="helper-box" ${state.settings.xtreamRelayUrl?'open':''}><summary>Browser Connection Helper <span>use this for “Failed to fetch”</span></summary><div class="helper-body"><p class="form-hint">Some Xtream servers block browser API requests or only offer HTTP. Deploy the included <strong>cloudflare-worker</strong> once, then paste its Worker URL and secret token here. The helper relays metadata/API JSON only — never the video stream.</p><div class="field"><label>Connection Helper URL</label><input name="relayUrl" type="url" value="${esc(state.settings.xtreamRelayUrl||'')}" placeholder="https://swoop-xtream-relay.yourname.workers.dev"></div><div class="field"><label>Helper token</label><input name="relayToken" type="password" value="${esc(state.settings.xtreamRelayToken||'')}" autocomplete="off" placeholder="Your SWOOP_PROXY_TOKEN"></div></div></details>
  <label class="form-hint remember-row"><input type="checkbox" name="remember"> Remember provider login fields and helper token for refresh/reconnect (browser storage is not encrypted).</label><p class="form-hint">With no Helper URL, Swoop TV connects directly. If a Helper URL is present, Xtream API/catalog calls use it automatically. Video streams still play directly from your IPTV provider. Imported Xtream stream URLs may themselves contain provider credentials and are stored locally with the catalog.</p><button class="btn accent" type="submit">Connect Xtream</button></form><div id="providerStatus"></div></div></div></div>`}
function mdblistModal(){return `<div class="modal-backdrop" data-close-modal><div class="modal" data-modal-card><div class="modal-head"><h2>Add MDBList Row</h2><button class="icon-btn" data-close>✕</button></div><div class="modal-body"><form id="mdblistForm" class="form-grid"><div class="field"><label>Row name in Swoop TV</label><input name="rowName" value="My MDBList" required></div><div class="field"><label>MDBList API key</label><input name="apiKey" type="password" value="${esc(state.settings.mdblistApiKey||'')}" required></div><div class="field"><label>List ID</label><input name="listId" placeholder="e.g. 12345"></div><div class="divider"></div><p class="form-hint">Or identify the list by username + list slug/name.</p><div class="split"><div class="field"><label>Username</label><input name="username" placeholder="username"></div><div class="field"><label>List name / slug</label><input name="listName" placeholder="best-action-movies"></div></div><button class="btn accent" type="submit">Fetch & Match Catalog</button></form><div id="mdbStatus"></div></div></div></div>`}
function modalHtml(){return modal==='provider'?providerModal():mdblistModal()}
function setStatus(id,msg,type='info'){const el=document.querySelector(id);if(el)el.innerHTML=`<div class="status ${type}">${esc(msg)}</div>`}
function toast(msg){clearTimeout(toastTimer);document.querySelector('.toast')?.remove();const el=document.createElement('div');el.className='toast';el.textContent=msg;document.body.appendChild(el);toastTimer=setTimeout(()=>el.remove(),2200)}
function findItem(id){return activeCatalog().find(x=>x.id===id)}
function playerHtml(){return `<div class="player-shell" role="dialog" aria-modal="true" aria-label="${esc(playerItem?.name||'Swoop Player')}"><video id="swoopVideo" class="swoop-video" controls autoplay playsinline></video><div class="player-top"><button class="player-back" data-close-player>←</button><div><div class="player-title">${esc(playerItem?.name||'')}</div><div id="playerStatus" class="player-status">${playerItem?.kind==='live'?'Preparing live stream…':'Preparing playback…'}</div></div></div><div id="playerMessage" class="player-message" hidden></div></div>`}
function setPlayerMessage(message,isError=false){
  const status=document.querySelector('#playerStatus'), box=document.querySelector('#playerMessage');
  if(status)status.textContent=isError?'Playback unavailable':'Loading…';
  if(box){box.hidden=false;box.classList.toggle('error',isError);box.textContent=message}
}
function stopPlayback(){
  try{activeHls?.destroy?.()}catch{}
  activeHls=null;
  const video=document.querySelector('#swoopVideo');
  if(video){try{video.pause()}catch{} video.removeAttribute('src'); try{video.load()}catch{}}
}
function closePlayer(){stopPlayback();playerItem=null;render()}
function hlsCandidate(item){
  let url=String(item.streamUrl||'');
  if(item.kind==='live'&&item.source==='xtream') url=url.replace(/\.(?:ts|m3u8)(?=($|\?))/i,'.m3u8');
  return url;
}
function loadHlsLibrary(){
  if(window.Hls)return Promise.resolve(window.Hls);
  if(window.__swoopHlsPromise)return window.__swoopHlsPromise;
  window.__swoopHlsPromise=new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.src='https://cdn.jsdelivr.net/npm/hls.js@1.6.16/dist/hls.min.js';
    script.async=true;
    script.onload=()=>window.Hls?resolve(window.Hls):reject(new Error('HLS player did not initialise.'));
    script.onerror=()=>reject(new Error('Could not load the HLS playback engine.'));
    document.head.appendChild(script);
  });
  return window.__swoopHlsPromise;
}
async function startPlayback(item){
  const video=document.querySelector('#swoopVideo'); if(!video||!item)return;
  const url=hlsCandidate(item);
  if(location.protocol==='https:'&&/^http:\/\//i.test(url)){
    setPlayerMessage('This provider is sending an HTTP video stream. An HTTPS web app cannot safely play it in Chrome. Swoop stopped the request instead of letting the browser hang. A secure HTTPS/HLS stream or the later native Swoop app is required for this source.',true);
    return;
  }
  const lower=url.split('?')[0].toLowerCase();
  const isHls=/\.m3u8$/.test(lower);
  if(item.kind==='live'&&!isHls){
    setPlayerMessage('This live stream is not browser-safe HLS. Swoop has deliberately not opened the raw transport stream because that was causing Chrome to become unresponsive.',true);
    return;
  }
  if(isHls){
    if(video.canPlayType('application/vnd.apple.mpegurl')){
      video.src=url;
      video.addEventListener('loadedmetadata',()=>{const s=document.querySelector('#playerStatus');if(s)s.textContent=item.kind==='live'?'● LIVE':'Playing'},{once:true});
      video.addEventListener('error',()=>setPlayerMessage('The browser could not open this HLS stream. The provider may block browser playback or the stream may use an unsupported codec.',true),{once:true});
      try{await video.play()}catch{}
      return;
    }
    try{
      const Hls=await loadHlsLibrary();
      if(!Hls.isSupported())throw new Error('This browser does not provide MediaSource playback.');
      activeHls=new Hls({enableWorker:true,lowLatencyMode:true,backBufferLength:60,maxBufferLength:20});
      activeHls.attachMedia(video);
      activeHls.on(Hls.Events.MEDIA_ATTACHED,()=>activeHls?.loadSource(url));
      activeHls.on(Hls.Events.MANIFEST_PARSED,()=>{const s=document.querySelector('#playerStatus');if(s)s.textContent=item.kind==='live'?'● LIVE':'Playing';video.play().catch(()=>{})});
      activeHls.on(Hls.Events.ERROR,(_,data)=>{
        if(!data?.fatal)return;
        const detail=data?.details?` (${data.details})`:'';
        setPlayerMessage(`The HLS stream could not be played${detail}. Many IPTV providers allow native apps but block browser HLS/CORS.`,true);
        try{activeHls?.destroy()}catch{} activeHls=null;
      });
    }catch(err){setPlayerMessage(err.message||'Could not start HLS playback.',true)}
    return;
  }
  if(/\.(mp4|webm|m4v)$/.test(lower)){
    video.src=url;
    video.addEventListener('loadedmetadata',()=>{const s=document.querySelector('#playerStatus');if(s)s.textContent='Playing'},{once:true});
    video.addEventListener('error',()=>setPlayerMessage('The browser could not play this video file or codec.',true),{once:true});
    try{await video.play()}catch{}
    return;
  }
  setPlayerMessage('This video container is not supported safely by the web player yet.',true);
}
function play(item){
  if(!item)return;
  if(!item.streamUrl){toast(item.source==='demo'?'Demo item — connect your provider for playback.':item.kind==='series'?'Series episode loading comes in the next playback pass.':'No playable URL available.');return}
  stopPlayback(); playerItem=item; render(); requestAnimationFrame(()=>startPlayback(item));
}
function queueArtworkRelay(task){
  return new Promise((resolve,reject)=>{artworkRelayQueue.push({task,resolve,reject});pumpArtworkRelay()})
}
function pumpArtworkRelay(){
  while(artworkRelayActive<ARTWORK_RELAY_LIMIT&&artworkRelayQueue.length){
    const job=artworkRelayQueue.shift();artworkRelayActive++;
    Promise.resolve().then(job.task).then(job.resolve,job.reject).finally(()=>{artworkRelayActive--;pumpArtworkRelay()});
  }
}
async function relayArtworkUrl(url){
  if(artworkCache.has(url)) return artworkCache.get(url);
  const promise=queueArtworkRelay(async()=>{
    const blob=await fetchXtreamAssetBlob({relayUrl:sessionRelay.url,relayToken:sessionRelay.token},url);
    return URL.createObjectURL(blob);
  }).catch(err=>{artworkCache.delete(url);throw err});
  artworkCache.set(url,promise);
  return promise;
}
function canRelayArtwork(){return Boolean(sessionRelay.url&&sessionRelay.token&&state.provider?.type==='xtream')}
function loadArtwork(img){
  if(img.dataset.swoopLoaded==='1')return;
  img.dataset.swoopLoaded='1';
  const url=img.dataset.swoopArt||'';
  if(!url)return;
  const fallback=async()=>{if(!canRelayArtwork())return;try{img.src=await relayArtworkUrl(url);img.classList.add('loaded')}catch{img.removeAttribute('src')}};
  if(location.protocol==='https:'&&/^http:\/\//i.test(url)&&canRelayArtwork()){fallback();return}
  img.onload=()=>img.classList.add('loaded');
  img.onerror=()=>fallback();
  img.src=url;
}
function hydrateArtwork(){
  const imgs=[...document.querySelectorAll('img[data-swoop-art]')].filter(img=>img.dataset.swoopLoaded!=='1');
  if(!imgs.length)return;
  if('IntersectionObserver' in window){
    const observer=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){observer.unobserve(entry.target);loadArtwork(entry.target)}},{rootMargin:'240px'});
    imgs.forEach(img=>observer.observe(img));
  }else imgs.forEach(loadArtwork);
}
function runSearch(q){const out=document.querySelector('#searchResults');if(!out)return;const term=q.trim().toLowerCase();const res=term?activeCatalog().filter(x=>`${x.name} ${x.group}`.toLowerCase().includes(term)).slice(0,80):activeCatalog().slice(0,24);out.innerHTML=res.length?res.map(x=>card(x,x.kind!=='live')).join(''):empty('No matches','Try another title, channel or category.');hydrateArtwork()}
function persist(){saveState({...state,page:'home'})}
function bind(){
  document.querySelectorAll('[data-page]').forEach(el=>el.onclick=()=>{state.page=el.dataset.page;render()});
  document.querySelectorAll('[data-modal]').forEach(el=>el.onclick=()=>{modal=el.dataset.modal;render()});
  document.querySelectorAll('[data-close]').forEach(el=>el.onclick=()=>{modal=null;render()});
  document.querySelectorAll('[data-close-modal]').forEach(el=>el.onclick=e=>{if(e.target===el){modal=null;render()}});
  document.querySelectorAll('[data-play]').forEach(el=>el.onclick=()=>play(findItem(el.dataset.play)));
  document.querySelectorAll('[data-close-player]').forEach(el=>el.onclick=()=>closePlayer());
  document.querySelectorAll('[data-load-more]').forEach(el=>el.onclick=()=>{const kind=el.dataset.loadMore;viewLimits[kind]=(viewLimits[kind]||120)+(kind==='live'?180:120);render()});
  document.querySelector('[data-action="disconnect"]')?.addEventListener('click',()=>{state.catalog=[];state.provider=null;state.mdblistRows=[];sessionRelay={url:'',token:''};clearState();render();toast('Provider disconnected');});
  document.querySelectorAll('[data-remove-row]').forEach(el=>el.onclick=()=>{state.mdblistRows.splice(Number(el.dataset.removeRow),1);persist();render()});
  const search=document.querySelector('#searchInput');if(search)search.oninput=e=>runSearch(e.target.value);
  document.querySelectorAll('[data-provider-tab]').forEach(el=>el.onclick=()=>{document.querySelectorAll('[data-provider-tab]').forEach(x=>x.classList.toggle('active',x===el));document.querySelector('#m3uForm').hidden=el.dataset.providerTab!=='m3u';document.querySelector('#xtreamForm').hidden=el.dataset.providerTab!=='xtream';});
  document.querySelector('#m3uForm')?.addEventListener('submit',async e=>{e.preventDefault();const fd=new FormData(e.currentTarget),file=fd.get('file'),url=String(fd.get('url')||'').trim();try{setStatus('#providerStatus','Reading playlist…');let text;if(file&&file.size)text=await file.text();else if(url){const r=await fetch(url);if(!r.ok)throw new Error(`Playlist returned HTTP ${r.status}`);text=await r.text()}else throw new Error('Choose an M3U file or enter a playlist URL.');const providerId=`m3u-${Date.now()}`,cat=parseM3U(text,providerId);if(!cat.length)throw new Error('No playable entries were found in that M3U playlist.');state.catalog=cat;state.provider={id:providerId,type:'m3u',name:String(fd.get('name')||'M3U Provider'),epgUrl:String(fd.get('epgUrl')||'')};state.mdblistRows=[];persist();setStatus('#providerStatus',`Imported ${cat.length} items. Opening Swoop TV…`,'ok');setTimeout(()=>{modal=null;state.page='home';render();},500)}catch(err){setStatus('#providerStatus',err.message||String(err),'err')}});
  document.querySelector('#xtreamForm')?.addEventListener('submit',async e=>{e.preventDefault();const fd=new FormData(e.currentTarget),relayUrl=String(fd.get('relayUrl')||'').trim(),relayToken=String(fd.get('relayToken')||''),cfg={server:String(fd.get('server')).trim(),username:String(fd.get('username')),password:String(fd.get('password')),relayUrl,relayToken};try{setStatus('#providerStatus',relayUrl?'Testing Xtream account through Swoop Connection Helper…':'Testing Xtream account directly…');const profile=await testXtream(cfg);if(String(profile?.user_info?.auth)==='0')throw new Error('Xtream account was not authorised.');setStatus('#providerStatus','Connected. Importing live TV, movies and series…');const providerId=`xtream-${Date.now()}`;const result=await importXtream(cfg,providerId);if(!result.items.length)throw new Error('Connected, but the provider returned an empty catalog.');state.catalog=result.items;const remember=Boolean(fd.get('remember'));sessionRelay={url:relayUrl,token:relayToken};state.settings.xtreamRelayUrl=relayUrl;state.settings.xtreamRelayToken=remember?relayToken:'';state.provider={id:providerId,type:'xtream',name:String(fd.get('name')||'Xtream Provider'),server:cfg.server,connection:relayUrl?'helper':'direct',relayUrl, ...(remember?{username:cfg.username,password:cfg.password,relayToken}:{})};state.mdblistRows=[];persist();setStatus('#providerStatus',`Imported ${result.items.length} items${relayUrl?' through the Connection Helper':''}. Opening Swoop TV…`,'ok');setTimeout(()=>{modal=null;state.page='home';render();},500)}catch(err){setStatus('#providerStatus',err.message||String(err),'err')}});
  document.querySelector('#mdblistForm')?.addEventListener('submit',async e=>{e.preventDefault();if(!state.catalog.length){setStatus('#mdbStatus','Import an IPTV catalog first so Swoop TV has something to match against.','err');return}const fd=new FormData(e.currentTarget),apiKey=String(fd.get('apiKey')||'').trim();try{setStatus('#mdbStatus','Fetching MDBList and matching it against your provider catalog…');const payload=await getMDBListItems({apiKey,listId:String(fd.get('listId')||'').trim(),username:String(fd.get('username')||'').trim(),listName:String(fd.get('listName')||'').trim()});const matched=matchMDBListToCatalog(payload,state.catalog);state.settings.mdblistApiKey=apiKey;state.mdblistRows.push({name:String(fd.get('rowName')||'MDBList'),items:matched});persist();setStatus('#mdbStatus',`Matched ${matched.length} titles from this MDBList to your provider catalog.`,'ok');setTimeout(()=>{modal=null;state.page='home';render()},650)}catch(err){setStatus('#mdbStatus',err.message||String(err),'err')}});
}

window.addEventListener('keydown',e=>{if(e.key==='Escape'&&playerItem){closePlayer();return}if(e.key==='Escape'&&modal){modal=null;render()}if((e.key==='ArrowRight'||e.key==='ArrowLeft'||e.key==='ArrowDown'||e.key==='ArrowUp')&&!['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName)){const focusables=[...document.querySelectorAll('button:not([hidden]),[tabindex="0"]')].filter(x=>x.offsetParent!==null);const i=focusables.indexOf(document.activeElement);if(i>=0){e.preventDefault();focusables[(i+(e.key==='ArrowRight'||e.key==='ArrowDown'?1:-1)+focusables.length)%focusables.length].focus()}}});
if('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('./sw.js').catch(()=>{});
render();
