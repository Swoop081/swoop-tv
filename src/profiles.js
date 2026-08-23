export const PROFILE_AVATARS=[
  {id:'cyan',label:'Cyan',glyph:'S',gradient:'linear-gradient(135deg,#24d6bd,#3186ff)'},
  {id:'violet',label:'Violet',glyph:'◆',gradient:'linear-gradient(135deg,#795cff,#d55cff)'},
  {id:'sunset',label:'Sunset',glyph:'●',gradient:'linear-gradient(135deg,#ff6b6b,#ffbd55)'},
  {id:'ocean',label:'Ocean',glyph:'≈',gradient:'linear-gradient(135deg,#1a93ff,#20e1d0)'},
  {id:'lime',label:'Lime',glyph:'▲',gradient:'linear-gradient(135deg,#b7ef42,#31c577)'},
  {id:'rose',label:'Rose',glyph:'♥',gradient:'linear-gradient(135deg,#ff4d91,#a85cff)'},
  {id:'gold',label:'Gold',glyph:'★',gradient:'linear-gradient(135deg,#ffc247,#ff7b32)'},
  {id:'kids',label:'Kids',glyph:'☺',gradient:'linear-gradient(135deg,#4ad7ff,#8bff8f)'}
];

export function avatarById(id='cyan'){return PROFILE_AVATARS.find(x=>x.id===id)||PROFILE_AVATARS[0]}

export function makeProfile({id='',name='Profile',avatar='cyan',kids=false,pinHash='',pinSalt='',myList=[],continueWatching=[],watchHistory=[],recentLive=[],liveFavourites=[],profileSettings={}}={}){
  return {
    id:id||`profile-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
    name:String(name||'Profile').trim().slice(0,24)||'Profile',
    avatar:avatarById(avatar).id,
    kids:Boolean(kids),
    pinHash:String(pinHash||''),
    pinSalt:String(pinSalt||''),
    myList:Array.isArray(myList)?myList:[],
    continueWatching:Array.isArray(continueWatching)?continueWatching:[],
    watchHistory:Array.isArray(watchHistory)?watchHistory:[],
    recentLive:Array.isArray(recentLive)?recentLive:[],
    liveFavourites:Array.isArray(liveFavourites)?liveFavourites:[],
    profileSettings:profileSettings&&typeof profileSettings==='object'?{...profileSettings}:{},
    createdAt:Date.now()
  };
}

export function normalizeProfile(profile={},defaults={}){
  const p=makeProfile({...defaults,...profile,id:profile.id||defaults.id});
  p.createdAt=Number(profile.createdAt||p.createdAt);
  return p;
}

function certificationToken(item={}){
  const certification=String(item.certification||item.ratingCode||item.contentRating||'').toUpperCase().replace(/\s+/g,'');
  return certification;
}

export function profileAllowsMedia(profile,item,metadata={}){
  if(!profile?.kids)return true;
  const text=`${item?.name||''} ${item?.group||''} ${item?.genre||''} ${metadata?.genres||''}`.toLowerCase();
  if(/\b(adult|xxx|18\+|porn|erotic|playboy|explicit)\b/.test(text))return false;
  const cert=certificationToken({...item,...metadata});
  if(!cert)return true;
  const blocked=['M','MA15+','MA15','R18+','R18','X18+','X18','R','NC-17','NC17','TV-14','TV14','TV-MA','TVMA','18','15'];
  return !blocked.includes(cert);
}

export function profileGenreAffinity(history=[],resolveItem=()=>null,resolveGenres=()=>[]){
  const scores=new Map();
  history.slice(0,30).forEach((entry,index)=>{
    const item=resolveItem(entry?.id)||entry?.item||entry;
    const weight=Math.max(.3,1.8-index*.045);
    for(const genre of resolveGenres(item)||[]){const key=String(genre||'').toLowerCase().trim();if(key)scores.set(key,(scores.get(key)||0)+weight)}
  });
  return scores;
}

export function smartRankRows(defs=[],affinity=new Map()){
  const fixed=new Map([['continue',120],['recently-watched',110],['recommended',105],['because-you-watched',100],['recent-live',92],['mylist',88],['top20-movies',80],['top20-shows',79],['trending-movies',76],['trending-shows',75]]);
  return defs.map((def,index)=>{
    let score=fixed.get(def.id)??Math.max(0,55-index*.1);
    const label=`${def.label||''} ${def.id||''}`.toLowerCase();
    for(const [genre,value] of affinity){if(label.includes(genre))score+=value*7}
    return {def,index,score};
  }).sort((a,b)=>b.score-a.score||a.index-b.index).map(x=>x.def);
}
