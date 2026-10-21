"""Agent ④ 银龄解读：把结论转成老人能听懂的白话，并可选 TTS 语音播报。"""
import asyncio
import sys

from agents.llm import chat_json

SYSTEM = """你是贴心的反诈小帮手，对象是 60 岁以上的老人。把下面的判断结果改写成老人版提醒。
要求：
1. 口语化，短句，每句不超过 20 字；不用"伪权威""RAG"等术语，改用"假冒专家""骗人的话"这类说法。
2. 先说结论（是骗局 / 可能有问题 / 看起来正常），再说为什么，最后给 2-3 条具体做法。
3. 判断为存疑时，语气温和，提醒"先别付钱，问问子女或拨打 96110"，不要下绝对结论。
4. 判断为正常时，不要吓唬老人。
5. 不涉及疾病诊断和用药建议。
只输出 JSON：
{"headline": "10字内的结论", "script": "完整播报稿，150字内", "tips": ["做法1", "做法2"]}"""


def run(text: str, detection: dict, authority: dict) -> dict:
    payload = (
        f"原文：{text[:300]}\n"
        f"识别结论：{detection.get('verdict')}，风险：{detection.get('risk_level')}，{detection.get('reason')}\n"
        f"手法：{[t.get('name') for t in detection.get('tactics', [])]}\n"
        f"权威对照：{authority.get('overall')}；"
        f"{[r.get('basis') for r in authority.get('results', [])][:3]}\n"
        f"是否转人工复核：{authority.get('need_human_review')}"
    )
    out = chat_json(SYSTEM, payload, temperature=0.3)
    out.setdefault("tips", [])
    return out


# 微软免费 TTS 接口时好时坏：按顺序换音色重试，每次限时，避免请求卡死
VOICES = ("zh-CN-YunxiNeural", "zh-CN-XiaoxiaoNeural", "zh-CN-XiaoyiNeural", "zh-CN-YunjianNeural")
TTS_TIMEOUT = 20  # 秒


def speak(script: str, out_path: str = "advice.mp3", voices: tuple = VOICES) -> str:
    """TTS 播报，生成 mp3。需要 `pip install edge-tts`（联网）。全部音色都失败时抛出最后一个错误。"""
    import edge_tts

    async def _try(voice):
        await asyncio.wait_for(edge_tts.Communicate(script, voice, rate="-10%").save(out_path), TTS_TIMEOUT)

    last_err = None
    for voice in voices:
        try:
            asyncio.run(_try(voice))
            print(f"[elder_advisor] 语音合成成功（{voice}）", file=sys.stderr)
            return out_path
        except Exception as e:  # noqa: BLE001
            last_err = e
            print(f"[elder_advisor] 音色 {voice} 失败: {type(e).__name__}", file=sys.stderr)
    raise RuntimeError(f"语音合成失败: {last_err!r}")
