#!/usr/bin/env python3
"""SwoopTV catalogue sync. Secrets are read from the environment, never exported."""
import os,json,re,time,urllib.request,urllib.parse,urllib.error,datetime,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/"swooptv-curated.json"
def request(url,headers=None):
    req=urllib.request.Request(url,headers={"User-Agent":"SwoopTV-Catalogue-Sync/1.0",**(headers or {})})
    with urllib.request.urlopen(req,timeout=90) as response:return json.load(response)
def norm(value):
    return re.sub(r"[^a-z0-9]+", " ", str(value or "").lower()).strip()
def year(value):
    m=re.search(r"\b(?:19|20)\d{2}\b",str(value or ""))
    return m.group() if m else ""
def legacy_title_key(value):
    name=str(value or "")
    name=re.sub(r"^(?:(?:[a-z]{2,5}\s*[:|]\s*)|(?:netflix|disney\+?|amazon|prime|apple\s*tv|hbo|max|hulu|nf|dsnp|4k|8k|uhd|hdr|dv|multi|eng|en)\s*[:|._ -]+)+","",name,flags=re.I)
    name=re.sub(r"\b(?:19|20)\d{2}\b|\b(?:1080p|2160p|720p|4k|hdr|dolby vision|multi[- ]?subs?|season\s*\d+|s\d{1,2}\s*e\d{1,3}|complete)\b"," ",name,flags=re.I)
    name=re.sub(r"\\b(?:s(?:eason)?\\s*0?[1-9][0-9]?|series\\s*0?[1-9][0-9]?|(?:dubbed|subbed|dual audio|english dubbed))\\b"," ",name,flags=re.I)
    name=re.sub(r"\\s*\\[[^]]*(?:1080|2160|4k|sub|dub|netflix)[^]]*\\]"," ",name,flags=re.I)
    return norm(name)
def legacy_key(name,yr=""):
    return legacy_title_key(name),str(yr or year(name))
def legacy_variants(name):
    values={legacy_title_key(name)}
    for sep in (" | "," : "," - "):
        parts=str(name or "").split(sep)
        if len(parts)>1:values.add(legacy_title_key(parts[-1]))
    return {v for v in values if len(v)>2}

def title_key(value):
    return norm(value)

def key(name,yr=""):
    return title_key(name),str(yr or year(name))

def variants(name):
    return {title_key(name)}

def title_in_listing(title,listing):
    """Match complete title as a contiguous word sequence, anywhere in a listing.

    Does not depend on a maintained list of provider prefixes or suffixes.
    Short or generic titles require an exact normalized name or a TMDb ID.
    """
    target=title_key(title)
    source=title_key(listing)
    if not target or not source:return False
    if target==source:return True
    words=target.split()
    if len(target)<4:return False
    return (" "+target+" ") in (" "+source+" ")

def lookup(t,title,yr,tmdb,indices):
    by_tmdb,by_name,by_title,_=indices[t]
    if tmdb and by_tmdb.get(str(tmdb)):
        return by_tmdb[str(tmdb)]
    exact=by_name.get(key(title,yr),[])
    if exact:return exact
    matches={}
    for x in indices[t][3]:
        provider_year=year(x.get("name"))
        if yr and provider_year and provider_year!=str(yr):continue
        if not title_in_listing(title,x.get("name")):continue
        sid=str(x.get("series_id" if t=="series" else "stream_id"))
        matches[sid]=x
    if matches:return list(matches.values())
    # Conservative compatibility fallback: existing provider naming conventions
    # must not disappear when the new full-title matcher cannot resolve them.
    for x in indices[t][3]:
        provider_year=year(x.get("name"))
        if yr and provider_year and provider_year!=str(yr):continue
        if legacy_title_key(x.get("name")) not in legacy_variants(title):continue
        sid=str(x.get("series_id" if t=="series" else "stream_id"))
        matches[sid]=x
    return list(matches.values())

