"""build_kb.py — 用 AnySearch 建小反诈知识库（RAG 语料）

用途：任务 1-5 / 2-3，为 Agent ③ 权威对照建 RAG 知识库。
素材来源：官方反诈中心通报 + 权威医学/健康库。
运行：python build_kb.py
"""
import os
from anysearch_client import AnySearch

# 创建知识库目录
KB_DIR = "knowledge_base"
os.makedirs(KB_DIR, exist_ok=True)

client = AnySearch()

# 权威反诈/健康语料来源（用 search 找到的高质量源 + 补充官方源）
QUERIES = [
    "保健品 包治百病 虚假宣传 国家药监局 通报",
    "冒充公检法 诈骗 官方提醒",
    "杀猪盘 虚假投资 诈骗 防范",
    "权威医学 辟谣 包治百病 虚假疗效",
    "正规养生 建议 老年健康 辟谣",
]

def main():
    # 步骤1：search 检索权威源，得到 URL 清单
    print("=== 步骤 1: 用 search 收集权威源 URL ===")
    urls = set()
    for q in QUERIES:
        try:
            text = client.search(q)
            # 从结果中解析 URL（AnySearch 返回的文本里含 URL）
            import re
            found = re.findall(r'URL\*\*: (https?://\S+)', text)
            for u in found:
                urls.add(u.strip())
            print(f"  ✅ {q} → 收集到 {len(found)} 个 URL")
        except Exception as e:
            print(f"  ❌ {q} → {e}")

    # 步骤2：用 extract 抓取每个 URL 全文，存为 Markdown
    print(f"\n=== 步骤 2: 用 extract 抓取 {len(urls)} 个页面 ===")
    saved = 0
    for i, url in enumerate(list(urls)[:8]):  # 控制数量，避免过度调用
        try:
            text = client.extract(url)
            fname = os.path.join(KB_DIR, f"kb_{i:02d}.md")
            with open(fname, "w", encoding="utf-8") as f:
                f.write(f"# 来源: {url}\n\n{text}")
            print(f"  ✅ [{i}] {url} → {len(text)} 字符")
            saved += 1
        except Exception as e:
            print(f"  ❌ [{i}] {url} → {e}")

    print(f"\n知识库建成：{KB_DIR}/ 下 {saved} 个文档")
    print("提示：后续 Agent ③ 可对这些语料做 RAG 检索与矛盾判定。")

if __name__ == "__main__":
    main()