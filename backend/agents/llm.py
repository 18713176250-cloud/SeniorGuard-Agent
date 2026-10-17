"""llm.py — 共享的 OpenDev 结构化 JSON 调用（带重试）。"""
import json
import time

from config import OPENDEV_MODEL, get_opendev_client

_client = None

# 模型偶尔会在字符串值里输出未转义的英文双引号，导致 JSON 解析失败
JSON_RULE = "\n\n【格式铁律】JSON 字符串值内部禁止出现英文双引号 \"，需要引用时一律用中文引号「」。"


def chat_json(system: str, user: str, max_retries: int = 3, temperature: float = 0.1) -> dict:
    """调用 OpenDev，强制返回 JSON dict。5xx/解析失败时重试。"""
    global _client
    if _client is None:
        _client = get_opendev_client()
    last_err = None
    system = system + JSON_RULE
    for attempt in range(1, max_retries + 1):
        try:
            resp = _client.chat.completions.create(
                model=OPENDEV_MODEL,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                temperature=temperature,
                response_format={"type": "json_object"},
            )
            return json.loads(resp.choices[0].message.content)
        except Exception as e:  # noqa: BLE001
            last_err = e
            if attempt < max_retries:
                time.sleep(3)
    raise RuntimeError(f"{OPENDEV_MODEL} 重试{max_retries}次仍失败: {last_err}")
