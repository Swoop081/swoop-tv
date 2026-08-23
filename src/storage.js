const KEY='swoop-tv-v01';
export function loadState(){
  try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; }
}
export function saveState(state){
  try { localStorage.setItem(KEY, JSON.stringify(state)); return true; } catch { return false; }
}
export function clearState(){ try { localStorage.removeItem(KEY); } catch {} }
