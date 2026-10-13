// Shared catalogue identity helpers. Playback URL construction remains in app.js.
function canonicalVodTitle(raw){
 let t=String(raw||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
 // Strip provider language, quality, and platform prefixes only at the start.
 t=t.replace(/^(?:(?:4k|8k|uhd|hdr|dv|nf|netflix|dsnp|disney|amzn|prime|hbo|en|eng|de|fr|es|it|pt|us|uk|multi|top)(?:[\s._:-]|$))+/i,"");
 t=t.replace(/\s*\((?:us|uk|en|eng|de|fr|es|it|pt|4k|8k|uhd|hdr|dv)\)\s*/gi," ");
 t=t.replace(/\b(?:19|20)\d{2}\b.*$/,"");
 t=t.replace(/(?:\s|^)(?:(?:4k|8k|uhd|hdr|dv|dolby vision|1080p|2160p|720p|hevc|h265|prime|apple tv\+?)\s*)+$/gi,"");
 return t.replace(/[^a-z0-9]+/g," ").trim().replace(/\s+/g," ");
}
function canonicalVodYear(e){return String(e.year||e.metadata?.releaseDate||e.name||"").match(/\b(?:19|20)\d{2}\b/)?.[0]||""}
