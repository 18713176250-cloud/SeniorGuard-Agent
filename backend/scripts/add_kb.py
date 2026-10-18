"""add_kb.py — 向 knowledge_base/ 追加语料（不覆盖已有文件，按已有最大编号继续）。

针对评测暴露的缺口：公检法、冒充亲友、投资理财、中奖/刷单、客服退款、屏幕共享，
以及正常对照用的权威健康数据（食盐、运动、糖尿病、保健食品标识）。

用法（项目根目录）：
    python backend/scripts/add_kb.py --dry-run   # 只检索、列出候选 URL，不抓取
    python backend/scripts/add_kb.py             # 抓取并追加
"""
import argparse
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from anysearch_client import AnySearch  # noqa: E402

KB_DIR = Path(__file__).resolve().parents[2] / "knowledge_base"

# (查询词, 最多取几个新 URL)
QUERIES = [
    # S01 药监局特批 / 根治糖尿病 / 虚假疗效
    ("国家药监局 提醒 保健食品 不得宣称 治疗疾病 虚假宣传 老年人", 2),
    ("糖尿病 根治 虚假宣传 药监局 市场监管总局 警示", 1),
    # S06 法院传票 / 扫码下载APP
    ("法院传票 二维码 下载APP 诈骗 最高人民法院 提醒", 2),
    # S07 冒充亲友
    ("冒充子女 冒充亲友 车祸 急需用钱 诈骗 公安 提醒 老年人", 2),
    # S09 中奖 / 免费送 / 手续费
    ("中奖 缴纳手续费 诈骗 公安 提醒", 2),
    ("免费领 礼品 老年人 讲座 推销 保健品 诈骗 市场监管局", 2),
    # S11 客服退款 / 屏幕共享
    ("冒充客服 退款 下载 屏幕共享 诈骗 公安部 反诈中心 提醒", 2),
    # 通用：官方反诈要点（公检法不会电话转账）
    ("公安机关 不会 电话 要求 转账 安全账户 国家反诈中心 提醒", 2),
]

MAX_NEW = 14
MAX_CHARS = 20000  # 单篇上限，避免网页噪声占满库


def existing_urls():
    urls = set()
    for f in KB_DIR.glob("kb_*.md"):
        m = re.match(r"# 来源: (\S+)", f.read_text(encoding="utf-8", errors="ignore")[:300])
        if m:
            urls.add(m.group(1))
    return urls


def next_index():
    nums = [int(m.group(1)) for f in KB_DIR.glob("kb_*.md") if (m := re.match(r"kb_(\d+)\.md", f.name))]
    return max(nums, default=-1) + 1


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    client = AnySearch()
    have = existing_urls()
    picked = []  # (query, url)
    for q, n in QUERIES:
        try:
            text = client.search(q)
        except Exception as e:  # noqa: BLE001
            print(f"❌ 检索失败 {q} → {e}")
            continue
        urls = [u.strip() for u in re.findall(r"URL\*\*: (https?://\S+)", text)]
        new = [u for u in dict.fromkeys(urls) if u not in have and u not in {p[1] for p in picked}][:n]
        for u in new:
            picked.append((q, u))
        print(f"✅ {q} → 候选 {len(urls)}，新增 {len(new)}")
        for u in new:
            print(f"     {u}")

    picked = [p for p in picked if not any(b in p[1] for b in ("aia.com.cn", "cjc.ny.gov"))][:MAX_NEW]  # 排除商业保险公司 PDF，非权威源
    if args.dry_run:
        print(f"\n[dry-run] 将抓取 {len(picked)} 个页面，未写入。")
        return

    idx = next_index()
    saved = 0
    for q, url in picked:
        try:
            text = client.extract(url)
        except Exception as e:  # noqa: BLE001
            print(f"❌ 抓取失败 {url} → {e}")
            continue
        if len(re.findall(r"[一-鿿]", text)) < 200:
            print(f"⚠️ 跳过（中文正文过少，可能是空页/拦截页）{url}")
            continue
        path = KB_DIR / f"kb_{idx:02d}.md"
        path.write_text(f"# 来源: {url}\n\n{text[:MAX_CHARS]}", encoding="utf-8")
        print(f"✅ [{idx:02d}] {url} → {min(len(text), MAX_CHARS)} 字符  ({q[:16]}…)")
        idx += 1
        saved += 1
    print(f"\n追加 {saved} 篇，知识库共 {len(list(KB_DIR.glob('kb_*.md')))} 篇。")


if __name__ == "__main__":
    main()
