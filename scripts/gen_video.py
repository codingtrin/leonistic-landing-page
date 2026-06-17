"""Generate a 5s first->last frame transition via kie.ai (kling-3.0/video). Saves to images/."""
import os, json, time, sys, urllib.request, urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
key = None
with open(os.path.join(ROOT, ".env"), encoding="utf-8") as f:
    for line in f:
        if line.strip().startswith("KIE_API_KEY="):
            key = line.split("=", 1)[1].strip()
if not key:
    sys.exit("KIE_API_KEY not found in .env")

HDR = {"Authorization": "Bearer " + key, "Content-Type": "application/json"}
START = "https://leonistic.vercel.app/images/anim-start-wide.png"
END = "https://leonistic.vercel.app/images/anim-end-wide.png"

payload = {
    "model": "kling-3.0/video",
    "input": {
        "prompt": ("A smooth, continuous transformation of the same data dashboard: a blue technical "
                   "blueprint wireframe gradually resolves and fills into a fully rendered, glowing "
                   "three-dimensional version with solid bars and a bright rising trend line. "
                   "Static fixed camera, no camera movement, no zoom, no pan, no rotation. "
                   "Minimal and clean — just the transformation."),
        "image_urls": [START, END],
        "sound": False,
        "duration": "5",
        "aspect_ratio": "16:9",
        "mode": "pro",
        "multi_shots": False,
    },
}

# --- create ---
req = urllib.request.Request("https://api.kie.ai/api/v1/jobs/createTask",
                             data=json.dumps(payload).encode(), headers=HDR, method="POST")
try:
    resp = json.loads(urllib.request.urlopen(req, timeout=30).read())
except urllib.error.HTTPError as e:
    sys.exit("create failed: HTTP %s %s" % (e.code, e.read().decode()))
print("create ->", resp)
task = (resp.get("data") or {}).get("taskId")
if not task:
    sys.exit("no taskId returned")

# --- poll ---
video_url = None
for i in range(55):                     # ~9 min max
    time.sleep(10)
    q = urllib.request.Request("https://api.kie.ai/api/v1/jobs/recordInfo?taskId=" + task, headers=HDR)
    try:
        d = (json.loads(urllib.request.urlopen(q, timeout=30).read()).get("data") or {})
    except Exception as e:
        print("poll %2d -> (query error %s)" % (i, e)); continue
    state = d.get("state")
    print("poll %2d -> state=%s" % (i, state))
    if state == "success":
        rj = d.get("resultJson") or "{}"
        try:
            video_url = (json.loads(rj).get("resultUrls") or [None])[0]
        except Exception:
            video_url = None
        print("creditsConsumed:", d.get("creditsConsumed"))
        break
    if state == "fail":
        sys.exit("generation failed [%s]: %s" % (d.get("failCode"), d.get("failMsg")))
if not video_url:
    sys.exit("timed out / no video url")
print("video url ->", video_url)

# --- download ---
out = os.path.join(ROOT, "images", "anim-transition.mp4")
dl = urllib.request.Request(video_url, headers={"User-Agent": "Mozilla/5.0"})
with open(out, "wb") as fh:
    fh.write(urllib.request.urlopen(dl, timeout=180).read())
print("SAVED ->", out, str(os.path.getsize(out) // 1024) + "KB")
