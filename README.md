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
# 星云数字人（可选，不填则页面只用普通语音播报）
XINGYUN_APP_ID=<星云应用 App ID>
XINGYUN_APP_SECRET=<星云应用 App Secret>


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

- GET  /api/avatar-config  返回星云数字人配置；未配置时 {"enabled": false}

⚠️ 星云 Web SDK 要求在浏览器里传 appSecret，/api/avatar-config 会把 Secret 下发给页面。目前只监听 127.0.0.1 所以只有本机可见；对外部署前要改用演示专用应用并限额，或向星云确认能否由服务端签发临时令牌。

### 云平台部署（Render）

仓库根目录已有 `render.yaml`。步骤：

1. 登录 https://render.com，用 GitHub 授权。
2. New > Blueprint，选 `SeniorGuard-Agent` 仓库，分支 main。
3. 在环境变量里填 `OPENDEV_API_KEY`、`ANYSEARCH_API_KEY`，数字人用的 `XINGYUN_APP_ID` / `XINGYUN_APP_SECRET`（可留空，页面就不显示数字人）。
4. 部署完成后得到 `https://seniorguard-agent-xxxx.onrender.com`，这就是部署链接。

注意：
- 已内置限频（每 IP 每分钟 4 次分析，全站每小时 120 次），可用 `RATE_ANALYZE_PER_MIN` 等环境变量调整。没有访问口令，链接公开后任何人都能消耗额度。
- 公网部署会把星云 appSecret 下发给访问者，请用演示专用应用。
- 免费实例 15 分钟无访问会休眠，首次打开约需 1 分钟唤醒；内存 512MB，OCR 依赖较重，上传图片可能超限。演示前先打开一次预热。

页面交互：

- 左侧常驻数字人（首页、核查中、结果页共用一个会话，只初始化一次）。
- 首页：点数字人或「🔊 听我说一句」，随机讲一句开场欢迎 / 操作引导。
- 核查中：右侧显示遮罩，数字人就绪后先讲一句反诈警示；点「🔊 听一句防骗提醒」可以再随机听一句。
- 结果页：先说结果反馈（诈骗且权威对照判矛盾时才说「与官方反诈通报一致」），再播银龄解读，最后给做法建议。
- ⏸ / ▶ 同一个按钮：暂停后点 ▶ 从当前这句接着讲；🔁 从头再讲。星云 SDK 2.4.1 只提供 speak / interrupt，没有暂停续播接口，所以前端把文稿按句切段逐段播报，续播粒度是「一句」。
- 数字人初始化失败或未配置时，自动退回 edge-tts 语音；再失败退回浏览器自带朗读。

台词在 frontend/app.js 顶部的 LINES / FEEDBACK 里，直接改即可。

命令行用法仍可用：python backend/main.py "要检测的文字" [--live] [--tts]

前端播报逻辑测试（模拟 DOM 和星云 SDK，不需要浏览器、不耗额度）：

node tests/frontend_player.test.js

真机排查：浏览器 F12 控制台里，每句话开始/结束会打印「[数字人] 语音 start/end」。如果频繁出现「没收到「讲完」回调，按计时进入下一句」，说明 SDK 回调没接上，句子之间会有明显停顿。

6. 量化评测

python backend/scripts/eval_testset.py                    # 25 条带标签样本，结果写入 testset/eval_result.json
python backend/scripts/eval_testset.py --ids S07,N01      # 只跑指定样本（调提示词时先小范围验证）
python backend/scripts/eval_testset.py --out testset/x.json

最新结果（v6，25 条：诈骗 12 / 正常 10 / 边界 3）：

完成 22/25 条（S04、S12、N01 三条连续 3 次遇到模型接口断连，没有拿到结果，不计入指标，也不算判错）。

| 指标 | 结果 |
|---|---|
| 诈骗召回率（判为诈骗） | 10/10 = 100% |
| 诈骗精确率 | 10/10 = 100% |
| 误伤率（正常被判诈骗） | 0/9 = 0% |
| 正常样本被标存疑 | 0/9 = 0% |
| 权威对照·诈骗样本判矛盾 | 10/10 = 100% |
| 权威对照·正常样本未判矛盾 | 9/9 = 100% |
| 转人工复核比例 | 6/22 = 27% |

边界样本 B01–B03 均判为正常并转人工复核。明细：testset/eval_result_v6_merged.json（由 backend/scripts/merge_eval.py 合并全量和重跑结果生成）。

各版本对比：

| 版本 | 改动 | 权威对照·诈骗判矛盾 |
|---|---|---|
| v3 | 本地知识库 RAG，top_k=4 | 9/12 = 75% |
| v4 | 检索 top_k 4→8 | 11/12 = 92% |
| v6 | 修 S07：识别 Agent 只输出原文说法，权威 Agent 明确「官方提示的诈骗套路判矛盾」 | 10/10 = 100%（22 条完成） |

已知问题：

- 评测 v6 有 3 条样本（S04、S12、N01）因接口断连未跑出结果；它们在 v4 全量里分别判对，v6 的 100% 基于 22 条，样本量小，不代表线上准确率。
- 模型接口今天断连较多。已给客户端设 120 秒超时（之前无超时，单条曾卡住 1 小时以上），并改为 3s→6s 退避重试；演示前建议先跑一遍样本确认接口通畅。
- 网页请求：每次模型调用最多试 2 次（环境变量 WEB_LLM_RETRIES 可改，评测脚本仍是 3 次）；前端 3 分钟没结果自动取消并提示「再点一次」（勾选联网查时 5 分钟），等待超过 1 分钟时遮罩会显示已等待秒数。前端取消后，后端那次分析仍会跑完并消耗额度。
- 数字人「继续」按句续播：暂停后从当前这句的开头重讲，不是从半句接上（SDK 无暂停续播接口）。
- 星云 appSecret 会下发到浏览器，仅限本机演示，见上文接口说明。

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
├── tests/             # 前端播报逻辑测试（node 直接跑）
├── testset/           # 带标签测试集 + 评测结果
└── frontend/          # 适老化网页（index.html / style.css / app.js）

常见问题


OpenDev 503：claude 不是有效模型 ID，请用 claude-opus-5。
AnySearch invalid_api_key：Key 必须是 as_sk_ 开头，key_ 开头的是 id 不是 key。
模型返回 ```json 代码块：llm.py 的 parse_json 已兼容。
语音失败（403 / NoAudioReceived）：升级 edge-tts 到 7.3.1；speak() 会自动换音色重试。
额度保护：OpenDev/AnySearch 为团队共享额度，验证用最小 token，避免反复随机调用。
