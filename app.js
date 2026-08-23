import {parseM3U} from './src/m3u.js';
import {testXtream, importXtream, fetchXtreamAssetBlob} from './src/xtream.js';
import {isNativeWindows, nativePlay, nativeStop, nativeFetchText, nativeDiagnostics} from './src/native.js';
import {getMDBListItems, matchMDBListToCatalog} from './src/mdblist.js';
import {loadState, saveState, clearState} from './src/storage.js';
import {demoCatalog} from './src/demo.js';

const NATIVE_WINDOWS=isNativeWindows();
const DEFAULT_STATE={page:'home', catalog:[], provider:null, favourites:[], continueWatching:[], mdblistRows:[], settings:{mdblistApiKey:'',xtreamRelayUrl:'',xtreamRelayToken:''}};
const loaded=loadState()||{};
const state=Object.assign({},DEFAULT_STATE,loaded,{settings:{...DEFAULT_STATE.settings,...(loaded.settings||{})}});
let modal=null, toastTimer=null, playerItem=null, activeHls=null;
const viewLimits={live:180,movie:120,series:120};
let sessionRelay={url:state.settings.xtreamRelayUrl||state.provider?.relayUrl||'',token:state.settings.xtreamRelayToken||state.provider?.relayToken||''};
let sessionXtream={server:state.provider?.server||'',username:state.provider?.username||'',password:state.provider?.password||'',relayUrl:state.provider?.relayUrl||state.settings.xtreamRelayUrl||'',relayToken:state.provider?.relayToken||state.settings.xtreamRelayToken||''};
const artworkCache=new Map();
const artworkRelayQueue=[]; let artworkRelayActive=0; const ARTWORK_RELAY_LIMIT=6;
const $app=document.querySelector('#app');

