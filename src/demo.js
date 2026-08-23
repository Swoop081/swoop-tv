const g=['#5843c7,#1b2351','#0e8a7c,#14233b','#a23866,#3c1738','#8846bb,#171a39','#b06a2b,#202b4a','#1c7ea3,#172441'];
function grad(i){return `linear-gradient(135deg,${g[i%g.length]})`}
export const demoCatalog = [
  ...['Swoop News','Arena Sports','World Football','Cinema One','Discovery World','Kids Central','Retro TV','Music Live'].map((name,i)=>({id:`demo:live:${i}`,providerId:'demo',source:'demo',kind:'live',name,group:i<3?'Live & Sports':'Entertainment',logo:'',tvgId:'',streamUrl:'',demoColor:grad(i)})),
  ...['Signal Run','Midnight Protocol','The Last Horizon','Velocity','The Long Way Home','Northbound','Afterlight','Zero Hour','Atlas Falling','Cold Harbour'].map((name,i)=>({id:`demo:movie:${i}`,providerId:'demo',source:'demo',kind:'movie',name,group:i<4?'Action':'Movies',year:String(2017+i%8),rating:(7.1+(i%6)/10).toFixed(1),streamUrl:'',demoColor:grad(i+2)})),
  ...['The District','Terminal','Blackwater','First Response','Redline','Outer Range','Vanguard','The Archive'].map((name,i)=>({id:`demo:series:${i}`,providerId:'demo',source:'demo',kind:'series',name,group:i<4?'Drama':'Series',year:String(2019+i%6),rating:(7.4+(i%5)/10).toFixed(1),streamUrl:'',demoColor:grad(i+4)})),
];
