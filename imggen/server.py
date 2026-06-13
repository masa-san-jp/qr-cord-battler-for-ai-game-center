#!/usr/bin/env python3
"""Tiny local image-gen HTTP service for the hackathon games.

Wraps ComfyUI + Qwen behind ONE simple endpoint so a browser game or a game
server can get an image without speaking ComfyUI's graph protocol.

Endpoints (CORS open for localhost browser games):
  GET  /health
      -> {"ok": true, "comfy": true, "profile": "qwen-lightning"}
  POST /generate   body: {"prompt": str, "width"?: 720, "height"?: 720,
                          "seed"?: int, "format"?: "png"|"dataurl"}
      format "png"     -> image/png bytes (default)
      format "dataurl" -> {"image": "data:image/png;base64,...", "seconds": 9.1}

Run:
  python3 server.py [--port 8771] [--profile qwen-lightning] [--warmup]
Needs ComfyUI up (use serve.sh first, or pass --warmup to load weights here).
"""
import argparse
import base64
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gen  # noqa: E402  (local module)
import urllib.request  # noqa: E402

PROFILE = "qwen-lightning"
PORT = 8771

# ---- リアルタイム・ファイター生成（GB10 ローカル LLM で QR→パラメータ＋プロンプト）----
OLLAMA = os.environ.get("OLLAMA_URL", "http://localhost:11434")
FIGHTER_MODEL = os.environ.get("FIGHTER_MODEL", "gpt-oss:20b")
TIER_TOTAL = {"SSS": 1000, "SS": 800, "A": 600, "B": 500}
ATTRS = ["火", "水", "雷", "自然", "光", "闇"]
_FIGHTER_SYS = (
    "あなたはゲームのキャラ生成器です。与えられた QR ペイロード文字列をテーマに、対戦ゲームの"
    "ファイターを 1 体作ります。JSON だけを返し、説明文や前置きは書きません。\n"
    "スキーマ: {\"attribute\": \"火|水|雷|自然|光|闇 のいずれか\", \"tier\": \"SSS|SS|A|B のいずれか\", "
    "\"hp\": 整数, \"atk\": 整数, \"def\": 整数, \"spd\": 整数, \"ctr\": 整数, "
    "\"prompt\": \"英語のキャラ画像生成プロンプト\"}\n"
    "5 つの整数は強さ。テーマに合わせて配分する（攻撃的なら atk 高め、素早そうなら spd 高め 等）。"
    "tier が高いほど合計が大きい想定（SSS≈1000 / SS≈800 / A≈600 / B≈500）。"
    "prompt は anime fighting game character のキャラ絵用で、'no text' を必ず含める。"
)


def _ollama_fighter(qr_text):
    body = {
        "model": FIGHTER_MODEL, "format": "json", "stream": False, "keep_alive": "30m",
        "think": False,  # gpt-oss の推論を切る（GB10 で 79s→13s）。リアルタイム生成に必須
        "messages": [{"role": "system", "content": _FIGHTER_SYS},
                     {"role": "user", "content": "QR payload: " + qr_text[:300]}],
        "options": {"temperature": 0.8},
    }
    req = urllib.request.Request(OLLAMA + "/api/chat", data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=180) as r:
        content = json.load(r).get("message", {}).get("content", "{}")
    return json.loads(content)


def _normalize_fighter(raw, qr_text):
    tier = raw.get("tier", "B")
    if tier not in TIER_TOTAL:
        tier = "B"
    total = TIER_TOTAL[tier]
    vals = [max(1, int(raw.get(k, 1) or 1)) for k in ("hp", "atk", "def", "spd", "ctr")]
    s = sum(vals) or 1
    stats = [max(1, round(v / s * total)) for v in vals]
    stats[0] += total - sum(stats)  # 端数を hp に寄せて合計を total へ厳密一致
    attr = raw.get("attribute", "")
    if attr not in ATTRS:
        attr = ATTRS[abs(hash(qr_text)) % len(ATTRS)]
    hp, atk, df, spd, ctr = stats
    prompt = (raw.get("prompt") or "").strip() or (
        "a " + attr + " elemental monster, anime fighting game character, dynamic, vivid, no text")
    return {"attribute": attr, "tier": tier, "tierTotal": total, "hp": hp, "atk": atk,
            "def": df, "spd": spd, "ctr": ctr, "ctrPct": min(80, round(ctr / total * 100)),
            "prompt": prompt}


def _comfy_up():
    try:
        gen._get("/system_stats")
        return True
    except Exception:
        return False


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self._cors()
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if self.path.split("?")[0] == "/health":
            self._json(200, {"ok": True, "comfy": _comfy_up(), "profile": PROFILE})
        else:
            self._json(404, {"error": "not found"})

    def _handle_fighter(self, req):
        qr = (req.get("qr") or req.get("text") or "").strip()
        if not qr:
            self._json(400, {"error": "qr required"})
            return
        try:
            fp = _normalize_fighter(_ollama_fighter(qr), qr)
            dt, imgs = gen.generate(PROFILE, fp["prompt"], 512, 512, abs(hash(qr)) % (2 ** 31))
            with open(imgs[0], "rb") as f:
                data = f.read()
            fp["image"] = "data:image/png;base64," + base64.b64encode(data).decode()
            fp["seconds"] = round(dt, 1)
            self._json(200, fp)
        except Exception as e:
            self._json(500, {"error": str(e)[:400]})

    def do_POST(self):
        path = self.path.split("?")[0]
        if path not in ("/generate", "/fighter"):
            self._json(404, {"error": "not found"})
            return
        try:
            n = int(self.headers.get("Content-Length", 0))
            req = json.loads(self.rfile.read(n) or b"{}")
        except Exception as e:
            self._json(400, {"error": f"bad json: {e}"})
            return
        if path == "/fighter":
            self._handle_fighter(req)
            return
        prompt = (req.get("prompt") or "").strip()
        if not prompt:
            self._json(400, {"error": "prompt required"})
            return
        w = int(req.get("width", 720))
        h = int(req.get("height", 720))
        seed = int(req.get("seed", 42))
        fmt = req.get("format", "png")
        try:
            dt, imgs = gen.generate(PROFILE, prompt, w, h, seed)
            data = open(imgs[0], "rb").read()
        except Exception as e:
            self._json(500, {"error": str(e)[:400]})
            return
        if fmt == "dataurl":
            b64 = base64.b64encode(data).decode()
            self._json(200, {"image": "data:image/png;base64," + b64, "seconds": round(dt, 1)})
        else:
            self.send_response(200)
            self.send_header("Content-Type", "image/png")
            self._cors()
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

    def log_message(self, *a):
        pass  # quiet


def main():
    global PROFILE, PORT
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=PORT)
    ap.add_argument("--profile", default=PROFILE, choices=list(gen.PROFILES))
    ap.add_argument("--warmup", action="store_true")
    args = ap.parse_args()
    PROFILE, PORT = args.profile, args.port
    if args.warmup:
        d, _ = gen.generate(PROFILE, "warmup", 256, 256, 1)
        print(f"[imggen] warmed {PROFILE} in {d:.1f}s", flush=True)
    print(f"[imggen] serving on http://127.0.0.1:{PORT}  profile={PROFILE}  comfy={_comfy_up()}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
