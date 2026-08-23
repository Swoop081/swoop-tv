export function nativeInfo() {
  if (typeof window === 'undefined') return null;
  const info = window.__SWOOP_NATIVE__;
  return info && info.token ? info : null;
}

export function isNativeWindows() {
  return nativeInfo()?.platform === 'windows';
}

export async function nativeRequest(path, payload = null, {expect='json', timeoutMs=45000} = {}) {
  const info = nativeInfo();
  if (!info) throw new Error('Swoop native bridge is not available.');
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(), timeoutMs);
  try {
    const res = await fetch(path, {
      method: payload === null ? 'GET' : 'POST',
      headers: payload === null ? {'x-swoop-token': info.token} : {'content-type':'application/json','x-swoop-token':info.token},
      body: payload === null ? undefined : JSON.stringify(payload),
      cache:'no-store',
      signal:controller.signal
    });
    if (!res.ok) {
      let detail='';
      try { detail=(await res.json())?.error || ''; } catch {}
      throw new Error(`Windows bridge returned HTTP ${res.status}${detail?` — ${detail}`:''}`);
    }
    if (expect === 'text') return await res.text();
    return await res.json();
  } catch (err) {
    if (err?.name === 'AbortError') throw new Error('Swoop Windows bridge timed out.');
    throw err;
  } finally { clearTimeout(timer); }
}

export async function nativePlay(item, {startSeconds=0}={}) {
  return nativeRequest('/native/play', {url:item.streamUrl,title:item.name||'Swoop TV',kind:item.kind||'video',startSeconds:Number(startSeconds||0)}, {timeoutMs:15000});
}

export async function nativeStop() {
  return nativeRequest('/native/stop', {}, {timeoutMs:10000});
}

export async function nativeDiagnostics() {
  return nativeRequest('/native/diagnostics', {}, {timeoutMs:10000});
}

export async function nativeControl(command, value=null) {
  return nativeRequest('/native/control', {command,value}, {timeoutMs:10000});
}

export async function nativeFetchText(url) {
  return nativeRequest('/native/fetch-text', {url}, {expect:'text', timeoutMs:60000});
}

export async function nativeStatus() {
  const info=nativeInfo();
  if(!info) return null;
  const res=await fetch('/native/status',{cache:'no-store'});
  if(!res.ok)return null;
  return res.json();
}

export async function nativeSwitchLive(item) {
  return nativeControl('load-url', {url:item?.streamUrl||'', title:item?.name||'Swoop TV'});
}
