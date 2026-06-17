"""Generate showcase.html's image set via kie.ai (4o Image API). Saves to images/."""
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
          "clean modern editorial data-tech aesthetic, soft studio lighting, minimal composition, "
          "high detail, subtle film grain. No text, no words, no logos, no watermark.")

JOBS = [
    ("hero-bg.png", "3:2", "A wide cinematic abstract scene of glowing electric-blue data streams and fine network lines flowing across a deep navy void, soft bokeh particles, strong sense of depth and motion, darker on the left for text overlay, premium tech atmosphere."),
    ("feature-build.png", "1:1", "Close-up abstract of glowing electric-blue code brackets and modular geometric blocks assembling into a clean structure, floating above a dark navy surface."),
    ("feature-analyze.png", "1:1", "Elegant 3D abstract data visualization with glowing electric-blue bar charts and a rising line graph made of light, floating data points, deep navy backdrop."),
    ("feature-explain.png", "1:1", "Minimalist abstract of a glowing electric-blue message and chat-bubble shape emerging from layered translucent panels, a beam of clear light cutting through complexity, deep navy."),
    ("feature-thread.png", "1:1", "A single luminous electric-blue thread of light weaving through a row of connected glowing nodes, continuous left to right, deep navy background."),
    ("feature-product.png", "1:1", "A sleek floating glass dashboard panel with abstract glowing electric-blue charts and UI elements and no readable text, clean product render, soft reflections, deep navy studio background, premium SaaS aesthetic."),
    ("section-pillars.png", "3:2", "Wide editorial illustration of three glowing electric-blue pillars of light - a code symbol, a data chart, and a message shape - converging into one bright point, balanced minimal composition, deep navy gradient."),
    ("section-path.png", "3:2", "Wide cinematic abstract of a glowing electric-blue path of light leading toward a bright horizon through calm deep navy space, soft particles, sense of clarity and forward direction, premium and minimal."),
]

IMG = os.path.join(ROOT, "images")
os.makedirs(IMG, exist_ok=True)

# --- 1. create every task up front ---
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
    time.sleep(1)  # be gentle on rate limits

# --- 2. poll all pending tasks together ---
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

# --- 3. download + save (cap long side, optimize) ---
from PIL import Image
CAP = 1440
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
