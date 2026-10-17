"""复核 Agent（Human-in-loop）：存疑/边界内容转人工复核。

定位：辅助判断，不做最终定性。
规则化实现（不额外消耗大模型额度），判定是否需要人工复核，
需要时把脱敏后的案例写入 review_queue.jsonl，供人工处理。
隐私：只保存内容文本（手机号/身份证/银行卡号已脱敏），不采集老人个人信息。
"""
import json
import re
import time
from pathlib import Path

QUEUE_FILE = Path(__file__).resolve().parents[2] / "review_queue.jsonl"
DISCLAIMER = "本结果由 AI 辅助判断，不是最终定性；拿不准请先别付款，咨询子女或拨打 96110。"


def mask_pii(text: str) -> str:
    text = re.sub(r"(?<!\d)\d{17}[\dXx](?!\d)", "[身份证]", text)
    text = re.sub(r"(?<!\d)\d{16,19}(?!\d)", "[银行卡]", text)
    text = re.sub(r"(?<!\d)1[3-9]\d{9}(?!\d)", "[手机号]", text)
    return text


def decide(detection: dict, authority: dict) -> list[str]:
    """返回需要人工复核的原因列表；空列表表示无需复核。"""
    reasons = []
    verdict = detection.get("verdict")
    overall = authority.get("overall", "")

    if verdict == "存疑":
        reasons.append("骗术识别结论为存疑")
    if authority.get("need_human_review") and "资料不足" in overall:
        reasons.append("权威资料不足，无法对照")
    if verdict == "诈骗" and "一致" in overall and "矛盾" not in overall:
        reasons.append("识别为诈骗，但权威对照显示一致，二者冲突（防误伤）")
    if verdict == "正常" and "矛盾" in overall:
        reasons.append("识别为正常，但权威对照发现矛盾，二者冲突")
    if verdict == "诈骗" and detection.get("risk_level") == "低":
        reasons.append("判为诈骗但风险等级为低，结论不一致")
    return reasons


def run(text: str, detection: dict, authority: dict, enqueue: bool = True) -> dict:
    reasons = decide(detection, authority)
    needs_review = bool(reasons)
    queued = False
    if needs_review and enqueue:
        record = {
            "time": time.strftime("%Y-%m-%d %H:%M:%S"),
            "text": mask_pii(text)[:500],
            "verdict": detection.get("verdict"),
            "risk_level": detection.get("risk_level"),
            "authority_overall": authority.get("overall"),
            "reasons": reasons,
            "human_decision": None,  # 待人工填写：诈骗 / 正常
        }
        with QUEUE_FILE.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
        queued = True
    return {
        "needs_human_review": needs_review,
        "reasons": reasons,
        "queued": queued,
        "disclaimer": DISCLAIMER,
    }
