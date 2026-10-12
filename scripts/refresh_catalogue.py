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
    return re.sub(r"[^a-z0-9]+"," ",re.sub(r"^(?:(?:4k|8k|uhd|hdr|dv|multi|en|eng|nf|dsnp|disney|netflix)[\s._-]+)+","",str(value or ""),flags=re.I).lower()).strip()
def year(value):
    match=re.search(r"\b(?:19|20)\d{2}\b",str(value or ""))
    return match.group(0) if match else ""
def key(name,yr=""):return norm(re.sub(r"\b(?:19|20)\d{2}\b","",name or "")),str(yr or year(name))
def title_key(name):
    name=str(name or "")
    name=re.sub(r"^(?:(?:[A-Z]{2,5}\s*[:|]\s*)|(?:NETFLIX|DISNEY|AMAZON|APPLE|HBO|MAX|NF|DSNP|WEB-DL|4K|8K|UHD|HDR|MULTI)\s*[:|._ -]+)+","",name,flags=re.I)
    name=re.sub(r"\b(?:19|20)\d{2}\b|\b(?:1080p|2160p|720p|4k|hdr|dv|multi.subs?|season\s*\d+|complete)\b"," ",name,flags=re.I)
    return norm(name)
def variants(name):
    result={title_key(name)}
    for sep in (" | "," : "," - "):
        parts=str(name or "").split(sep)
        if len(parts)>1:result.add(title_key(parts[-1]))
    return {v for v in result if len(v)>2}
def lookup(t,title,yr,tmdb,indices):
    by_tmdb,by_name,by_title=indices[t]
    if tmdb and by_tmdb.get(str(tmdb)):return by_tmdb[str(tmdb)]
    exact=by_name.get(key(title,yr),[])
    if exact:return exact
    hits={}
    for v in (variants(title) if t=="series" else {title_key(title)}):
        for x in by_title.get(v,[]):
            sid=str(x.get("series_id" if t=="series" else "stream_id"))
            if not yr or not year(x.get("name")) or year(x.get("name"))==str(yr):hits[sid]=x
    return list(hits.values())

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
    for g in updated:
        t=g.get("type")
        if t not in ("movie","series"):continue
        for e in g.get("entries",[]):
            m=e.setdefault("metadata",{})
            if m.get("cast") and m.get("poster") and m.get("tmdbId"):continue
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
                cast=[{"id":p.get("id"),"name":p.get("name")} for p in details.get("credits",{}).get("cast",[])[:35] if p.get("name")]
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
    vod=api("get_vod_streams");series=api("get_series");cats=api("get_series_categories")
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
            for v in (variants(x.get("name")) if t=="series" else {title_key(x.get("name"))}):by_title.setdefault(v,[]).append(x)
        indices[t]=(by_tmdb,by_name,by_title)
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
        if g.get("id") in ("recently-added","asian-series"):continue
        entries=[r for e in g.get("entries",[]) if (r:=reconcile(e,g["type"]))]
        updated.append({**g,"entries":entries})
    def recent(t):
        rows=sorted(available[t].values(),key=lambda x:(int(x.get("added") or x.get("last_modified") or 0),int(identity(x,t))),reverse=True)[:200]
        previous=next((g.get("entries",[]) for g in groups if g.get("type")==t and g.get("id")=="recently-added"),[])
        old_by_id={str(s.get("id")):e for e in previous for s in e.get("streams",[])}
        entries=[]
        for x in rows:
            e=record(x,t);prior=old_by_id.get(identity(x,t))
            if prior:e["metadata"]={**e["metadata"],**(prior.get("metadata") or {})}
            entries.append(e)
        return {"id":"recently-added","name":"Recently Added","type":t,"entries":entries}
    updated.extend([recent("movie"),recent("series")])
    wanted={norm(n) for n in ["asia series (multi-subs)","disney+ asia series","disney+ asia series 4k 3840p dolby vision","netflix asia"]}
    asian_ids={str(c.get("category_id")) for c in cats if norm(c.get("category_name")) in wanted}
    asian=[x for x in series if str(x.get("category_id")) in asian_ids or any(str(i) in asian_ids for i in x.get("category_ids",[]) or [])]
    prior=next((g.get("entries",[]) for g in groups if g.get("type")=="series" and g.get("id")=="asian-series"),[])
    prior_by_id={str(st.get("id")):e for e in prior for st in e.get("streams",[])}
    prior_by_title={key(e.get("name"),e.get("year")):e for e in prior}
    asian_entries={}
    for x in sorted(asian,key=lambda x:int(x.get("added") or 0),reverse=True):
        ident="tmdb:"+str(x["tmdb_id"]) if x.get("tmdb_id") else "title:"+str(key(x.get("name")))
        if ident not in asian_entries:
            e=record(x,"series")
            previous=prior_by_id.get(identity(x,"series")) or prior_by_title.get(key(x.get("name")))
            if previous:e["metadata"]={**e["metadata"],**(previous.get("metadata") or {})}
            asian_entries[ident]=e
        else:
            e=asian_entries[ident]
            if identity(x,"series") not in [s["id"] for s in e["streams"]]:e["streams"].append(record(x,"series")["streams"][0])
    if not asian and prior:raise RuntimeError("Asian categories disappeared unexpectedly; preserving catalogue.")
    updated.append({"id":"asian-series","name":"Asian Series","type":"series","entries":list(asian_entries.values())})
    # Reuse enriched metadata across rails; one title enriched once.
    known={}
    for g in updated:
        if g.get("type") not in ("movie","series"):continue
        for e in g.get("entries",[]):
            m=e.get("metadata") or {}
            if m.get("cast") or m.get("logo"):known[(g["type"],key(e.get("name"),e.get("year")))]=m
    for g in updated:
        if g.get("type") not in ("movie","series"):continue
        for e in g.get("entries",[]):
            prior=known.get((g["type"],key(e.get("name"),e.get("year"))))
            if prior:e["metadata"]={**e.get("metadata",{}),**prior}
    refresh_mdblist(updated,available,indices,record,identity)
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
