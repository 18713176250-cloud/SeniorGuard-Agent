"""主流程：输入 → 骗术识别 → 权威对照 → 银龄解读。

用法（在项目根目录）：
    python backend/main.py "国家药监局特批，包治百病，买三送三！"
    python backend/main.py 宣传单.png
    python backend/main.py 宣传单.png --live --tts
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # 让 config / agents / scripts 可导入

from agents import authority_checker, elder_advisor, input_agent, review_agent, scam_detector  # noqa: E402


def analyze(source: str, use_live: bool = False, enqueue_review: bool = True) -> dict:
    inp = input_agent.run(source)
    detection = scam_detector.run(inp["text"])
    authority = authority_checker.run(inp["text"], detection, use_live=use_live)
    review = review_agent.run(inp["text"], detection, authority, enqueue=enqueue_review)
    authority["need_human_review"] = review["needs_human_review"]  # 以复核 Agent 的判定为准
    advice = elder_advisor.run(inp["text"], detection, authority)
    return {
        "input": inp,
        "detection": detection,
        "authority": authority,
        "review": review,
        "advice": advice,
    }


def main():
    ap = argparse.ArgumentParser(description="银龄数字卫士 · 反诈全链路")
    ap.add_argument("source", help="图片路径或要检测的文字")
    ap.add_argument("--live", action="store_true", help="权威对照时追加 AnySearch 实时检索（耗额度）")
    ap.add_argument("--tts", action="store_true", help="生成语音播报 advice.mp3")
    args = ap.parse_args()

    result = analyze(args.source, use_live=args.live)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if args.tts:
        print("语音已生成：", elder_advisor.speak(result["advice"]["script"]))


if __name__ == "__main__":
    main()
