"""Agent ③ 权威对照：RAG 检索官方反诈/医学资料，判定说法与权威信息是否矛盾。

检索层：本地 knowledge_base/*.md（分块 + 字符二元组重叠打分，无需向量库）。
可选：use_live=True 时再用 AnySearch 实时补充检索（消耗共享额度，默认关闭）。
"""
import re
from pathlib import Path

from agents.llm import chat_json

KB_DIR = Path(__file__).resolve().parents[2] / "knowledge_base"
CHUNK_SIZE = 400
# 骗术关键词：claim 与资料块同时命中时大幅加权，提升官方反驳段落的检索命中率
RISK_KEYWORDS = (
    "特批", "传票", "安全账户", "中奖", "手续费", "屏幕共享", "共享", "换号",
    "车祸", "保本保息", "包治百病", "根治", "公检法", "洗钱", "退款", "客服",
    "冻结", "涉案", "养老金", "收藏", "投资", "收益", "药监", "批准文号", "审批",
)
_chunks_cache = None


def _clean(raw: str) -> str:
    """去掉 markdown 链接/图片/网址等网页噪声，保留正文。"""
    raw = raw.replace("\\n", "\n").replace("\\u0026", "&")
    raw = re.sub(r"!?\[([^\]]*)\]\([^)]*\)", r"\1", raw)
    raw = re.sub(r"https?://\S+", "", raw)
    raw = re.sub(r"[ \t]+", " ", raw)
    return raw


def _load_chunks():
    global _chunks_cache
    if _chunks_cache is not None:
        return _chunks_cache
    chunks = []
    for f in sorted(KB_DIR.glob("kb_*.md")):
        text = f.read_text(encoding="utf-8", errors="ignore")
        m = re.match(r"# 来源: (\S+)", text)
        source = m.group(1) if m else f.name
        body = _clean(text)
        # 只保留含中文的有效行，再按长度分块
        lines = [l.strip() for l in body.splitlines() if len(re.findall(r"[一-鿿]", l)) >= 8]
        buf = ""
        for line in lines:
            buf += line + "\n"
            if len(buf) >= CHUNK_SIZE:
                chunks.append({"source": source, "text": buf.strip()})
                buf = ""
        if buf.strip():
            chunks.append({"source": source, "text": buf.strip()})
    _chunks_cache = chunks
    return chunks


# 查询里的通用词，不携带主题信息，打分前剔除
_STOP = {"是否", "需要", "提供", "存在", "会否", "能否", "可以", "进行", "要求", "所谓", "相关", "什么", "如何",
         "该", "的", "是", "会", "有", "在", "和", "与", "或", "及", "等", "对", "为", "被", "将", "把", "让"}


def _bigrams(s: str) -> set:
    s = re.sub(r"[^一-鿿A-Za-z0-9]", "", s)
    return {s[i : i + 2] for i in range(len(s) - 1)}


def _df():
    """二元组文档频率：越少见的二元组（如「传票」「手续费」）区分度越高。"""
    global _df_cache
    if _df_cache is None:
        from collections import Counter

        c = Counter()
        for ch in _load_chunks():
            c.update(_bigrams(ch["text"]))
        _df_cache = c
    return _df_cache


_df_cache = None


def retrieve(query: str, top_k: int = 8) -> list[dict]:
    import math

    q = {g for g in _bigrams(query) if g not in _STOP and not (g[0] in _STOP and g[1] in _STOP)}
    if not q:
        return []
    chunks = _load_chunks()
    df, n = _df(), len(chunks)
    idf = {g: math.log((n + 1) / (df.get(g, 0) + 1)) + 1 for g in q}
    total = sum(idf.values())
    scored = []
    for c in chunks:
        hit = sum(idf[g] for g in q & _bigrams(c["text"]))
        if hit > 0:
            scored.append((hit / total, c))  # 归一化到 0~1：命中的加权比例
    scored.sort(key=lambda x: x[0], reverse=True)
    return [{**c, "score": round(s, 2)} for s, c in scored[:top_k]]


def _live_search(query: str) -> list[dict]:
    try:
        from config import get_anysearch

        text = get_anysearch().search(query)
        return [{"source": "AnySearch 实时检索", "text": text[:1500], "score": 0}]
    except Exception as e:  # noqa: BLE001
        return [{"source": "AnySearch 检索失败", "text": str(e), "score": 0}]


SYSTEM = """你是权威对照员。根据【权威资料】客观判断【待核实说法】是否与官方信息矛盾。
原则：
1. 只依据给出的资料下结论；资料不足以判断时，judgement 必须是 "无法判定"，不要凭空编造。
2. 不冤枉正常内容：说法与资料一致或无冲突时，不要判矛盾。
3. basis 必须引用资料中的原文要点，并给出 source。
只输出 JSON：
{"results": [{"claim": "说法", "judgement": "矛盾|一致|无法判定", "basis": "依据要点", "source": "来源URL或名称"}], "overall": "与官方信息矛盾|与官方信息一致|资料不足，建议人工复核", "need_human_review": true|false}"""


def run(text: str, detection: dict, use_live: bool = False) -> dict:
    claims = detection.get("claims_to_verify") or [text[:120]]
    evidence, seen = [], set()
    for claim in claims:
        hits = retrieve(claim)
        if use_live:
            hits += _live_search(claim)
        for h in hits:
            key = h["text"][:60]
            if key not in seen:
                seen.add(key)
                evidence.append(h)
    if not evidence:
        return {"results": [], "overall": "资料不足，建议人工复核", "need_human_review": True, "evidence": []}

    context = "\n\n".join(f"[资料{i+1}] 来源: {e['source']}\n{e['text']}" for i, e in enumerate(evidence))
    user = "待核实说法：\n" + "\n".join(f"- {c}" for c in claims) + f"\n\n权威资料：\n{context}"
    out = chat_json(SYSTEM, user)
    out["evidence"] = [{"source": e["source"], "score": e["score"]} for e in evidence]
    # 存疑一律转人工复核
    if out.get("overall", "").startswith("资料不足") or detection.get("verdict") == "存疑":
        out["need_human_review"] = True
    return out
