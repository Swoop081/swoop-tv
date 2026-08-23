function cleanChannelName(value=''){
  return String(value||'').toLowerCase()
    .replace(/\b(?:uhd|fhd|hd|sd|4k|1080p|1080i|720p|576p|576i|50fps|60fps)\b/g,' ')
    .replace(/^[a-z]{2,5}\s*[-|:]\s*/,'')
    .replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
}
function cleanGroup(value=''){return String(value||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim()}
function qualityScore(item={}){const h=`${item.name||''} ${item.group||''}`.toLowerCase();if(/\b(?:4k|uhd|2160p)\b/.test(h))return 40;if(/\b(?:fhd|1080p|1080i)\b/.test(h))return 30;if(/\b(?:hd|720p)\b/.test(h))return 20;if(/\bsd\b/.test(h))return 5;return 12}
export function buildLiveStackIndex(catalog=[],providerPriority={}){
  const live=catalog.filter(x=>x?.kind==='live'),groups=new Map(),singles=[];
  for(const item of live){
    const tvg=String(item.tvgId||item.epgChannelId||'').trim().toLowerCase();
    const name=cleanChannelName(item.name),group=cleanGroup(item.group);
    const key=tvg?`epg:${tvg}`:(name&&group?`name:${name}|${group}`:'');
    if(!key){singles.push(item);continue}
    if(!groups.has(key))groups.set(key,[]);groups.get(key).push(item);
  }
  const stacked=[...singles],bySourceId=new Map(),byStackId=new Map();
  const rank=(a,b)=>{
    const pa=Number(providerPriority[a.providerId]??999),pb=Number(providerPriority[b.providerId]??999);
    const qa=qualityScore(a),qb=qualityScore(b);if(qb!==qa)return qb-qa;if(pa!==pb)return pa-pb;return String(a.name||'').localeCompare(String(b.name||''));
  };
  for(const [key,list] of groups){
    if(list.length===1){stacked.push(list[0]);bySourceId.set(list[0].id,list[0]);continue}
    const sources=[...list].sort(rank),primary=sources[0];
    const stack={...primary,id:`stack:live:${encodeURIComponent(key)}`,sources,sourceCount:sources.length,_stackedLive:true,_primarySourceId:primary.id,_stackConfidence:key.startsWith('epg:')?'EPG channel ID':'exact channel + group'};
    stacked.push(stack);byStackId.set(stack.id,stack);for(const src of sources)bySourceId.set(src.id,stack);
  }
  return {stacked,bySourceId,byStackId};
}
export function selectLiveSource(item={},providerPriority={}){
  if(!Array.isArray(item.sources)||!item.sources.length)return item;
  const sources=[...item.sources].sort((a,b)=>{
    const pa=Number(providerPriority[a.providerId]??999),pb=Number(providerPriority[b.providerId]??999);
    const qa=qualityScore(a),qb=qualityScore(b);if(qb!==qa)return qb-qa;return pa-pb;
  });
  const source=sources[0];return {...item,...source,id:item.id,name:item.name,sources:item.sources,sourceCount:item.sourceCount,_selectedLiveSourceId:source.id,_selectedLiveProviderId:source.providerId};
}
