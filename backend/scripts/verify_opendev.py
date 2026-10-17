import json
import os
import time

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()

# ---- 仅 OpenDev 通道 ----
API_KEY = os.getenv("OPENDEV_API_KEY")
BASE_URL = os.getenv("OPENDEV_BASE_URL", "https://api.openai-next.com/v1")
MODEL = os.getenv("OPENDEV_MODEL", "claude-opus-5")

if not API_KEY:
    raise SystemExit("错误：未找到 OPENDEV_API_KEY。请在 .env 填入。")

client = OpenAI(api_key=API_KEY, base_url=BASE_URL)

SYSTEM_PROMPT = (
    "你是反诈助手。只输出合法 JSON，不要多余文字。"
    '格式：{"is_scam": bool, "risk_level": "低|中|高", "reason": "一句话理由"}'
)


def verify_connectivity(text, max_retries=3):
    """最小 LLM 调用 + 结构化 JSON 输出（带 5xx 重试）"""
    for attempt in range(1, max_retries + 1):
        try:
            resp = client.chat.completions.create(
                model=MODEL,
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": text},
                ],
                temperature=0.1,
                response_format={"type": "json_object"},
            )
            return json.loads(resp.choices[0].message.content)
        except Exception as e:
            print(f"  第{attempt}次失败: {type(e).__name__}: {e}")
            if attempt < max_retries:
                print("  ⏳ 5秒后重试...")
                time.sleep(5)
    raise RuntimeError(f"{MODEL} 重试{max_retries}次仍失败")


if __name__ == "__main__":
    test_text = "判断：国家药监局特批，包治百病，买三送三，抓紧抢购！"
    result = verify_connectivity(test_text)
    print("✅ OpenDev 连通成功，结构化 JSON 输出：")
    print(json.dumps(result, ensure_ascii=False, indent=2))