function esc(s=''){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function activeCatalog(){return state.catalog.length?state.catalog:demoCatalog}
function items(kind){return activeCatalog().filter(x=>x.kind===kind)}
function card(item,poster=false,opts={}){
  const fallback=item.demoColor||`linear-gradient(135deg,hsl(${Math.abs(hash(item.name))%360} 44% 34%),#080b12)`;
  const sub=item.kind==='live'?(item.group||'Live TV'):[item.year,item.rating?`★ ${item.rating}`:''].filter(Boolean).join('  ·  ');
  const art=item.logo?`<img class="card-art" data-swoop-art="${esc(item.logo)}" alt="" loading="lazy">`:'';
  const liveBadge=item.kind==='live'?`<div class="badge"><span class="live-dot"></span>LIVE</div>`:'';
  return `<button class="card ${poster?'poster':'landscape'} ${item.kind==='live'?'live-card':''}" data-play="${esc(item.id)}" style="--card-bg:${fallback}" aria-label="${esc(item.name)}">
    <div class="card-bg"></div>${art}<div class="card-shade"></div>${liveBadge}
    <div class="card-copy"><div class="card-title">${esc(item.name)}</div><div class="card-sub">${esc(sub)}</div></div>
    ${opts.progress?`<div class="progress"><i style="width:${opts.progress}%"></i></div>`:''}</button>`;
}
function hash(s=''){let h=0;for(let i=0;i<s.length;i++)h=((h<<5)-h)+s.charCodeAt(i)|0;return h}
function nav(){
  const pages=[['home','⌂','Home'],['live','◉','Live TV'],['movies','▰','Movies'],['series','▦','TV Shows'],['search','⌕','Search']];
  return `<header class="topbar"><button class="brand" data-page="home" aria-label="Swoop TV Home"><i class="brand-mark">S</i><span>SWOOP</span><b>TV</b></button>
  <nav class="desktop-nav">${pages.map(([p,,label])=>`<button class="nav-btn ${state.page===p?'active':''}" data-page="${p}">${label}</button>`).join('')}</nav>
  <div class="top-actions"><button class="icon-btn search-action" data-page="search" aria-label="Search">⌕</button><button class="top-provider" data-modal="provider">＋ Add Provider</button><button class="profile-btn" data-page="settings" aria-label="Settings">S</button></div></header>
  <nav class="bottom-nav">${pages.map(([p,icon,label])=>`<button class="${state.page===p?'active':''}" data-page="${p}"><span>${icon}</span>${label}</button>`).join('')}</nav>`;
}
function rail(title,data,poster=false,meta=''){
  if(!data.length)return'';
  return `<section class="section ${poster?'poster-section':'landscape-section'}"><div class="section-head"><div><h2>${esc(title)}</h2>${meta?`<span class="section-meta">${esc(meta)}</span>`:''}</div><span class="rail-arrow">›</span></div><div class="rail">${data.map((x,i)=>card(x,poster,{progress:title==='Continue Watching'?(28+i*11)%86:0})).join('')}</div></section>`;
}
function featureItem(){
  const cat=activeCatalog();
  return cat.find(x=>x.kind==='movie'&&x.logo)||cat.find(x=>x.kind==='series'&&x.logo)||cat.find(x=>x.kind==='movie')||cat.find(x=>x.kind==='series')||cat.find(x=>x.kind==='live')||null;
}
function hero(feature,providerName){
  if(!feature)return'';
  const isLive=feature.kind==='live';
  const typeLabel=isLive?'LIVE TV':feature.kind==='movie'?'FEATURED MOVIE':'FEATURED SERIES';
  const meta=[feature.year,feature.rating?`★ ${feature.rating}`:'',feature.group].filter(Boolean);
  const art=feature.logo?`<img class="hero-backdrop" data-swoop-art="${esc(feature.logo)}" alt="" loading="eager"><img class="hero-poster" data-swoop-art="${esc(feature.logo)}" alt="" loading="eager">`:'';
  return `<section class="hero">
    <div class="hero-media">${art}<div class="hero-fallback" style="--hero-fallback:${feature.demoColor||'linear-gradient(135deg,#1d2a44,#080a0e)'}"></div></div>
    <div class="hero-vignette"></div>
    <div class="hero-content">
      <div class="hero-brandline"><span class="swoop-mini">S</span><span>${esc(typeLabel)}</span></div>
      <h1>${esc(feature.name)}</h1>
      <div class="hero-meta">${meta.map(x=>`<span>${esc(x)}</span>`).join('')}<span class="hero-source">${esc(providerName)}</span></div>
      <p>${isLive?`Watch ${esc(feature.name)} live from your connected TV provider.`:`Part of your connected ${esc(providerName)} library. Start watching instantly with Swoop's native playback engine.`}</p>
      <div class="cta-row hero-actions"><button class="btn play-btn" data-play="${esc(feature.id)}"><span>▶</span> Play</button><button class="btn secondary hero-secondary" data-page="${isLive?'live':feature.kind==='movie'?'movies':'series'}"><span>ⓘ</span> Browse ${isLive?'Live TV':feature.kind==='movie'?'Movies':'TV Shows'}</button></div>
    </div>
  </section>`;
}
function home(){
  const cat=activeCatalog(), live=cat.filter(x=>x.kind==='live'), movies=cat.filter(x=>x.kind==='movie'), shows=cat.filter(x=>x.kind==='series');
  const providerName=state.provider?.name||'Demo Library';
  const feature=featureItem();
  const groups=[...new Set([...movies,...shows].map(x=>x.group).filter(Boolean))].slice(0,6);
  return `<main class="home-main">${hero(feature,providerName)}
    <div class="content home-content">
      <div class="library-strip"><div><span class="library-dot"></span><strong>${state.catalog.length?esc(providerName):'Demo Library'}</strong><span>${live.length.toLocaleString()} live · ${movies.length.toLocaleString()} movies · ${shows.length.toLocaleString()} shows</span></div><button class="library-manage" data-modal="provider">${state.catalog.length?'Manage Provider':'Connect Provider'} →</button></div>
      ${rail('Live Now',live.slice(0,14),false,`${live.length.toLocaleString()} channels`)}
      ${rail('Movies',movies.slice(0,14),true,`${movies.length.toLocaleString()} titles`)}
      ${state.mdblistRows.map(r=>rail(r.name,r.items.slice(0,14),true,`${r.items.length.toLocaleString()} available`)).join('')}
      ${rail('TV Shows',shows.slice(0,14),true,`${shows.length.toLocaleString()} series`)}
      ${groups.length?`<section class="section genre-section"><div class="section-head"><div><h2>Browse your library</h2><span class="section-meta">Popular categories from your provider</span></div></div><div class="genre-row">${groups.map((g,i)=>`<div class="genre-tile" style="--genre-hue:${(Math.abs(hash(g))+i*31)%360}"><span>${esc(g)}</span></div>`).join('')}</div></section>`:''}
    </div></main>`;
}
function page(kind,title){
  const arr=items(kind), limit=viewLimits[kind]||120, shown=arr.slice(0,limit), providerName=state.provider?.name||'Demo Library';
  const lead=arr.find(x=>x.logo)||arr[0];
  const groups=[...new Set(arr.map(x=>x.group).filter(Boolean))].slice(0,8);
  const leadArt=lead?.logo?`<img data-swoop-art="${esc(lead.logo)}" class="page-hero-art" alt="" loading="eager">`:'';
  const cards=shown.map(x=>card(x,kind!=='live')).join('');
  return `<main class="page cinematic-page">
    <section class="page-hero ${kind==='live'?'live-page-hero':''}">${leadArt}<div class="page-hero-shade"></div><div class="page-hero-copy"><div class="eyebrow">${kind==='live'?'WATCH NOW':kind==='movie'?'ON DEMAND':'BINGE-WORTHY'}</div><h1>${esc(title)}</h1><p>${state.catalog.length?`${arr.length.toLocaleString()} ${kind==='live'?'channels':kind==='movie'?'movies':'series'} from ${esc(providerName)}.`:'Demo content — connect a provider to populate your library.'}</p>${lead?`<button class="btn play-btn page-feature-play" data-play="${esc(lead.id)}">▶ Play ${esc(lead.name)}</button>`:''}</div></section>
    <div class="page-content">
      <div class="page-toolbar"><div class="category-pills">${groups.map(g=>`<span>${esc(g)}</span>`).join('')}</div><button class="btn secondary compact-btn" data-modal="provider">＋ Provider</button></div>
      ${arr.length?`<div class="content-grid ${kind==='live'?'live-content-grid':'poster-content-grid'}">${cards}</div>${shown.length<arr.length?`<div class="load-more-wrap"><button class="btn secondary" data-load-more="${kind}">Load more · showing ${shown.length.toLocaleString()} of ${arr.length.toLocaleString()}</button></div>`:''}`:empty('No content yet','Connect a TV provider to populate this section.')}
    </div></main>`;
}
function empty(title,copy){return `<div class="empty"><div class="empty-mark">S</div><h3>${esc(title)}</h3><p>${esc(copy)}</p><button class="btn accent" data-modal="provider">Add TV Provider</button></div>`}
function searchPage(){return `<main class="page search-page"><div class="search-hero"><div class="eyebrow">FIND SOMETHING GREAT</div><h1>Search Swoop</h1><div class="searchbox searchbox-large"><span>⌕</span><input id="searchInput" autofocus placeholder="Movies, TV shows, live channels…" /></div></div><div class="page-content"><div id="searchResults" class="content-grid search-results"></div></div></main>`}
function settingsPage(){const counts={live:items('live').length,movie:items('movie').length,series:items('series').length};return `<main class="page settings-page"><div class="settings-hero"><div class="eyebrow">SWOOP TV</div><h1>Settings</h1><p>Manage your provider, discovery rows and playback environment.</p></div><div class="page-content settings-list">
  <section class="setting-card setting-card-feature"><div class="setting-icon">TV</div><div class="setting-main"><h3>TV Provider</h3><p>${esc(state.provider?.name||'Demo mode')}</p><div class="setting-stats"><span><strong>${counts.live.toLocaleString()}</strong> Live</span><span><strong>${counts.movie.toLocaleString()}</strong> Movies</span><span><strong>${counts.series.toLocaleString()}</strong> Shows</span></div><div class="cta-row"><button class="btn secondary" data-modal="provider">Manage Provider</button>${state.catalog.length?'<button class="btn danger" data-action="disconnect">Disconnect</button>':''}</div></div></section>
  <section class="setting-card"><div class="setting-icon">MDB</div><div class="setting-main"><h3>MDBList Discovery</h3><p>Create custom Swoop rows from MDBList titles that are available in your provider library.</p><div class="cta-row"><button class="btn secondary" data-modal="mdblist">Add MDBList Row</button></div>${state.mdblistRows.length?state.mdblistRows.map((r,i)=>`<div class="kv"><span>${esc(r.name)}</span><span>${r.items.length} matched · <button class="nav-btn" data-remove-row="${i}">Remove</button></span></div>`).join(''):''}</div></section>
  ${NATIVE_WINDOWS?`<section class="setting-card native-ready"><div class="setting-icon">▶</div><div class="setting-main"><h3>Windows Native Playback</h3><p>Native bridge ready · mpv 0.41.0. Live TV and VOD play outside the browser sandbox for broader IPTV compatibility.</p></div></section>`:`<section class="setting-card"><div class="setting-icon">↗</div><div class="setting-main"><h3>Browser Connection Helper</h3><p>${state.settings.xtreamRelayUrl?esc(state.settings.xtreamRelayUrl):'Not configured'} · Used only for Xtream API/catalog requests when the browser blocks direct access.</p></div></section>`}
  <section class="setting-card"><div class="setting-icon">◈</div><div class="setting-main"><h3>Privacy & Architecture</h3><p>Swoop TV does not bundle content. ${NATIVE_WINDOWS?'The Windows build uses a loopback-only local bridge for provider API calls and native playback.':'Imported streams play directly from your provider whenever the browser/device supports them.'} Xtream stream URLs can contain provider credentials and are stored locally with the catalog.</p></div></section>
  </div></main>`}
function render(){let body;if(state.page==='home')body=home();else if(state.page==='live')body=page('live','Live TV');else if(state.page==='movies')body=page('movie','Movies');else if(state.page==='series')body=page('series','TV Shows');else if(state.page==='search')body=searchPage();else body=settingsPage();$app.innerHTML=`<div class="app-shell">${nav()}${body}${modal?modalHtml():''}${playerItem?playerHtml():''}</div>`;bind();if(state.page==='search')runSearch('');hydrateArtwork()}
function providerModal(){
  const connected=state.provider?.name?`<div class="provider-current"><span class="provider-current-dot"></span><div><strong>${esc(state.provider.name)}</strong><span>${state.provider.type==='xtream'?'Xtream Codes':'M3U Playlist'} currently connected</span></div></div>`:'';
  const helper=NATIVE_WINDOWS
    ?`<div class="provider-note native-note"><div class="provider-note-icon">✓</div><div><strong>Windows Native Bridge ready</strong><span>HTTP and HTTPS Xtream servers are supported. No Cloudflare details are needed in this Windows app.</span></div></div>`
    :`<details class="helper-box compact-helper" ${state.settings.xtreamRelayUrl?'open':''}><summary>Connection Helper <span>only if direct login fails</span></summary><div class="helper-body"><p class="form-hint">Use your Swoop Connection Helper when a working Xtream account is blocked by browser CORS or mixed-content rules. It relays catalog/API requests only, never video.</p><div class="field"><label>Connection Helper URL</label><input name="relayUrl" type="url" value="${esc(state.settings.xtreamRelayUrl||'')}" placeholder="https://your-worker.workers.dev"></div><div class="field"><label>Helper token</label><input name="relayToken" type="password" value="${esc(state.settings.xtreamRelayToken||'')}" autocomplete="off" placeholder="SWOOP_PROXY_TOKEN"></div></div></details>`;
  return `<div class="modal-backdrop" data-close-modal><div class="modal provider-modal" data-modal-card>
    <div class="modal-head provider-modal-head"><div><div class="eyebrow">TV PROVIDER</div><h2>${state.provider?'Manage Provider':'Add Provider'}</h2><p>Choose how your TV service was supplied. Swoop will only show the fields required for that connection type.</p></div><button class="icon-btn" data-close aria-label="Close">✕</button></div>
    <div class="modal-body provider-modal-body">
      ${connected}
      <div id="providerSetup">
        <div class="provider-methods" aria-label="Provider type">
          <button type="button" class="provider-method active" data-provider-tab="xtream"><span class="provider-method-icon">X</span><span><strong>Xtream Codes</strong><small>Server URL + username + password</small></span><span class="provider-method-check">✓</span></button>
          <button type="button" class="provider-method" data-provider-tab="m3u"><span class="provider-method-icon">M3U</span><span><strong>M3U Playlist</strong><small>Playlist URL or local M3U file</small></span><span class="provider-method-check">✓</span></button>
        </div>

        <form id="xtreamForm" class="provider-form">
          <div class="provider-form-intro"><div><div class="eyebrow">XTREAM CODES</div><h3>Connect your TV service</h3><p>Enter the same Xtream details you use in another IPTV player.</p></div><span class="provider-badge">Recommended</span></div>
          <div class="field"><label>Provider name</label><input name="name" value="${esc(state.provider?.type==='xtream'?state.provider?.name||'My TV':'My TV')}" placeholder="My TV" required></div>
          <div class="field"><label>Server URL</label><input name="server" type="url" value="${esc(state.provider?.type==='xtream'?state.provider?.server||'':'')}" placeholder="http://provider.example:port" required></div>
          <div class="split"><div class="field"><label>Username</label><input name="username" value="${esc(state.provider?.type==='xtream'?state.provider?.username||'':'')}" autocomplete="username" required></div><div class="field"><label>Password</label><input name="password" type="password" value="${esc(state.provider?.type==='xtream'?state.provider?.password||'':'')}" autocomplete="current-password" required></div></div>
          ${helper}
          <label class="remember-row provider-remember"><input type="checkbox" name="remember" ${state.provider?.username?'checked':''}><span><strong>Remember login on this device</strong><small>Credentials are stored locally and are not encrypted by the browser.</small></span></label>
          <button class="btn accent provider-primary" type="submit"><span>Connect Xtream</span><span>→</span></button>
        </form>

        <form id="m3uForm" class="provider-form" hidden>
          <div class="provider-form-intro"><div><div class="eyebrow">M3U PLAYLIST</div><h3>Import your playlist</h3><p>Use either a playlist URL or a local M3U/M3U8 file.</p></div></div>
          <div class="field"><label>Provider name</label><input name="name" value="${esc(state.provider?.type==='m3u'?state.provider?.name||'My TV':'My TV')}" placeholder="My TV" required></div>
          <div class="field"><label>M3U playlist URL</label><input name="url" type="url" placeholder="http://provider.example/get.php?... "></div>
          <div class="provider-or"><span>or</span></div>
          <div class="field"><label>Choose M3U file</label><input name="file" type="file" accept=".m3u,.m3u8,text/plain,application/x-mpegURL"></div>
          <div class="field"><label>TV guide / XMLTV URL <span class="optional">Optional</span></label><input name="epgUrl" type="url" value="${esc(state.provider?.type==='m3u'?state.provider?.epgUrl||'':'')}" placeholder="http://provider.example/epg.xml"></div>
          <div class="provider-note"><div class="provider-note-icon">i</div><div><strong>${NATIVE_WINDOWS?'Windows import ready':'Playlist import'}</strong><span>${NATIVE_WINDOWS?'The Windows bridge can fetch HTTP or HTTPS playlist URLs directly.':'Local files work immediately. URL imports require the playlist server to allow browser requests.'}</span></div></div>
          <button class="btn accent provider-primary" type="submit"><span>Import M3U</span><span>→</span></button>
        </form>
      </div>

      <section id="providerProgress" class="provider-progress" hidden aria-live="polite" aria-busy="true">
        <div class="provider-progress-top"><div class="provider-spinner" aria-hidden="true"></div><div><div id="providerProgressKicker" class="eyebrow">PLEASE WAIT</div><h3 id="providerProgressTitle">Connecting to your provider…</h3><p id="providerProgressDetail">Swoop is preparing your TV library. Keep this window open.</p></div></div>
        <div class="provider-progress-bar"><span id="providerProgressBar"></span></div>
        <div id="providerProgressSteps" class="provider-progress-steps"></div>
        <div id="providerProgressSummary" class="provider-progress-summary"></div>
        <div class="provider-progress-actions"><button type="button" class="btn secondary" data-provider-progress-back hidden>Back to details</button></div>
      </section>
      <div id="providerStatus" aria-live="polite"></div>
    </div>
  </div></div>`
}
function mdblistModal(){return `<div class="modal-backdrop" data-close-modal><div class="modal" data-modal-card><div class="modal-head"><h2>Add MDBList Row</h2><button class="icon-btn" data-close>✕</button></div><div class="modal-body"><form id="mdblistForm" class="form-grid"><div class="field"><label>Row name in Swoop TV</label><input name="rowName" value="My MDBList" required></div><div class="field"><label>MDBList API key</label><input name="apiKey" type="password" value="${esc(state.settings.mdblistApiKey||'')}" required></div><div class="field"><label>List ID</label><input name="listId" placeholder="e.g. 12345"></div><div class="divider"></div><p class="form-hint">Or identify the list by username + list slug/name.</p><div class="split"><div class="field"><label>Username</label><input name="username" placeholder="username"></div><div class="field"><label>List name / slug</label><input name="listName" placeholder="best-action-movies"></div></div><button class="btn accent" type="submit">Fetch & Match Catalog</button></form><div id="mdbStatus"></div></div></div></div>`}
function modalHtml(){return modal==='provider'?providerModal():mdblistModal()}
function setStatus(id,msg,type='info'){const el=document.querySelector(id);if(el)el.innerHTML=`<div class="status ${type}">${esc(msg)}</div>`}
function providerProgressStart(kind,providerName){
  const setup=document.querySelector('#providerSetup'), panel=document.querySelector('#providerProgress'), status=document.querySelector('#providerStatus');
  if(setup)setup.hidden=true;if(panel)panel.hidden=false;if(status)status.innerHTML='';
  const steps=kind==='xtream' ? [
    ['contact','Contacting provider'],['auth','Verifying Xtream login'],['live','Loading Live TV'],['movie','Loading Movies'],['series','Loading TV Shows'],['save','Building Swoop library']
  ]:[['read','Reading playlist'],['parse','Parsing channels'],['save','Building Swoop library']];
  const box=document.querySelector('#providerProgressSteps');if(box)box.innerHTML=steps.map(([id,label],i)=>`<div class="provider-progress-step" data-progress-step="${id}"><span class="step-indicator">${i+1}</span><span>${esc(label)}</span><strong></strong></div>`).join('');
  const title=document.querySelector('#providerProgressTitle');if(title)title.textContent=`Connecting to ${providerName||'your provider'}…`;
  const detail=document.querySelector('#providerProgressDetail');if(detail)detail.textContent=kind==='xtream'?'Swoop is checking your account, then loading Live TV, Movies and TV Shows. Large libraries can take a little while.':'Swoop is reading your playlist and preparing the channels for your library.';
  const summary=document.querySelector('#providerProgressSummary');if(summary)summary.innerHTML='<strong>Please wait.</strong> Keep Swoop open while this finishes.';
  providerProgressUpdate({step:steps[0][0],progress:5});
}
function providerProgressUpdate({step='',progress=0,title='',detail='',stepDetail='',done=false,error=false}={}){
  const bar=document.querySelector('#providerProgressBar');if(bar)bar.style.width=`${Math.max(0,Math.min(100,progress))}%`;
  if(title){const el=document.querySelector('#providerProgressTitle');if(el)el.textContent=title}
  if(detail){const el=document.querySelector('#providerProgressDetail');if(el)el.textContent=detail}
  document.querySelectorAll('[data-progress-step]').forEach(el=>{
    const active=el.dataset.progressStep===step; if(active)el.classList.add('active');else el.classList.remove('active');
    if(done&&!error)el.classList.add('done');
  });
  if(step){const active=document.querySelector(`[data-progress-step="${step}"]`);if(active){active.classList.add(error?'error':'active');const strong=active.querySelector('strong');if(strong&&stepDetail)strong.textContent=stepDetail}}
}
function providerProgressMark(step,detail=''){
  const el=document.querySelector(`[data-progress-step="${step}"]`);if(el){el.classList.remove('active');el.classList.add('done');const indicator=el.querySelector('.step-indicator');if(indicator)indicator.textContent='✓';const strong=el.querySelector('strong');if(strong)strong.textContent=detail}
}
function providerProgressSuccess(message){
  providerProgressUpdate({progress:100,title:'Your library is ready',detail:message});
  document.querySelectorAll('[data-progress-step]').forEach(el=>{el.classList.remove('active');el.classList.add('done');const i=el.querySelector('.step-indicator');if(i)i.textContent='✓'});
  const kicker=document.querySelector('#providerProgressKicker');if(kicker)kicker.textContent='CONNECTED';
  const spinner=document.querySelector('.provider-spinner');if(spinner){spinner.classList.add('success');spinner.textContent='✓'}
  const summary=document.querySelector('#providerProgressSummary');if(summary)summary.innerHTML='<strong>Done.</strong> Opening Swoop TV…';
}
function providerProgressError(message){
  providerProgressUpdate({progress:100,title:'Could not finish connecting',detail:message,error:true});
  const kicker=document.querySelector('#providerProgressKicker');if(kicker)kicker.textContent='CONNECTION ISSUE';
  const spinner=document.querySelector('.provider-spinner');if(spinner){spinner.classList.add('error');spinner.textContent='!'}
  const summary=document.querySelector('#providerProgressSummary');if(summary)summary.innerHTML='<strong>Your details have not been cleared.</strong> Go back, check them and try again.';
  const back=document.querySelector('[data-provider-progress-back]');if(back)back.hidden=false;
}
function providerProgressBack(){const setup=document.querySelector('#providerSetup'),panel=document.querySelector('#providerProgress');if(setup)setup.hidden=false;if(panel)panel.hidden=true;const back=document.querySelector('[data-provider-progress-back]');if(back)back.hidden=true}
function toast(msg){clearTimeout(toastTimer);document.querySelector('.toast')?.remove();const el=document.createElement('div');el.className='toast';el.textContent=msg;document.body.appendChild(el);toastTimer=setTimeout(()=>el.remove(),2200)}
function findItem(id){return activeCatalog().find(x=>x.id===id)}
function playerHtml(){
  if(NATIVE_WINDOWS)return `<div class="player-shell native-player-shell" role="dialog" aria-modal="true" aria-label="${esc(playerItem?.name||'Swoop Native Player')}"><div class="native-player-card"><div class="eyebrow">WINDOWS NATIVE PLAYER</div><h2>${esc(playerItem?.name||'')}</h2><div id="playerStatus" class="player-status">Launching native playback…</div><div id="playerMessage" class="native-player-copy">Swoop will open the stream in its native mpv playback window. Press F for fullscreen, Space to pause, and Esc or Q to close the player.</div><div class="cta-row"><button class="btn danger" data-native-stop>Stop playback</button><button class="btn secondary" data-close-player>Back to Swoop</button></div></div></div>`;
  return `<div class="player-shell" role="dialog" aria-modal="true" aria-label="${esc(playerItem?.name||'Swoop Player')}"><video id="swoopVideo" class="swoop-video" controls autoplay playsinline></video><div class="player-top"><button class="player-back" data-close-player>←</button><div><div class="player-title">${esc(playerItem?.name||'')}</div><div id="playerStatus" class="player-status">${playerItem?.kind==='live'?'Preparing live stream…':'Preparing playback…'}</div></div></div><div id="playerMessage" class="player-message" hidden></div></div>`
}
function setPlayerMessage(message,isError=false){
  const status=document.querySelector('#playerStatus'), box=document.querySelector('#playerMessage');
  if(status)status.textContent=isError?'Playback unavailable':'Loading…';
  if(box){box.hidden=false;box.classList.toggle('error',isError);box.textContent=message}
}
function stopPlayback(){
  if(NATIVE_WINDOWS) nativeStop().catch(()=>{});
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
  if(NATIVE_WINDOWS){
    try{
      const result=await nativePlay(item);
      const status=document.querySelector('#playerStatus'); if(status)status.textContent='Native player starting…';
      const msg=document.querySelector('#playerMessage'); if(msg)msg.textContent=`mpv process ${result?.pid||''} was requested. Swoop is checking that the player stays open…`;
      await new Promise(r=>setTimeout(r,1400));
      const diag=await nativeDiagnostics();
      if(diag?.playing){
        if(status)status.textContent=item.kind==='live'?'● LIVE · Native player opened':'Playing in native window';
        if(msg)msg.textContent=`Native playback is running${result?.pid?` · process ${result.pid}`:''}. Video is going directly from your provider to this PC.`;
      }else{
        const lines=Array.isArray(diag?.logTail)?diag.logTail.filter(Boolean):[];
        const tail=lines.slice(-6).join(' | ');
        const code=diag?.exitCode!==null&&diag?.exitCode!==undefined?` Exit code ${diag.exitCode}.`:'';
        setPlayerMessage(`The native player started but closed immediately.${code}${tail?` mpv: ${tail}`:' Check the Swoop TV Windows Bridge window for the launch result.'}`,true);
      }
    }catch(err){setPlayerMessage(err.message||'Could not launch the Windows native player.',true)}
    return;
  }
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
function canRelayArtwork(){return !NATIVE_WINDOWS&&Boolean(sessionRelay.url&&sessionRelay.token&&state.provider?.type==='xtream')}
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
  document.querySelectorAll('[data-native-stop]').forEach(el=>el.onclick=()=>{nativeStop().catch(()=>{});const status=document.querySelector('#playerStatus');if(status)status.textContent='Playback stopped';});
  document.querySelectorAll('[data-load-more]').forEach(el=>el.onclick=()=>{const kind=el.dataset.loadMore;viewLimits[kind]=(viewLimits[kind]||120)+(kind==='live'?180:120);render()});
  document.querySelector('[data-action="disconnect"]')?.addEventListener('click',()=>{state.catalog=[];state.provider=null;state.mdblistRows=[];sessionRelay={url:'',token:''};sessionXtream={server:'',username:'',password:'',relayUrl:'',relayToken:''};clearState();render();toast('Provider disconnected');});
  document.querySelectorAll('[data-remove-row]').forEach(el=>el.onclick=()=>{state.mdblistRows.splice(Number(el.dataset.removeRow),1);persist();render()});
  const search=document.querySelector('#searchInput');if(search)search.oninput=e=>runSearch(e.target.value);
  document.querySelectorAll('[data-provider-tab]').forEach(el=>el.onclick=()=>{document.querySelectorAll('[data-provider-tab]').forEach(x=>x.classList.toggle('active',x===el));document.querySelector('#m3uForm').hidden=el.dataset.providerTab!=='m3u';document.querySelector('#xtreamForm').hidden=el.dataset.providerTab!=='xtream';document.querySelector('#providerStatus').innerHTML='';});document.querySelector('[data-provider-progress-back]')?.addEventListener('click',providerProgressBack);
  document.querySelector('#m3uForm')?.addEventListener('submit',async e=>{
    e.preventDefault();const fd=new FormData(e.currentTarget),file=fd.get('file'),url=String(fd.get('url')||'').trim(),name=String(fd.get('name')||'M3U Provider');
    providerProgressStart('m3u',name);
    try{
      providerProgressUpdate({step:'read',progress:12,title:`Reading ${name}…`,detail:file&&file.size?'Swoop is reading the M3U file from this device.':'Swoop is downloading the playlist from your provider.'});
      let text;
      if(file&&file.size)text=await file.text();
      else if(url){if(NATIVE_WINDOWS)text=await nativeFetchText(url);else{const r=await fetch(url);if(!r.ok)throw new Error(`Playlist returned HTTP ${r.status}`);text=await r.text()}}
      else throw new Error('Choose an M3U file or enter a playlist URL.');
      providerProgressMark('read','Complete');providerProgressUpdate({step:'parse',progress:55,title:'Parsing channels…',detail:'Swoop is reading channel names, groups, logos and stream addresses.'});
      await new Promise(r=>setTimeout(r,40));
      const providerId=`m3u-${Date.now()}`,cat=parseM3U(text,providerId);if(!cat.length)throw new Error('No playable entries were found in that M3U playlist.');
      providerProgressMark('parse',`${cat.length.toLocaleString()} items`);providerProgressUpdate({step:'save',progress:86,title:'Building your Swoop library…',detail:`Preparing ${cat.length.toLocaleString()} imported items for browsing.`});
      state.catalog=cat;state.provider={id:providerId,type:'m3u',name,epgUrl:String(fd.get('epgUrl')||'')};state.mdblistRows=[];persist();
      providerProgressMark('save','Ready');providerProgressSuccess(`Imported ${cat.length.toLocaleString()} items from ${name}.`);setTimeout(()=>{modal=null;state.page='home';render();},1100)
    }catch(err){providerProgressError(err.message||String(err))}
  });
  document.querySelector('#xtreamForm')?.addEventListener('submit',async e=>{
    e.preventDefault();const fd=new FormData(e.currentTarget),relayUrl=String(fd.get('relayUrl')||'').trim(),relayToken=String(fd.get('relayToken')||''),name=String(fd.get('name')||'Xtream Provider'),cfg={server:String(fd.get('server')).trim(),username:String(fd.get('username')),password:String(fd.get('password')),relayUrl,relayToken};
    providerProgressStart('xtream',name);
    try{
      providerProgressUpdate({step:'contact',progress:7,title:`Contacting ${name}…`,detail:NATIVE_WINDOWS?'Using the Windows Native Bridge to reach your Xtream server.':relayUrl?'Using the Swoop Connection Helper to reach your Xtream server.':'Connecting directly to your Xtream server.'});
      const profile=await testXtream(cfg);providerProgressMark('contact','Reached');
      providerProgressUpdate({step:'auth',progress:18,title:'Verifying your Xtream login…',detail:'Checking that the account is active and authorised.'});
      if(String(profile?.user_info?.auth)==='0')throw new Error('Xtream account was not authorised.');
      providerProgressMark('auth','Authorised');
      providerProgressUpdate({step:'live',progress:26,title:'Loading your provider library…',detail:'Live TV, Movies and TV Shows are being loaded. Large subscriptions can take a little while.'});
      const providerId=`xtream-${Date.now()}`;
      const completedSections=new Set();
      const result=await importXtream(cfg,providerId,info=>{
        if(info?.section){
          completedSections.add(info.section);providerProgressMark(info.section,`${Number(info.count||0).toLocaleString()} items`);
          const next=['live','movie','series'].find(x=>!completedSections.has(x))||'save';
          const progress=next==='live'?30:next==='movie'?47:next==='series'?64:80;
          const nextLabel=next==='live'?'Live TV':next==='movie'?'Movies':next==='series'?'TV Shows':'your Swoop library';
          providerProgressUpdate({step:next,progress,title:next==='save'?'Provider catalog loaded — preparing Swoop…':`Loading ${nextLabel}…`,detail:next==='save'?'Swoop is now building the local library and indexes.':'The remaining sections are still loading. You can leave this window open.'});
        }
      });
      if(!result.items.length)throw new Error('Connected, but the provider returned an empty catalog.');
      providerProgressUpdate({step:'save',progress:88,title:'Building your Swoop library…',detail:'Saving the catalog and preparing it for Home, Live TV, Movies, TV Shows and Search.'});
      const remember=Boolean(fd.get('remember'));sessionRelay={url:relayUrl,token:relayToken};sessionXtream={...cfg};state.settings.xtreamRelayUrl=relayUrl;state.settings.xtreamRelayToken=remember?relayToken:'';state.catalog=result.items;state.provider={id:providerId,type:'xtream',name,server:cfg.server,connection:NATIVE_WINDOWS?'windows-native':relayUrl?'helper':'direct',relayUrl,...(remember?{username:cfg.username,password:cfg.password,relayToken}:{})};state.mdblistRows=[];persist();
      providerProgressMark('save','Ready');
      const counts=result.counts||{live:result.items.filter(x=>x.kind==='live').length,movie:result.items.filter(x=>x.kind==='movie').length,series:result.items.filter(x=>x.kind==='series').length};
      providerProgressSuccess(`${counts.live.toLocaleString()} live channels · ${counts.movie.toLocaleString()} movies · ${counts.series.toLocaleString()} TV shows`);setTimeout(()=>{modal=null;state.page='home';render();},1300)
    }catch(err){providerProgressError(err.message||String(err))}
  });
  document.querySelector('#mdblistForm')?.addEventListener('submit',async e=>{e.preventDefault();if(!state.catalog.length){setStatus('#mdbStatus','Import an IPTV catalog first so Swoop TV has something to match against.','err');return}const fd=new FormData(e.currentTarget),apiKey=String(fd.get('apiKey')||'').trim();try{setStatus('#mdbStatus','Fetching MDBList and matching it against your provider catalog…');const payload=await getMDBListItems({apiKey,listId:String(fd.get('listId')||'').trim(),username:String(fd.get('username')||'').trim(),listName:String(fd.get('listName')||'').trim()});const matched=matchMDBListToCatalog(payload,state.catalog);state.settings.mdblistApiKey=apiKey;state.mdblistRows.push({name:String(fd.get('rowName')||'MDBList'),items:matched});persist();setStatus('#mdbStatus',`Matched ${matched.length} titles from this MDBList to your provider catalog.`,'ok');setTimeout(()=>{modal=null;state.page='home';render()},650)}catch(err){setStatus('#mdbStatus',err.message||String(err),'err')}});
}

window.addEventListener('keydown',e=>{if(e.key==='Escape'&&playerItem){closePlayer();return}if(e.key==='Escape'&&modal){modal=null;render()}if((e.key==='ArrowRight'||e.key==='ArrowLeft'||e.key==='ArrowDown'||e.key==='ArrowUp')&&!['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName)){const focusables=[...document.querySelectorAll('button:not([hidden]),[tabindex="0"]')].filter(x=>x.offsetParent!==null);const i=focusables.indexOf(document.activeElement);if(i>=0){e.preventDefault();focusables[(i+(e.key==='ArrowRight'||e.key==='ArrowDown'?1:-1)+focusables.length)%focusables.length].focus()}}});
if(!NATIVE_WINDOWS&&'serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('./sw.js').catch(()=>{});
render();
