"""One-off: generate a 512x512 placeholder via kie.ai (4o Image API)."""
import os, json, time, sys, urllib.request, urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# --- read key from .env (never printed) ---
key = None
with open(os.path.join(ROOT, ".env"), encoding="utf-8") as f:
    for line in f:
        line = line.strip()
        if line.startswith("KIE_API_KEY="):
            key = line.split("=", 1)[1].strip()
if not key:
    sys.exit("KIE_API_KEY not found in .env")

BASE = "https://api.kie.ai/api/v1/gpt4o-image"
HDR = {"Authorization": "Bearer " + key, "Content-Type": "application/json"}

# --- 1. create task ---
prompt = ("A dynamic photograph of an anonymous male basketball player in a plain "
          "purple and gold jersey (no logos, no text, no recognizable face), mid dribble "
          "on an indoor hardwood court, dramatic studio lighting, sharp focus, high detail")
body = json.dumps({"prompt": prompt, "size": "1:1"}).encode()
req = urllib.request.Request(BASE + "/generate", data=body, headers=HDR, method="POST")
try:
    resp = json.loads(urllib.request.urlopen(req, timeout=30).read())
except urllib.error.HTTPError as e:
    sys.exit("create failed: HTTP %s %s" % (e.code, e.read().decode()))
print("create ->", resp)
task = (resp.get("data") or {}).get("taskId")
if not task:
    sys.exit("no taskId returned")

# --- 2. poll record-info ---
img_url = None
for i in range(45):                       # ~6 min max
    time.sleep(8)
    q = urllib.request.Request(BASE + "/record-info?taskId=" + task, headers=HDR)
    data = (json.loads(urllib.request.urlopen(q, timeout=30).read()).get("data") or {})
    flag = data.get("successFlag")
    print("poll %2d -> flag=%s progress=%s" % (i, flag, data.get("progress")))
    if flag == 1:
        resp = data.get("response") or {}
        # live API returns camelCase `resultUrls`; keep snake_case as a fallback
        urls = resp.get("resultUrls") or resp.get("result_urls") or [None]
        img_url = urls[0]
        break
    if flag in (2, 3):                    # 2/3 = GENERATE_FAILED (incl. content-policy refusal)
        sys.exit("generation failed [%s]: %s" % (data.get("status"), data.get("errorMessage")))
if not img_url:
    sys.exit("timed out waiting for image")
print("image url ->", img_url)

# --- 3. download + resize to 512x512 ---
out_dir = os.path.join(ROOT, "images")
os.makedirs(out_dir, exist_ok=True)
raw = os.path.join(out_dir, "kobe-raw.png")
# CDN 403s the default urllib UA, so send a browser User-Agent
dl = urllib.request.Request(img_url, headers={"User-Agent": "Mozilla/5.0"})
with open(raw, "wb") as fh:
    fh.write(urllib.request.urlopen(dl, timeout=60).read())

from PIL import Image
im = Image.open(raw).convert("RGB").resize((512, 512))
out = os.path.join(out_dir, "kobe-placeholder.png")
im.save(out)
os.remove(raw)
print("SAVED ->", out, im.size)
