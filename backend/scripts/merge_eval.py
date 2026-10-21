"""合并多次评测结果：同一样本以成功的那次为准，重算指标（用于接口断连后只重跑失败样本）。

用法（项目根目录）：
    python backend/scripts/merge_eval.py . testset/eval_result_v6.json testset/eval_result_v6_retry.json ...
输出 testset/eval_result_v6_merged.json。仍失败的样本列在 still_error 里，不计入指标。
"""
import json, sys
sys.stdout.reconfigure(encoding="utf-8")
from pathlib import Path
root = Path(sys.argv[1])
sys.path.insert(0, str(root / "backend" / "scripts"))
sys.path.insert(0, str(root / "backend"))
from eval_testset import summarize
files = sys.argv[2:]
order = [json.loads(l)["id"] for l in (root / "testset/samples.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
best = {}
for f in files:
    p = root / f
    if not p.exists():
        continue
    for r in json.loads(p.read_text(encoding="utf-8"))["rows"]:
        if r["verdict"] != "ERROR" or r["id"] not in best:
            best[r["id"]] = r
rows = [best[i] for i in order if i in best]
ok = [r for r in rows if r["verdict"] != "ERROR"]
summary = summarize(ok)
missing = [r["id"] for r in rows if r["verdict"] == "ERROR"]
out = root / "testset/eval_result_v6_merged.json"
out.write_text(json.dumps({"summary": summary, "rows": rows, "sources": files, "still_error": missing}, ensure_ascii=False, indent=2), encoding="utf-8")
print("成功样本", len(ok), "/", len(rows), "仍失败", missing)
for k, v in summary.items():
    print(f"{k}: {v}")
for r in ok:  # 只检查有结果的样本，ERROR 不算误判
    if r["label"] == "scam" and "矛盾" not in (r.get("authority_overall") or ""):
        print("诈骗未判矛盾:", r["id"], r.get("authority_overall"))
    if r["label"] == "normal" and r["verdict"] == "诈骗":
        print("误伤:", r["id"])
