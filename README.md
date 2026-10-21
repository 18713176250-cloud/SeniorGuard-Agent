银龄数字卫士 · 反诈协作系统

多 Agent 协作反诈系统：输入反诈宣传单/短信 → 识别骗术 → 权威对照 → 银龄解读。

技术栈


OpenDev API：大模型推理（骗术识别 / 银龄解读）
AnySearch：RAG 检索（权威反诈中心 + 权威医学库）
OCR：RapidOCR（rapidocr-onnxruntime，拍照/截图文字提取）
Web：FastAPI 接口 + 适老化前端页面（大字号、高对比、语音播报）
多 Agent 协作：输入 → 骗术识别 → 权威对照 → 人工复核 → 银龄解读


环境安装（其他成员必读）

1. 基础环境


Python 3.10+（已在 3.12 验证）
pip
Git


2. 安装 Python 依赖

pip install -r requirements.txt


⚠️ 如果系统代理（如 127.0.0.1:7890）没开，pip 会报 ProxyError：先打开代理，或临时设 NO_PROXY='*' 直连。


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

5. 启动演示网页

python backend/server.py
# 浏览器打开 http://127.0.0.1:8000
# 接口文档：http://127.0.0.1:8000/docs

⚠️ 接口没有认证，只监听 127.0.0.1，仅限本机演示。对外部署前必须加访问控制和频率限制，否则任何人都能消耗团队额度。

接口：
- POST /api/analyze  表单字段 text（文字，≤2000 字）或 image（图片，≤8MB），可选 live=true 联网检索
- POST /api/tts      JSON {"text": "..."}（≤500 字），返回 mp3；联网失败时前端退回浏览器自带朗读

命令行用法仍可用：python backend/main.py "要检测的文字" [--live] [--tts]

6. 量化评测

python backend/scripts/eval_testset.py   # 25 条带标签样本，结果写入 testset/eval_result.json

目录结构

silver-guardian/
├── .env.example       # 配置模板（占位符，可提交）
├── .gitignore         # 忽略 .env
├── requirements.txt   # Python 依赖
├── knowledge_base/    # 反诈知识库语料（RAG）
├── backend/
│   ├── agents/        # input / scam_detector / authority_checker / review_agent / elder_advisor
│   ├── server.py      # FastAPI 接口 + 托管前端
│   ├── main.py        # 主流程 analyze() + 命令行入口
│   ├── scripts/       # 验证脚本（verify_opendev / anysearch / build_kb / verify_ocr）
│   └── config.py      # 统一读 .env
├── testset/           # 带标签测试集 + 评测结果
└── frontend/          # 适老化网页（index.html / style.css / app.js）

常见问题


OpenDev 503：claude 不是有效模型 ID，请用 claude-opus-5。
AnySearch invalid_api_key：Key 必须是 as_sk_ 开头，key_ 开头的是 id 不是 key。
模型返回 ```json 代码块：llm.py 的 parse_json 已兼容。
语音失败（403 / NoAudioReceived）：升级 edge-tts 到 7.3.1；speak() 会自动换音色重试。
额度保护：OpenDev/AnySearch 为团队共享额度，验证用最小 token，避免反复随机调用。
