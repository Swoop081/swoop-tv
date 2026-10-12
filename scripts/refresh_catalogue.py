#!/usr/bin/env python3
"""SwoopTV catalogue sync. Secrets are read from the environment, never exported."""
import os,json,re,time,urllib.request,urllib.parse,datetime,sys
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
        by_tmdb={};by_name={}
        for x in available[t].values():
            if x.get("tmdb_id"):by_tmdb.setdefault(str(x["tmdb_id"]),[]).append(x)
            by_name.setdefault(key(x.get("name"),year(x.get("name"))),[]).append(x)
        indices[t]=(by_tmdb,by_name)
    def match(e,t):
        ids={str(s.get("id")) for s in e.get("streams",[]) if s.get("id")}
        found=[available[t][sid] for sid in ids if sid in available[t]]
        if not found:
            by_tmdb,by_name=indices[t]
            tmdb=str((e.get("metadata") or {}).get("tmdbId") or "")
            found=by_tmdb.get(tmdb,[]) if tmdb else []
            if not found:found=by_name.get(key(e.get("name"),e.get("year")),[])
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
