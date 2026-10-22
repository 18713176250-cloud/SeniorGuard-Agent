"""HTTP 接口：把 analyze() 包成 Web 服务，并托管 frontend/ 页面。

用法（项目根目录）：
    python backend/server.py
    浏览器打开 http://127.0.0.1:8000

⚠️ 安全：本接口没有任何认证，只监听 127.0.0.1，仅限本机演示。
   如需对外部署，必须先加访问控制（如 Token/反向代理鉴权）和调用频率限制，
   否则任何人都能消耗团队的 OpenDev / AnySearch 额度。
"""
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from fastapi import FastAPI, File, Form, HTTPException, UploadFile  # noqa: E402
from fastapi.responses import FileResponse, JSONResponse, Response  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402
from pydantic import BaseModel, Field  # noqa: E402

from agents import elder_advisor, llm  # noqa: E402
from config import XINGYUN_APP_ID, XINGYUN_APP_SECRET, XINGYUN_GATEWAY  # noqa: E402
from agents.input_agent import IMAGE_EXTS  # noqa: E402
from main import analyze  # noqa: E402

# 网页请求：每次模型调用最多试 2 次（评测脚本仍是 3 次）。前端 3 分钟没结果会自动取消并提示重试。
llm.DEFAULT_RETRIES = int(os.getenv("WEB_LLM_RETRIES", "2"))

MAX_TEXT = 2000           # 单次文字上限（字），防止超长输入耗额度
MAX_IMAGE = 8 * 1024 * 1024  # 图片上限 8MB
MAX_TTS = 500

app = FastAPI(title="银龄数字卫士 API", docs_url="/docs")

# 允许静态前端（GitHub Pages 等）跨域调用；CORS_ORIGINS 用逗号分隔，默认放开
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in os.getenv("CORS_ORIGINS", "*").split(",")],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

# ---- 限频（内存计数，单进程有效）：公网临时演示用，防止额度被刷 ----
import time  # noqa: E402
from collections import defaultdict, deque  # noqa: E402
from fastapi import Request  # noqa: E402

RATE_LIMITS = {  # 路径 -> (每 IP 每分钟次数, 全站每小时次数)
    "/api/analyze": (int(os.getenv("RATE_ANALYZE_PER_MIN", "4")), int(os.getenv("RATE_ANALYZE_PER_HOUR", "120"))),
    "/api/tts": (int(os.getenv("RATE_TTS_PER_MIN", "15")), int(os.getenv("RATE_TTS_PER_HOUR", "400"))),
}
_ip_hits: dict = defaultdict(deque)
_all_hits: dict = defaultdict(deque)


def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for", "")
    return fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else "?")


@app.middleware("http")
async def rate_limit(request: Request, call_next):
    limits = RATE_LIMITS.get(request.url.path)
    if limits and request.method == "POST":
        now = time.time()
        per_min, per_hour = limits
        ip_q = _ip_hits[(request.url.path, _client_ip(request))]
        all_q = _all_hits[request.url.path]
        while ip_q and now - ip_q[0] > 60:
            ip_q.popleft()
        while all_q and now - all_q[0] > 3600:
            all_q.popleft()
        if len(ip_q) >= per_min or len(all_q) >= per_hour:
            return JSONResponse({"detail": "请求太频繁,请稍后再试"}, status_code=429, headers={"Retry-After": "60"})
        ip_q.append(now)
        all_q.append(now)
    return await call_next(request)


def _run(source: str, live: bool, force_text: bool = False) -> dict:
    try:
        return analyze(source, use_live=live, force_text=force_text)
    except Exception as e:  # noqa: BLE001  大模型/检索失败时给前端可读的提示
        print(f"[server] 分析失败: {e}", file=sys.stderr)
        raise HTTPException(status_code=502, detail="分析服务暂时不可用，请稍后重试") from e


@app.get("/api/health")
def health():
    return {"ok": True}


@app.post("/api/analyze")
def analyze_api(
    text: str = Form(""),
    image: UploadFile | None = File(None),
    live: bool = Form(False),
):
    """文字或图片二选一；同时提供时以图片为准。"""
    if image is not None and image.filename:
        ext = Path(image.filename).suffix.lower()
        if ext not in IMAGE_EXTS:
            raise HTTPException(400, f"不支持的图片格式，请上传 {'/'.join(sorted(IMAGE_EXTS))}")
        data = image.file.read(MAX_IMAGE + 1)
        if len(data) > MAX_IMAGE:
            raise HTTPException(413, "图片太大，请控制在 8MB 以内")
        fd, tmp = tempfile.mkstemp(suffix=ext)
        try:
            with os.fdopen(fd, "wb") as f:
                f.write(data)
            result = _run(tmp, live)
        finally:
            Path(tmp).unlink(missing_ok=True)
        if not result["input"]["text"]:
            raise HTTPException(422, "图片里没有识别到文字，请换一张更清晰的图片")
        return result

    text = text.strip()
    if not text:
        raise HTTPException(400, "请粘贴要检测的文字，或上传一张图片")
    if len(text) > MAX_TEXT:
        raise HTTPException(413, f"文字太长，请控制在 {MAX_TEXT} 字以内")
    return _run(text, live, force_text=True)  # 文字入口不允许被当成本地文件路径解析


class TTSReq(BaseModel):
    text: str = Field(..., min_length=1, max_length=MAX_TTS)


@app.post("/api/tts")
def tts_api(req: TTSReq):
    """把银龄解读播报稿转成 mp3（edge-tts，需联网）。"""
    fd, tmp = tempfile.mkstemp(suffix=".mp3")
    os.close(fd)
    try:
        elder_advisor.speak(req.text, out_path=tmp)
        return Response(Path(tmp).read_bytes(), media_type="audio/mpeg")
    except Exception as e:  # noqa: BLE001
        print(f"[server] 语音生成失败: {e}", file=sys.stderr)
        raise HTTPException(502, "语音生成失败，请检查网络") from e
    finally:
        Path(tmp).unlink(missing_ok=True)


@app.get("/api/avatar-config")
def avatar_config():
    """星云数字人配置。

    ⚠️ 星云 Web SDK 要求在浏览器里传 appSecret，所以这里会把 Secret 下发给页面。
       本服务只监听 127.0.0.1，仅本机可见；如果对外部署，访问者都能拿到 Secret，
       需先向星云确认是否支持服务端签发临时令牌，或改用演示专用应用并限额。
    """
    headers = {"Cache-Control": "no-store"}
    if not (XINGYUN_APP_ID and XINGYUN_APP_SECRET):
        return JSONResponse({"enabled": False}, headers=headers)
    return JSONResponse(
        {"enabled": True, "appId": XINGYUN_APP_ID, "appSecret": XINGYUN_APP_SECRET, "gatewayServer": XINGYUN_GATEWAY},
        headers=headers,
    )


FRONTEND = ROOT / "frontend"


@app.get("/")
def index():
    return FileResponse(FRONTEND / "index.html")


app.mount("/static", StaticFiles(directory=FRONTEND), name="static")


if __name__ == "__main__":
    import uvicorn

    # 本机默认只监听 127.0.0.1；云平台部署时设 HOST=0.0.0.0（render.yaml 已设置）
    uvicorn.run(app, host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", "8000")))
