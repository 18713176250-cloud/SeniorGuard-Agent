"""config.py — 统一读取 .env 配置，供 4 个 Agent 复用

用法：
    from config import opendev_client, anysearch, OPENDEV_MODEL
"""
import os

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()  # 读取项目根目录的 .env

# ===== OpenDev（大模型推理：骗术识别/银龄解读）=====
OPENDEV_API_KEY = os.getenv("OPENDEV_API_KEY")
OPENDEV_BASE_URL = os.getenv("OPENDEV_BASE_URL", "https://api.openai-next.com/v1")
OPENDEV_MODEL = os.getenv("OPENDEV_MODEL", "claude-opus-5")

# ===== AnySearch（RAG 检索：权威对照）=====
ANYSEARCH_MCP_URL = os.getenv("ANYSEARCH_MCP_URL", "https://api.anysearch.com/mcp")
ANYSEARCH_API_KEY = os.getenv("ANYSEARCH_API_KEY")

# ===== 星云数字人（可选，前端播报用；不填则页面不显示数字人按钮）=====
XINGYUN_APP_ID = os.getenv("XINGYUN_APP_ID", "").strip()
XINGYUN_APP_SECRET = os.getenv("XINGYUN_APP_SECRET", "").strip()
XINGYUN_GATEWAY = os.getenv("XINGYUN_GATEWAY", "https://nebula-agent.xingyun3d.com/user/v1/ttsa_v2/session")

# 校验：缺失 Key 时给出明确提示
if not OPENDEV_API_KEY:
    raise RuntimeError("未找到 OPENDEV_API_KEY，请在 .env 中配置。")
if not ANYSEARCH_API_KEY:
    raise RuntimeError("未找到 ANYSEARCH_API_KEY，请在 .env 中配置（as_sk_ 开头）。")


def get_opendev_client() -> OpenAI:
    """OpenDev 客户端（Agent ② 骗术识别 / Agent ④ 银龄解读）"""
    # 不设 timeout 时 SDK 默认等 600s，且自带 2 次重试；上游断连时单条样本会卡上一小时。
    # 这里设 120s 超时、关掉 SDK 自带重试，统一由 llm.chat_json 负责重试和退避。
    return OpenAI(
        api_key=OPENDEV_API_KEY,
        base_url=OPENDEV_BASE_URL,
        timeout=120.0,
        max_retries=0,
    )


def get_anysearch():
    """AnySearch 客户端（Agent ③ 权威对照）"""
    from scripts.anysearch_client import AnySearch  # 延迟导入，避免循环依赖
    return AnySearch(api_key=ANYSEARCH_API_KEY)


# 可选：预建实例（用 get_*() 更灵活，避免单例在测试时连不上）