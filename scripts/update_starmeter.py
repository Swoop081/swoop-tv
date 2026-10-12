#!/usr/bin/env python3
"""Build a mainstream screen-actor chart from trending films and television."""
import concurrent.futures
import datetime
import json
import os
import urllib.parse
import urllib.request

token = os.environ["TMDB_READ_TOKEN"].strip()
headers = {"Authorization": "Bearer " + token, "accept": "application/json", "User-Agent": "SwoopTV/1.0"}

def get(path, params=None):
    url = "https://api.themoviedb.org/3/" + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=25) as response:
        return json.load(response)

# Rank credited performers in currently trending mainstream screen productions.
# This avoids using TMDb's uncurated person/popular endpoint.
titles = []
for media in ("movie", "tv"):
    for page in (1, 2, 3):
        data = get("trending/" + media + "/week", {"page": page, "language": "en-US"})
        for index, item in enumerate(data.get("results", [])):
            if item.get("adult") is True or not item.get("id"):
                continue
            titles.append((media, item["id"], (page - 1) * 20 + index))

def cast_for(item):
    media, title_id, position = item
    try:
        data = get(f"{media}/{title_id}/credits")
        return item, data.get("cast", [])[:12]
    except Exception as exc:
        print("Skipping credits", media, title_id, exc)
        return item, []

scores = {}
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
    for (media, title_id, position), cast in pool.map(cast_for, titles):
        for billing, person in enumerate(cast):
            pid = person.get("id")
            if not pid or person.get("adult") is True or person.get("known_for_department") not in ("Acting", None):
                continue
            if not person.get("profile_path") or not person.get("name"):
                continue
            weight = (60 - min(position, 55)) / (billing + 2)
            if pid not in scores:
                scores[pid] = {"score": 0, "appearances": 0, "id": str(pid), "tmdbId": pid,
                               "name": person["name"],
                               "photo": "https://image.tmdb.org/t/p/w342" + person["profile_path"]}
            scores[pid]["score"] += weight
            scores[pid]["appearances"] += 1

ranked = sorted(scores.values(), key=lambda p: (-p["score"], -p["appearances"], p["name"]))[:100]
if len(ranked) < 80:
    raise RuntimeError("Too few credited mainstream actors; preserving previous feed")
people = [{"rank": i + 1, "id": p["id"], "tmdbId": p["tmdbId"], "name": p["name"], "photo": p["photo"]}
          for i, p in enumerate(ranked)]
out = {"format": "swooptv-starmeter-v1",
       "source": "SwoopTV Trending Screen Actors (TMDb movie and TV credits; not IMDb STARmeter)",
       "updatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(), "people": people}
with open("swooptv-starmeter.json", "w", encoding="utf-8") as file:
    json.dump(out, file, ensure_ascii=False, indent=2)
print("Published", len(people), "trending screen actors")
