#!/usr/bin/env python3
"""Publish a free TMDb popular-people ranking for SwoopTV."""
import json, os, datetime, urllib.request, urllib.parse
token=os.environ["TMDB_READ_TOKEN"].strip()
headers={"Authorization":"Bearer "+token,"accept":"application/json","User-Agent":"SwoopTV/1.0"}
def get(path,params=None):
    url="https://api.themoviedb.org/3/"+path
    if params:url+="?"+urllib.parse.urlencode(params)
    req=urllib.request.Request(url,headers=headers)
    with urllib.request.urlopen(req,timeout=25) as response:return json.load(response)
people=[]
seen=set()
for page in range(1,6):
    data=get("person/popular",{"page":page,"language":"en-US"})
    for p in data.get("results",[]):
        pid=p.get("id")
        if not pid or pid in seen:continue
        seen.add(pid)
        people.append({"rank":len(people)+1,"id":str(pid),"tmdbId":pid,"name":p.get("name",""),"photo":"https://image.tmdb.org/t/p/w342"+p["profile_path"] if p.get("profile_path") else None})
        if len(people)==100:break
    if len(people)==100:break
if len(people)<80:raise RuntimeError("Too few people returned; preserving previous feed")
out={"format":"swooptv-starmeter-v1","source":"TMDb Popular People (not IMDb STARmeter)","updatedAt":datetime.datetime.now(datetime.timezone.utc).isoformat(),"people":people}
with open("swooptv-starmeter.json","w",encoding="utf-8") as f:json.dump(out,f,ensure_ascii=False,indent=2)
print("Published",len(people),"TMDb people")
