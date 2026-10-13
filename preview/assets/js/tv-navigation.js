// Remote-control navigation for SwoopTV TV shells.
// No stream selection, playback URL or player code is modified.
(function(){
 const platform=window.SwoopPlatform;
 if(!platform?.tv)return;
 document.documentElement.classList.add("swoop-tv-mode");
 const selector='button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
 const focusables=()=>Array.from(document.querySelectorAll(selector)).filter(el=>{
  const r=el.getBoundingClientRect(),style=getComputedStyle(el);
  return r.width>0&&r.height>0&&style.visibility!=="hidden"&&style.display!=="none";
 });
 function move(key){
  const items=focusables(),active=document.activeElement;
  if(!items.length)return;
  if(!items.includes(active)){items[0].focus();return}
  const r=active.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2;
  const horizontal=key==="ArrowLeft"||key==="ArrowRight",positive=key==="ArrowRight"||key==="ArrowDown";
  const candidates=items.filter(el=>el!==active).map(el=>{
   const b=el.getBoundingClientRect(),dx=b.left+b.width/2-cx,dy=b.top+b.height/2-cy;
   const primary=horizontal?dx:dy,secondary=horizontal?dy:dx;
   return {el,primary,secondary};
  }).filter(x=>positive?x.primary>3:x.primary< -3).sort((a,b)=>{
   const score=x=>Math.abs(x.primary)+Math.abs(x.secondary)*2.5;
   return score(a)-score(b);
  });
  if(candidates[0]){candidates[0].el.focus({preventScroll:true});candidates[0].el.scrollIntoView({block:"nearest",inline:"nearest",behavior:"smooth"})}
 }
 document.addEventListener("keydown",event=>{
  const tag=document.activeElement?.tagName;
  if(["INPUT","TEXTAREA","SELECT"].includes(tag))return;
  if(["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(event.key)){
   event.preventDefault();move(event.key);
  }else if(event.key==="Enter"&&document.activeElement?.matches("button")){
   // Native button Enter behaviour is already provided by the browser.
  }else if(event.key==="Escape"||event.key==="Backspace"){
   if(event.target===document.body||event.target===document.documentElement){
    const back=document.querySelector('[data-back],#backbutton,.back-button');
    if(back){event.preventDefault();back.click()}
   }
  }
 });
 window.addEventListener("load",()=>{if(document.activeElement===document.body)focusables()[0]?.focus({preventScroll:true})});
})();
