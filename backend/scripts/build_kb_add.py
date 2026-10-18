"""build_kb_add.py — 定向补齐权威对照盲区素材（kb_21+）

用途：步骤 4-3，针对评测中仍「资料不足」的 4 类骗术补充官方素材：
法院传票扫码 / 冒充亲友换号车祸 / 养老理财保本保息 / 客服退款屏幕共享。
规则：extract 后页面必须包含目标关键词才入库，避免无关页面稀释检索。
运行：python backend/scripts/build_kb_add.py
"""
import os
import re
import sys

from anysearch_client import AnySearch

sys.stdout.reconfigure(encoding="utf-8")

KB_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "knowledge_base")
KB_DIR = os.path.normpath(KB_DIR)

START_ID = 21
MAX_PER_QUERY = 2
MAX_TOTAL = 8

QUERIES = [
    ("法院 传票 扫码 下载APP 诈骗 官方提醒", ["传票", "法院"]),
    ("冒充亲友 换号 出车祸 转账 诈骗 提醒", ["亲友", "换号"]),
    ("养老理财 保本保息 非法集资 提醒", ["保本保息", "理财"]),
    ("客服退款 屏幕共享 诈骗 官方提醒", ["屏幕共享", "退款"]),
]


def existing_urls() -> set:
    urls = set()
    if os.path.isdir(KB_DIR):
        for f in os.listdir(KB_DIR):
            if f.startswith("kb_") and f.endswith(".md"):
                m = re.match(r"# 来源: (\S+)", open(os.path.join(KB_DIR, f), encoding="utf-8").read(500))
                if m:
                    urls.add(m.group(1))
    return urls


def main():
    client = AnySearch()
    seen = existing_urls()
    print(f"已有知识库来源 {len(seen)} 个，开始定向补齐（从 kb_{START_ID:02d} 起）")

    saved = 0
    for q, must_have in QUERIES:
        try:
            text = client.search(q)
            found = re.findall(r"URL\*\*: (https?://\S+)", text)
            print(f"\n[search] {q} → {len(found)} 个 URL")
        except Exception as e:  # noqa: BLE001
            print(f"[search失败] {q} → {e}")
            continue

        got = 0
        for u in found:
            u = u.strip()
            if got >= MAX_PER_QUERY or saved >= MAX_TOTAL:
                break
            if u in seen:
                print(f"  跳过已收录: {u[:60]}")
                continue
            try:
                page = client.extract(u)
                if not any(kw in page for kw in must_have):
                    print(f"  内容不含 {must_have}，跳过: {u[:60]}")
                    continue
                fname = os.path.join(KB_DIR, f"kb_{START_ID + saved:02d}.md")
                with open(fname, "w", encoding="utf-8") as f:
                    f.write(f"# 来源: {u}\n\n{page}")
                print(f"  ✅ kb_{START_ID + saved:02d} ← {u[:60]} ({len(page)} 字符)")
                seen.add(u)
                got += 1
                saved += 1
            except Exception as e:  # noqa: BLE001
                print(f"  ❌ extract 失败: {u[:60]} → {e}")

    print(f"\n补齐完成：新增 {saved} 个文档到 knowledge_base/")


if __name__ == "__main__":
    main()