def match_diagnostics(t,rows,indices):
    # Print a bounded sample for auditing without exposing provider credentials.
    by_tmdb,by_name,by_title,_=indices[t]
    misses=[]
    for row in rows:
        v=row.get("movie") or row.get("show") or row
        title=v.get("title") or v.get("name") or row.get("title") or row.get("name")
        if not title:continue
        yr=str(v.get("year") or v.get("release_year") or row.get("year") or "")
        tmdb=(v.get("ids") or {}).get("tmdb") or v.get("tmdb_id") or v.get("tmdbid") or row.get("tmdb_id")
        if not lookup(t,title,yr,tmdb,indices):misses.append(str(title)+" ("+yr+")")
    print("MDBList unmatched",t,":",len(misses),"sample:",json.dumps(misses[:30],ensure_ascii=False))

def refresh_mdblist(updated,available,indices,record,identity):
    api_key=os.getenv("SWOOP_MDBLIST_API_KEY","").strip()
    if not api_key:
        print("MDBList: SWOOP_MDBLIST_API_KEY not configured; keeping existing curated lists.")
        return
    presets=[("movie","Trending Movies","snoak","trending-movies"),("series","Trending TV Shows","snoak","trakt-s-trending-shows")]
    for t,name,user,slug in presets:
        try:
            rows=[]
            for offset in range(0,2000,100):
                url="https://api.mdblist.com/lists/"+user+"/"+slug+"/items?"+urllib.parse.urlencode({"apikey":api_key,"limit":100,"offset":offset})
                data=request(url)
                batch=data if isinstance(data,list) else data.get("items",data.get("movies",[])+data.get("shows",[]))
                if not isinstance(batch,list):raise ValueError("Unexpected MDBList items")
                rows.extend(batch)
                if len(batch)<100:break
            if not rows:raise ValueError("MDBList returned no titles")
            prior=next((g for g in updated if g.get("type")==t and g.get("name","").lower()==name.lower()),None)
            previous={key(e.get("name"),e.get("year")):e for e in (prior or {}).get("entries",[])}
            entries=[];seen=set()
            for row in rows:
                v=row.get("movie") or row.get("show") or row
                title=v.get("title") or v.get("name") or row.get("title") or row.get("name")
                if not title:continue
                yr=str(v.get("year") or v.get("release_year") or row.get("year") or "")
                tmdb=(v.get("ids") or {}).get("tmdb") or v.get("tmdb_id") or v.get("tmdbid") or row.get("tmdb_id")
                candidates=lookup(t,title,yr,tmdb,indices)
                if not candidates:continue
                k=key(title,yr)
                if k in seen:continue
                seen.add(k)
                e=record(candidates[0],t);e["name"]=title;e["year"]=yr
                e["streams"]=[{"id":identity(x,t),"ext":x.get("container_extension") or "mp4","name":x.get("name") or ""} for x in candidates]
                prior_entry=previous.get(k)
                if prior_entry:e["metadata"]={**e["metadata"],**(prior_entry.get("metadata") or {})}
                if tmdb:e["metadata"]["tmdbId"]=tmdb
                entries.append(e)
            if not entries:raise ValueError("No provider matches; preserving previous "+name)
            group={"id":prior["id"] if prior else "mdblist-"+("movies" if t=="movie" else "shows"),"name":name,"type":t,"entries":entries}
            updated[:]=[g for g in updated if not(g.get("type")==t and g.get("name","").lower()==name.lower())]
            updated.append(group)
            print("MDBList",name,":",len(entries),"available titles of",len(rows))
            match_diagnostics(t,rows,indices)
        except Exception as exc:
            print("MDBList",name,"failed; preserving prior collection:",type(exc).__name__,str(exc).split("?")[0],file=sys.stderr)

