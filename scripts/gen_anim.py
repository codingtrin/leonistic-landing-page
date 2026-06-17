"""Generate the animation start/end keyframes via kie.ai (4o Image API). Saves to images/."""
import os, json, time, sys, io, urllib.request, urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
key = None
with open(os.path.join(ROOT, ".env"), encoding="utf-8") as f:
    for line in f:
        if line.strip().startswith("KIE_API_KEY="):
            key = line.split("=", 1)[1].strip()
if not key:
    sys.exit("KIE_API_KEY not found in .env")

BASE = "https://api.kie.ai/api/v1/gpt4o-image"
HDR = {"Authorization": "Bearer " + key, "Content-Type": "application/json"}
SUFFIX = (" Deep navy #0B1F3A background, electric-blue #3B82F6 and ice-white accents, "
          "clean modern editorial data-tech aesthetic, minimal composition, high detail. "
          "No text, no words, no logos, no watermark.")

JOBS = [
    ("anim-start.png", "3:2", "A technical blueprint and wireframe line-art schematic of a data dashboard: thin glowing electric-blue outline strokes on a deep navy drafting grid, showing a bar chart and a rising trend line being constructed from a scattered cloud of small connected nodes converging into formation, faint construction guide lines and measurement ticks, flat schematic plan view, no solid fills, engineering-blueprint style."),
    ("anim-end.png", "3:2", "A fully rendered, polished version of the same data dashboard: a glowing three-dimensional electric-blue bar chart with a luminous rising trend line, a cloud of bright data particles resolved into clean ordered formation, soft depth, gentle reflections and light bloom, crisp ice-white highlights, cinematic and premium finished product render."),
]

IMG = os.path.join(ROOT, "images")
os.makedirs(IMG, exist_ok=True)

tasks = {}
for fname, size, prompt in JOBS:
    body = json.dumps({"prompt": prompt + SUFFIX, "size": size}).encode()
    req = urllib.request.Request(BASE + "/generate", data=body, headers=HDR, method="POST")
    try:
        r = json.loads(urllib.request.urlopen(req, timeout=30).read())
        tid = (r.get("data") or {}).get("taskId")
        tasks[fname] = {"taskId": tid, "done": tid is None, "url": None, "err": None if tid else "no taskId"}
        print("created", fname, "->", tid)
    except urllib.error.HTTPError as e:
        tasks[fname] = {"taskId": None, "done": True, "url": None, "err": "create HTTP %s %s" % (e.code, e.read().decode())}
        print("create FAILED", fname, tasks[fname]["err"])
    time.sleep(1)

for rnd in range(50):
    pending = [f for f, t in tasks.items() if not t["done"]]
    if not pending:
        break
    time.sleep(8)
    for f in pending:
        t = tasks[f]
        try:
            q = urllib.request.Request(BASE + "/record-info?taskId=" + t["taskId"], headers=HDR)
            d = (json.loads(urllib.request.urlopen(q, timeout=30).read()).get("data") or {})
        except Exception:
            continue
        flag = d.get("successFlag")
        if flag == 1:
            resp = d.get("response") or {}
            t["url"] = (resp.get("resultUrls") or resp.get("result_urls") or [None])[0]
            t["done"] = True
            print("done    ", f)
        elif flag in (2, 3):
            t["done"] = True
            t["err"] = "%s: %s" % (d.get("status"), d.get("errorMessage"))
            print("FAILED  ", f, t["err"])
    print("  round %d -> still pending: %d" % (rnd, len([f for f, t in tasks.items() if not t["done"]])))

from PIL import Image
CAP = 1600
print("\n--- results ---")
for f, t in tasks.items():
    if not t["url"]:
        print("MISSING", f, "->", t.get("err"))
        continue
    try:
        dl = urllib.request.Request(t["url"], headers={"User-Agent": "Mozilla/5.0"})
        raw = urllib.request.urlopen(dl, timeout=90).read()
        im = Image.open(io.BytesIO(raw)).convert("RGB")
        w, h = im.size
        if max(w, h) > CAP:
            s = CAP / max(w, h)
            im = im.resize((round(w * s), round(h * s)))
        out = os.path.join(IMG, f)
        im.save(out, optimize=True)
        print("SAVED  ", f, im.size, str(os.path.getsize(out) // 1024) + "KB")
    except Exception as e:
        print("DL FAIL", f, "->", e)
