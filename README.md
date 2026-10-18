银龄数字卫士 · 反诈协作系统

多 Agent 协作反诈系统：输入反诈宣传单/短信 → 识别骗术 → 权威对照 → 银龄解读。

技术栈


OpenDev API：大模型推理（骗术识别 / 银龄解读）
AnySearch：RAG 检索（权威反诈中心 + 权威医学库）
OCR：PaddleOCR（拍照/截图文字提取）
4-Agent 协作：输入 → 骗术识别 → 权威对照 → 银龄解读


环境安装（其他成员必读）

1. 基础环境


Python 3（建议 3.9~3.11，PaddleOCR 兼容性更好）
pip
Git


2. 安装 Python 依赖

pip install -r requirements.txt


⚠️ paddleocr / paddlepaddle 首次运行会自动下载模型（约几十 MB），且需与 Python 版本匹配。


3. 配置 API Key（各自配置，不提交 Git）

复制 .env.example 为 .env，填入自己的 Key：

OPENDEV_API_KEY=<你的OpenDev key>
OPENDEV_BASE_URL=https://api.openai-next.com/v1
OPENDEV_MODEL=claude-opus-5
ANYSEARCH_MCP_URL=https://api.anysearch.com/mcp
ANYSEARCH_API_KEY=<你的AnySearch key，as_sk_开头>


⚠️ .env 已被 .gitignore 忽略，绝不提交进 Git。Key 通过安全渠道（飞书/队长）分发。


4. 验证是否装好（逐项运行）

# OpenDev 连通（1-4）
python backend/scripts/verify_opendev.py
# 预期：返回 {"is_scam": true, ...} 结构化 JSON

# AnySearch 检索（1-5）
python backend/scripts/verify_anysearch.py
# 预期：检索成功 3/3

# OCR 文字提取（1-6）
python backend/scripts/verify_ocr.py 测试图片.png
# 预期：打印提取出的文字

目录结构

silver-guardian/
├── .env.example       # 配置模板（占位符，可提交）
├── .gitignore         # 忽略 .env
├── requirements.txt   # Python 依赖
├── knowledge_base/    # 反诈知识库语料（RAG）
├── backend/
│   ├── agents/        # 4 个 Agent（input/scam_detector/authority_checker/elder_advisor）
│   ├── scripts/       # 验证脚本（verify_opendev / anysearch / build_kb / verify_ocr）
│   └── config.py      # 统一读 .env
└── frontend/          # 网页/小程序（粘贴/上传/拍照入口）

常见问题


OpenDev 503：claude 不是有效模型 ID，请用 claude-opus-5。
AnySearch invalid_api_key：Key 必须是 as_sk_ 开头，key_ 开头的是 id 不是 key。
额度保护：OpenDev/AnySearch 为团队共享额度，验证用最小 token，避免反复随机调用。
