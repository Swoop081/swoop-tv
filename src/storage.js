const STATE_KEY='swoop-tv-state-v029';
const LEGACY_KEY='swoop-tv-v01';
const PROFILE_KEY='swoop-tv-provider-profile-v1';
const DB_NAME='swoop-tv-storage';
const DB_VERSION=1;
const STORE='data';

function safeParse(value){
  try{return value?JSON.parse(value):null}catch{return null}
}

function openDb(){
  return new Promise((resolve,reject)=>{
    if(!('indexedDB' in globalThis)){reject(new Error('IndexedDB unavailable'));return}
    const req=indexedDB.open(DB_NAME,DB_VERSION);
    req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE)};
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error||new Error('Could not open Swoop storage'));
  });
}

async function idbPut(key,value){
  const db=await openDb();
  try{await new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put(value,key);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error||new Error('Could not save Swoop library'));tx.onabort=()=>reject(tx.error||new Error('Swoop storage transaction aborted'))})}finally{db.close()}
}

async function idbGet(key){
  const db=await openDb();
  try{return await new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readonly');const req=tx.objectStore(STORE).get(key);req.onsuccess=()=>resolve(req.result??null);req.onerror=()=>reject(req.error||new Error('Could not restore Swoop library'))})}finally{db.close()}
}

async function idbDelete(key){
  try{const db=await openDb();try{await new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).delete(key);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error)})}finally{db.close()}}catch{}
}

function compactRows(rows=[]){
  return Array.isArray(rows)?rows.map(r=>({...r,items:[]})):[];
}

function lightweightState(state){
  return {
    ...state,
    catalog:[],
    webDiscovery:{},
    metadataCache:{},
    mdblistRows:compactRows(state?.mdblistRows||[]),
    page:'home'
  };
}

function bulkState(state){
  return {
    catalog:Array.isArray(state?.catalog)?state.catalog:[],
    webDiscovery:state?.webDiscovery&&typeof state.webDiscovery==='object'?state.webDiscovery:{},
    metadataCache:state?.metadataCache&&typeof state.metadataCache==='object'?state.metadataCache:{},
    mdblistRows:Array.isArray(state?.mdblistRows)?state.mdblistRows:[],
    savedAt:Date.now()
  };
}

export function loadState(){
  try{
    const current=safeParse(localStorage.getItem(STATE_KEY));
    if(current)return current;
    return safeParse(localStorage.getItem(LEGACY_KEY));
  }catch{return null}
}

export async function loadBulkState(){
  try{return await idbGet('bulk')}catch{return null}
}

export function loadProviderProfile(){
  try{return safeParse(localStorage.getItem(PROFILE_KEY))||null}catch{return null}
}

export function saveProviderProfile(profile){
  try{localStorage.setItem(PROFILE_KEY,JSON.stringify({...profile,savedAt:Date.now()}));return true}catch{return false}
}

export function clearProviderProfile(){
  try{localStorage.removeItem(PROFILE_KEY)}catch{}
}

export function saveState(state){
  try{localStorage.setItem(STATE_KEY,JSON.stringify(lightweightState(state)));return true}catch{return false}
}

export async function saveBulkState(state){
  try{
    await idbPut('bulk',bulkState(state));
    try{localStorage.removeItem(LEGACY_KEY)}catch{}
    return true;
  }catch{return false}
}

export function clearState(){
  try{localStorage.removeItem(STATE_KEY);localStorage.removeItem(LEGACY_KEY)}catch{}
  clearProviderProfile();
  idbDelete('bulk');
}
