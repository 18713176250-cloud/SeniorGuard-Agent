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

    uvicorn.run(app, host="127.0.0.1", port=int(os.getenv("PORT", "8000")))
