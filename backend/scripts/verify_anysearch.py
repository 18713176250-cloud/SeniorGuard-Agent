"""验证 AnySearch 检索：为小型反诈知识库检索素材。

运行：python test_anysearch.py
"""
import sys

from anysearch_client import AnySearch, AnySearchError

# Windows 控制台默认 cp1252，强制 UTF-8 以便输出中文
sys.stdout.reconfigure(encoding="utf-8")

QUERIES = [
    "电信网络诈骗常见类型 刷单返利 冒充公检法",
    "杀猪盘 诈骗特征 防范措施",
    "国家反诈中心 APP 预警 提示",
]


def main():
    client = AnySearch()

    tools = [t["name"] for t in client.list_tools()]
    print("可用工具:", tools)
    assert "search" in tools, "缺少 search 工具"

    ok = 0
    for q in QUERIES:
        try:
            text = client.search(q)
        except AnySearchError as e:
            print(f"❌ {q}\n   {e}")
            continue
        print(f"\n✅ {q}  (返回 {len(text)} 字符)")
        print(text[:300].replace("\n", " "), "...")
        ok += bool(text.strip())

    print(f"\n检索成功 {ok}/{len(QUERIES)}")
    raise SystemExit(0 if ok == len(QUERIES) else 1)


if __name__ == "__main__":
    main()
