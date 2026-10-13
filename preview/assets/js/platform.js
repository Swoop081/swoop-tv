// SwoopTV platform detection. Shared by phone, TV and desktop shells.
// Playback routing stays in app.js and is intentionally unchanged.
(function(){
 const ua=navigator.userAgent||"";
 const ios=/iPhone|iPad|iPod/i.test(ua)||(navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1);
 const android=/Android/i.test(ua);
 const tv=/Android TV|Google TV|AFT[A-Z0-9]+|SMART-TV|SmartTV|Tizen|Web0S|webOS/i.test(ua);
 const desktop=!ios&&!android&&!tv;
 window.SwoopPlatform=Object.freeze({ios,android,tv,desktop,kind:tv?"tv":ios?"ios":android?"android":"desktop"});
})();