def enrich_tmdb(updated):
    token=os.getenv("SWOOP_TMDB_READ_TOKEN","").strip()
    if not token:
        print("TMDb: SWOOP_TMDB_READ_TOKEN not configured; preserving existing metadata.")
        return
    headers={"Authorization":"Bearer "+token}
    cache={}
    remaining=int(os.getenv("SWOOP_TMDB_MAX_PER_RUN","180"))
    total=0
    for g in sorted(updated,key=lambda g: 0 if g.get("name")=="Trending TV Shows" else 1 if g.get("name")=="Trending Movies" else 2):
        t=g.get("type")
        if t not in ("movie","series"):continue
        for e in g.get("entries",[]):
            m=e.setdefault("metadata",{})
            if m.get("cast") and any(p.get("profile") for p in m.get("cast",[]) if isinstance(p,dict)) and m.get("poster") and m.get("tmdbId") and m.get("backdrop"):continue
            ident=(t,key(e.get("name"),e.get("year")))
            if ident in cache:
                e["metadata"]={**m,**cache[ident]}
                continue
            if remaining<=0:continue
            endpoint="movie" if t=="movie" else "tv"
            tmdb=m.get("tmdbId")
            try:
                if not tmdb:
                    query=urllib.parse.urlencode({"query":e.get("name",""),"language":"en-US"})
                    found=request("https://api.themoviedb.org/3/search/"+endpoint+"?"+query,headers)
                    results=found.get("results",[])
                    yr=str(e.get("year") or "")
                    matched=next((x for x in results if yr and str(x.get("release_date") or x.get("first_air_date") or "").startswith(yr)),None)
                    chosen=matched or (results[0] if results else None)
                    if not chosen:
                        remaining-=1
                        continue
                    tmdb=chosen["id"]
                try:
                    details=request("https://api.themoviedb.org/3/"+endpoint+"/"+str(tmdb)+"?append_to_response=credits,images&language=en-US",headers)
                except urllib.error.HTTPError as err:
                    if err.code not in (400,404) or not m.get("tmdbId"):raise
                    # Provider TMDb IDs can be stale or belong to a different media type.
                    query=urllib.parse.urlencode({"query":e.get("name",""),"language":"en-US"})
                    candidates=request("https://api.themoviedb.org/3/search/"+endpoint+"?"+query,headers).get("results",[])
                    chosen=next((v for v in candidates if str(v.get("release_date") or v.get("first_air_date") or "").startswith(str(e.get("year"))) and e.get("year")),None) or (candidates[0] if candidates else None)
                    if not chosen:raise
                    tmdb=chosen["id"]
                    details=request("https://api.themoviedb.org/3/"+endpoint+"/"+str(tmdb)+"?append_to_response=credits,images&language=en-US",headers)
                cast=[{"id":p.get("id"),"name":p.get("name"),"character":p.get("character",""),"profile":"https://image.tmdb.org/t/p/w185"+p["profile_path"] if p.get("profile_path") else ""} for p in details.get("credits",{}).get("cast",[])[:35] if p.get("name")]
                images=details.get("images") or {}
                logos=images.get("logos") or []
                logo=next((x for x in logos if x.get("iso_639_1")=="en"),logos[0] if logos else None)
                enriched={"tmdbId":tmdb,"cast":cast,"poster":"https://image.tmdb.org/t/p/w500"+details["poster_path"] if details.get("poster_path") else m.get("poster",""),"backdrop":"https://image.tmdb.org/t/p/w1280"+details["backdrop_path"] if details.get("backdrop_path") else m.get("backdrop",""),"overview":details.get("overview") or m.get("overview","")}
                if logo and logo.get("file_path"):enriched["logo"]="https://image.tmdb.org/t/p/w500"+logo["file_path"]
                e["metadata"]={**m,**enriched};cache[ident]=enriched;total+=1;remaining-=1
            except Exception as exc:
                remaining-=1
                print("TMDb enrichment skipped",t,str(e.get("name",""))[:70],type(exc).__name__,getattr(exc,"code",""),file=sys.stderr)
    # Propagate newly enriched cast and artwork to all rails, including Asian Series.
    known={}
    for g in updated:
        if g.get("type") not in ("movie","series"):continue
        for e in g.get("entries",[]):
            m=e.get("metadata") or {}
            if m.get("cast"):known[(g["type"],key(e.get("name"),e.get("year")))]=m
    for g in updated:
        if g.get("type") not in ("movie","series"):continue
        for e in g.get("entries",[]):
            m=known.get((g["type"],key(e.get("name"),e.get("year"))))
            if m:e["metadata"]={**e.get("metadata",{}),**m}
    print("TMDb enriched",total,"titles this run; remaining budget",remaining)

