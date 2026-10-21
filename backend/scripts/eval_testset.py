"""量化评测：在 testset/samples.jsonl 上跑 输入→识别→权威对照→复核，输出指标。

用法（项目根目录）：
    python backend/scripts/eval_testset.py              # 全量
    python backend/scripts/eval_testset.py --limit 4    # 先小批量试跑
    python backend/scripts/eval_testset.py --live       # 追加 AnySearch 实时检索（更耗额度）

额度：每条样本约 2 次大模型调用（不含银龄解读，不写复核队列）。
标签：scam 诈骗 / normal 正常 / borderline 边界（不计入准确率，只单独列出）。
指标口径：
  - 诈骗识别：verdict == "诈骗" 为判诈骗；"存疑" 不算判诈骗，另计「触发预警」。
  - 误伤率：normal 样本中 verdict == "诈骗" 的比例。
  - 权威一致率：诈骗样本中权威对照 overall 为「矛盾」的比例（越高越好）；
    正常样本中不为「矛盾」的比例。
"""
import argparse
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from agents import authority_checker, review_agent, scam_detector  # noqa: E402

SAMPLES = ROOT / "testset" / "samples.jsonl"
OUT = ROOT / "testset" / "eval_result.json"


def pct(a, b):
    return f"{a}/{b} = {a / b:.0%}" if b else "无样本"


def run_one(s, live):
    det = scam_detector.run(s["text"])
    auth = authority_checker.run(s["text"], det, use_live=live)
    rev = review_agent.run(s["text"], det, auth, enqueue=False)
    return {
        "id": s["id"],
        "label": s["label"],
        "category": s["category"],
        "verdict": det.get("verdict"),
        "risk_level": det.get("risk_level"),
        "tactics": [t.get("name") for t in det.get("tactics", [])],
        "authority_overall": auth.get("overall"),
        "judgements": [r.get("judgement") for r in auth.get("results", [])],
        "needs_human_review": rev["needs_human_review"],
        "review_reasons": rev["reasons"],
        "reason": det.get("reason"),
    }


def summarize(rows):
    scam = [r for r in rows if r["label"] == "scam"]
    normal = [r for r in rows if r["label"] == "normal"]
    tp = sum(r["verdict"] == "诈骗" for r in scam)
    fp = sum(r["verdict"] == "诈骗" for r in normal)
    warned = sum(r["verdict"] in ("诈骗", "存疑") for r in scam)
    out = {
        "诈骗召回率(判为诈骗)": pct(tp, len(scam)),
        "诈骗预警率(诈骗+存疑)": pct(warned, len(scam)),
        "诈骗精确率": pct(tp, tp + fp),
        "误伤率(正常被判诈骗)": pct(fp, len(normal)),
        "正常样本被标存疑": pct(sum(r["verdict"] == "存疑" for r in normal), len(normal)),
        "权威对照·诈骗样本判矛盾": pct(sum("矛盾" in (r["authority_overall"] or "") for r in scam), len(scam)),
        "权威对照·正常样本未判矛盾": pct(sum("矛盾" not in (r["authority_overall"] or "") for r in normal), len(normal)),
        "转人工复核比例(全部)": pct(sum(r["needs_human_review"] for r in rows), len(rows)),
    }
    return out


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="只跑前 N 条（按 scam/normal 交替取样）")
    ap.add_argument("--live", action="store_true")
    ap.add_argument("--ids", default="", help="只跑指定样本，逗号分隔，如 S07,N01")
    ap.add_argument("--out", default="", help="明细输出路径（默认 testset/eval_result.json）")
    args = ap.parse_args()

    samples = [json.loads(l) for l in SAMPLES.read_text(encoding="utf-8").splitlines() if l.strip()]
    if args.limit:
        scam = [s for s in samples if s["label"] == "scam"]
        normal = [s for s in samples if s["label"] == "normal"]
        samples = [x for pair in zip(scam, normal) for x in pair][: args.limit]
    if args.ids:
        want = {x.strip() for x in args.ids.split(",") if x.strip()}
        samples = [s for s in samples if s["id"] in want]

    rows = []
    for i, s in enumerate(samples, 1):
        t0 = time.time()
        try:
            r = run_one(s, args.live)
        except Exception as e:  # noqa: BLE001  单条失败不拖垮整批
            r = {"id": s["id"], "label": s["label"], "category": s["category"], "verdict": "ERROR", "error": str(e),
                 "authority_overall": "", "needs_human_review": False}
        rows.append(r)
        mark = "" if (s["label"] == "borderline" or (s["label"] == "scam") == (r["verdict"] == "诈骗")) else "  <-- 与标签不符"
        print(f"[{i}/{len(samples)}] {s['id']} 标签={s['label']} 判定={r['verdict']} "
              f"权威={r['authority_overall']} ({time.time() - t0:.1f}s){mark}")

    ok = [r for r in rows if r["verdict"] != "ERROR"]
    summary = summarize(ok)
    errors = len(rows) - len(ok)
    print("\n===== 指标 =====")
    for k, v in summary.items():
        print(f"{k}: {v}")
    if errors:
        print(f"调用失败（已排除出指标）: {errors} 条")
    print("\n===== 边界样本（人工看）=====")
    for r in ok:
        if r["label"] == "borderline":
            print(f"{r['id']}: 判定={r['verdict']} 风险={r['risk_level']} 复核={r['needs_human_review']} | {r['reason']}")

    out = Path(args.out) if args.out else OUT
    out.write_text(json.dumps({"summary": summary, "rows": rows}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n明细已写入 {out}")


if __name__ == "__main__":
    main()