def main():
    base=os.getenv("SWOOP_XTREAM_URL","").rstrip("/")
    user=os.getenv("SWOOP_XTREAM_USER","")
    password=os.getenv("SWOOP_XTREAM_PASSWORD","")
    if not all((base,user,password)):raise RuntimeError("Missing SWOOP_XTREAM_URL / USER / PASSWORD secrets. No changes published.")
    if not base.startswith("https://"):raise RuntimeError("Provider URL must use HTTPS.")
    def api(action):
        params=urllib.parse.urlencode({"username":user,"password":password,"action":action})
        result=request(base+"/player_api.php?"+params)
        if not isinstance(result,list):raise RuntimeError("Unexpected provider response for "+action)
        return result
    # Fetch all data before touching the published catalogue. Fail closed.
    vod=api("get_vod_streams");series=api("get_series");cats=api("get_series_categories");movie_cats=api("get_vod_categories")
    if not vod or not series:raise RuntimeError("Provider returned empty movie or series catalogue; preserving published file.")
    print("Provider snapshot:",len(vod),"movies,",len(series),"series")
    old=json.loads(OUT.read_text()) if OUT.exists() and OUT.stat().st_size else {"format":"swooptv-curated-v1","version":2,"categories":[]}
    if old.get("format")!="swooptv-curated-v1":raise RuntimeError("Unknown published catalogue format")
    groups=old.get("categories",[])
    def identity(x,t):return str(x.get("stream_id" if t=="movie" else "series_id") or "")
    available={t:{identity(x,t):x for x in rows if identity(x,t)} for t,rows in [("movie",vod),("series",series)]}
    def record(x,t):
        sid=identity(x,t)
        return {"name":x.get("name") or "Untitled","year":year(x.get("name")),"streams":[{"id":sid,"ext":x.get("container_extension") or "mp4","name":x.get("name") or ""}],"metadata":{"tmdbId":x.get("tmdb_id") or None,"poster":x.get("stream_icon") or x.get("cover") or x.get("cover_big") or "","backdrop":x.get("backdrop_path") or "","overview":x.get("plot") or ""},"added":int(x.get("added") or x.get("last_modified") or 0)}
    # Match published lists against current provider by stream ID, TMDb ID, or title+year.
    indices={}
    for t in ("movie","series"):
        by_tmdb={};by_name={};by_title={}
        for x in available[t].values():
            if x.get("tmdb_id"):by_tmdb.setdefault(str(x["tmdb_id"]),[]).append(x)
            by_name.setdefault(key(x.get("name"),year(x.get("name"))),[]).append(x)
            for v in variants(x.get("name")):by_title.setdefault(v,[]).append(x)
        indices[t]=(by_tmdb,by_name,by_title,list(available[t].values()))
    def match(e,t):
        ids={str(s.get("id")) for s in e.get("streams",[]) if s.get("id")}
        found=[available[t][sid] for sid in ids if sid in available[t]]
        if not found:
            tmdb=str((e.get("metadata") or {}).get("tmdbId") or "")
            found=lookup(t,e.get("name"),e.get("year"),tmdb,indices)
        return found
    def reconcile(e,t):
        found=match(e,t)
        if not found:return None
        copy=dict(e)
        copy["streams"]=[{"id":identity(x,t),"ext":x.get("container_extension") or "mp4","name":x.get("name") or ""} for x in found]
        return copy
    updated=[]
    for g in groups:
        if g.get("type") not in ("movie","series"):
            updated.append(g);continue
        if g.get("id") in ("recently-added","asian-series","new-movies-netflix","new-series-netflix"):continue
        entries=[r for e in g.get("entries",[]) if (r:=reconcile(e,g["type"]))]
        updated.append({**g,"entries":entries})
    def consolidate(entries):
        """Merge alternate provider versions into one title with selectable sources."""
        merged={}
        for e in entries:
            m=e.get("metadata") or {}
            tmdb=str(m.get("tmdbId") or "").strip()
            title=title_key(e.get("name"))
            yr=str(e.get("year") or year(e.get("name")) or "")
            ident=("tmdb",tmdb) if tmdb else ("title",title,yr)
            if not title and not tmdb:continue
            if ident not in merged:
                merged[ident]={**e,"streams":list(e.get("streams") or [])}
            else:
                target=merged[ident]
                ids={str(st.get("id")) for st in target["streams"]}
                target["streams"].extend(st for st in e.get("streams",[]) if str(st.get("id")) not in ids)
                for k,v in m.items():
                    if not (target.get("metadata") or {}).get(k) and v not in (None,"",[]):target.setdefault("metadata",{})[k]=v
                target["added"]=max(int(target.get("added") or 0),int(e.get("added") or 0))
        return list(merged.values())
    def recent(t):
        rows=sorted(available[t].values(),key=lambda x:(int(x.get("added") or x.get("last_modified") or 0),int(identity(x,t))),reverse=True)
        previous=next((g.get("entries",[]) for g in groups if g.get("type")==t and g.get("id")=="recently-added"),[])
        old_by_id={str(s.get("id")):e for e in previous for s in e.get("streams",[])}
        entries=[]
        for x in rows:
            e=record(x,t);prior=old_by_id.get(identity(x,t))
            if prior:e["metadata"]={**e["metadata"],**(prior.get("metadata") or {})}
            entries.append(e)
        return {"id":"recently-added","name":"Recently Added","type":t,"entries":consolidate(entries)[:200]}
    updated.extend([recent("movie"),recent("series")])
    # Automatically collect Netflix movie categories; use provider-added timestamps.
    netflix_names=[
        "NETFLIX DOCU-MOVIES","NETFLIX HEVC","NETFLIX KIDS",
        "NETFLIX KIDS 4K 3840P DOLBY VISION","NETFLIX MOVIES",
        "NETFLIX MOVIES 4K 3840P DOLBY VISION",
        "NETFLIX MOVIES DOLBY AUDIO","NETFLIX MUSIC",
        "NETFLIX STAND-UP COMEDY"
    ]
    netflix_ids={str(c.get("category_id")) for c in movie_cats if norm(c.get("category_name")) in {norm(n) for n in netflix_names}}
    if not netflix_ids:raise RuntimeError("Netflix movie provider categories not found; preserving published catalogue.")
    netflix_rows=[x for x in vod if str(x.get("category_id")) in netflix_ids or any(str(i) in netflix_ids for i in x.get("category_ids",[]) or [])]
    prior_netflix=next((g.get("entries",[]) for g in groups if g.get("type")=="movie" and g.get("id")=="new-movies-netflix"),[])
    if not netflix_rows and prior_netflix:raise RuntimeError("Netflix movie categories unexpectedly empty; preserving catalogue.")
    old_netflix={str(st.get("id")):e for e in prior_netflix for st in e.get("streams",[])}
    netflix_entries={}
    for x in sorted(netflix_rows,key=lambda x:(int(x.get("added") or x.get("last_modified") or 0),identity(x,"movie")),reverse=True):
        sid=identity(x,"movie");tmdb=str(x.get("tmdb_id") or "")
        title=title_key(x.get("name"));yr=year(x.get("name"))
        ident=("tmdb",tmdb) if tmdb else ("title",title,yr)
        e=netflix_entries.get(ident)
        if e is None:
            e=record(x,"movie")
            previous=old_netflix.get(sid)
            if previous:
                e["metadata"]={**e["metadata"],**{k:v for k,v in (previous.get("metadata") or {}).items() if v not in (None,"",[])}}
            netflix_entries[ident]=e
        elif sid not in {st["id"] for st in e["streams"]}:
            e["streams"].append(record(x,"movie")["streams"][0])
    updated.append({"id":"new-movies-netflix","name":"New Movies on Netflix","type":"movie","entries":list(netflix_entries.values())})
    print("New Movies on Netflix:",len(netflix_entries),"titles from",len(netflix_rows),"provider streams across",len(netflix_ids),"categories")
    # Netflix series discovery excludes Anime and Asia (Asia stays in its own rail).
    netflix_series_names=[
        "NETFLIX SERIES","NETFLIX ADULT-SWIM","NETFLIX DOCU-SERIES",
        "NETFLIX KIDS","NETFLIX KIDS 4K 3840P DOLBY VISION",
        "NETFLIX PODCAST","NETFLIX REALITY",
        "NETFLIX SERIES 4K 3840P DOLBY VISION",
        "NETFLIX SERIES DOLBY AUDIO","NETFLIX STAND-UP COMEDY"
    ]
    netflix_series_wanted={norm(n) for n in netflix_series_names}
    netflix_series_ids={str(c.get("category_id")) for c in cats if norm(c.get("category_name")) in netflix_series_wanted}
    if not netflix_series_ids:raise RuntimeError("Netflix series provider categories not found; preserving published catalogue.")
    netflix_series_rows=[x for x in series if str(x.get("category_id")) in netflix_series_ids or any(str(i) in netflix_series_ids for i in x.get("category_ids",[]) or [])]
    prior_series=next((g.get("entries",[]) for g in groups if g.get("type")=="series" and g.get("id")=="new-series-netflix"),[])
    if not netflix_series_rows and prior_series:raise RuntimeError("Netflix series provider categories unexpectedly empty; preserving catalogue.")
    old_series={str(st.get("id")):e for e in prior_series for st in e.get("streams",[])}
    netflix_series_entries={}
    for x in sorted(netflix_series_rows,key=lambda x:(int(x.get("added") or x.get("last_modified") or 0),identity(x,"series")),reverse=True):
        sid=identity(x,"series");tmdb=str(x.get("tmdb_id") or "")
        title=title_key(x.get("name"));yr=year(x.get("name"))
        ident=("tmdb",tmdb) if tmdb else ("title",title,yr)
        e=netflix_series_entries.get(ident)
        if e is None:
            e=record(x,"series")
            previous=old_series.get(sid)
            if previous:
                e["metadata"]={**e["metadata"],**{k:v for k,v in (previous.get("metadata") or {}).items() if v not in (None,"",[])}}
            netflix_series_entries[ident]=e
        elif sid not in {st["id"] for st in e["streams"]}:
            e["streams"].append(record(x,"series")["streams"][0])
    updated.append({"id":"new-series-netflix","name":"New Series on Netflix","type":"series","entries":list(netflix_series_entries.values())})
    print("New Series on Netflix:",len(netflix_series_entries),"titles from",len(netflix_series_rows),"provider sources across",len(netflix_series_ids),"categories")
    wanted={norm(n) for n in ["asia series (multi-subs)","disney+ asia series","disney+ asia series 4k 3840p dolby vision","netflix asia"]}
    asian_ids={str(c.get("category_id")) for c in cats if norm(c.get("category_name")) in wanted}
    asian=[x for x in series if str(x.get("category_id")) in asian_ids or any(str(i) in asian_ids for i in x.get("category_ids",[]) or [])]
    prior=next((g.get("entries",[]) for g in groups if g.get("type")=="series" and g.get("id")=="asian-series"),[])
    if not asian and prior:raise RuntimeError("Asian categories disappeared unexpectedly; preserving catalogue.")
    if not asian_ids:raise RuntimeError("Asian provider categories not found; preserving published catalogue.")
    prior_by_id={str(st.get("id")):e for e in prior for st in e.get("streams",[])}
    prior_by_tmdb={str((e.get("metadata") or {}).get("tmdbId")):e for e in prior if (e.get("metadata") or {}).get("tmdbId")}
    prior_by_title={title_key(e.get("name")):e for e in prior}
    asian_entries={}
    for x in sorted(asian,key=lambda x:int(x.get("added") or 0),reverse=True):
        sid=identity(x,"series")
        tmdb=str(x.get("tmdb_id") or "")
        previous=prior_by_id.get(sid) or (prior_by_tmdb.get(tmdb) if tmdb else None) or prior_by_title.get(title_key(x.get("name")))
        # Group stable provider IDs first, then verified TMDb identities, then full titles.
        title=title_key(previous.get("name") if previous else x.get("name"))
        ident=("tmdb:"+tmdb if tmdb else "title:"+title)
        if previous:
            for k,v in asian_entries.items():
                if any(st.get("id")==sid for st in v["streams"]) or (v.get("metadata") or {}).get("tmdbId") and str(v["metadata"]["tmdbId"])==str((previous.get("metadata") or {}).get("tmdbId")):
                    ident=k;break
        if ident not in asian_entries:
            e=record(x,"series")
            if previous:
                e["name"]=previous.get("name") or e["name"]
                e["year"]=previous.get("year") or e["year"]
                e["metadata"]={**e["metadata"],**{k:v for k,v in (previous.get("metadata") or {}).items() if v not in (None,"",[])}}
            asian_entries[ident]=e
        else:
            e=asian_entries[ident]
            if sid not in {st["id"] for st in e["streams"]}:e["streams"].append(record(x,"series")["streams"][0])
    updated.append({"id":"asian-series","name":"Asian Series","type":"series","entries":list(asian_entries.values())})
    print("Asian Series:",len(asian_entries),"titles from",len(asian),"provider sources across",len(asian_ids),"categories")
    # Consolidate every collection, including manually curated and dynamic rails.
    for group in updated:
        if group.get("type") in ("movie","series"):
            group["entries"]=consolidate(group.get("entries",[]))
    # Share TMDb metadata across rails, without allowing empty fields to erase cast/artwork.
    known={}
    for g in updated:
        t=g.get("type")
        if t not in ("movie","series"):continue
        for e in g.get("entries",[]):
            m=e.get("metadata") or {}
            if not (m.get("cast") or m.get("logo")):continue
            identities=[("title",t,title_key(e.get("name")),str(e.get("year") or ""))]
            if m.get("tmdbId"):identities.append(("tmdb",t,str(m["tmdbId"])))
            for ident in identities:
                if ident not in known or len(m.get("cast") or [])>len(known[ident].get("cast") or []):known[ident]=m
    for g in updated:
        t=g.get("type")
        if t not in ("movie","series"):continue
        for e in g.get("entries",[]):
            m=e.get("metadata") or {}
            inherited=known.get(("tmdb",t,str(m.get("tmdbId")))) if m.get("tmdbId") else None
            inherited=inherited or known.get(("title",t,title_key(e.get("name")),str(e.get("year") or "")))
            if inherited:e["metadata"]={**m,**{k:v for k,v in inherited.items() if v not in (None,"",[])}}
    refresh_mdblist(updated,available,indices,record,identity)
    for group in updated:
        if group.get("type") in ("movie","series"):
            group["entries"]=consolidate(group.get("entries",[]))
    enrich_tmdb(updated)
    # Do not write provider credentials, raw playlist URLs, or user information.
    result={"format":"swooptv-curated-v1","version":2,"generatedAt":datetime.datetime.now(datetime.timezone.utc).isoformat(),"categories":updated}
    if not any(g.get("entries") for g in updated if g.get("type")=="movie"):raise RuntimeError("No movies survived reconciliation")
    if not any(g.get("entries") for g in updated if g.get("type")=="series"):raise RuntimeError("No series survived reconciliation")
    temp=OUT.with_suffix(".json.tmp");temp.write_text(json.dumps(result,ensure_ascii=False,separators=(",",":"))+"\n");temp.replace(OUT)
    print("Published",sum(len(g.get("entries",[])) for g in updated),"entries across",len(updated),"groups")
if __name__=="__main__":
    try:main()
    except Exception as e:
        print("Sync failed; existing published catalogue preserved:",str(e),file=sys.stderr)
        sys.exit(1)
