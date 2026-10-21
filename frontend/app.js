// 银龄数字卫士前端：左侧常驻数字人 + 右侧两视图（输入 → 结果），核查时右侧显示遮罩。
// 所有模型输出都用 textContent 写入页面，不拼接 HTML，防止注入。
const $ = (id) => document.getElementById(id);
let mode = "text";
let view = "home"; // home | waiting | result
let resultScript = "";

// ---------- 数字人台词（首页 / 等待 / 结果反馈） ----------
const LINES = {
  home: [
    "银龄数字卫士在线帮您！收到可疑的短信、宣传单？别急着信，拍张照或粘贴过来，我帮您辨辨真假。",
    "您好，我是银龄数字卫士。专门帮您识别保健品骗局、冒充客服的短信、中奖陷阱，让骗子无处遁形。",
    "点「上传图片」，拍下您收到的宣传单或短信；或者点「粘贴文字」，把内容贴进来，大约半分钟到一分钟就能出结果。",
    "看不清字没关系，拍照就行。我会用文字识别技术把内容读出来，再帮您判断是不是骗局。",
    "操作很简单，拍一张照、粘一段话，我就能告诉您这是真信息还是假把戏。",
    "有人打电话让您转账、要验证码？先别急，把对方说的话打成文字发给我，我帮您看看。",
  ],
  waiting: [
    "凡是说「包治百病」「国家特批」「买三送三」的，多半是保健品骗局，请多留个心眼。",
    "收到自称公检法、银行客服的电话或短信？记住：真官方不会让您转账、提供验证码。拿不准就来问我。",
    "相信官网，不轻信短信链接；小心骗局，遇事先验证再掏钱。",
    "公检法不会通过电话办案，更没有什么「安全账户」。让您往安全账户转钱的，一定是骗子。",
    "孩子突然换了号码说急需用钱？先打孩子原来的号码，或者问问家里人，核实了再说。",
    "天上不会掉馅饼。说您中了大奖，却要先交手续费的，都是骗局。",
    "我正在帮您核对官方资料，马上就好，您稍等一下。",
  ],
};
const FEEDBACK = {
  诈骗: {
    // 权威对照判为矛盾时，才说「与官方通报一致」
    matched: ["我查过了，这条内容和官方反诈通报对得上，是诈骗信息。", "核对完毕，这和官方通报过的骗局是一个套路，是诈骗。"],
    other: ["我查过了，这条内容有明显的骗局特征，很可能是诈骗。"],
    end: "建议您不点击、不回复、不转账，必要时拨打96110咨询。",
  },
  存疑: {
    other: ["我核对了一遍，这条内容有可疑的地方，先别急着信。"],
    end: "拿不准就先别付钱，问问子女，或者拨打96110。",
  },
  正常: {
    other: ["核对完毕，这份内容没有发现问题，可以放心。", "我查过了，这条内容看起来是正常的。"],
    end: "不过网络信息多留个心眼，拿不准随时来找我。",
  },
};

const lastPick = {};
function pickLine(pool) {
  const arr = LINES[pool];
  let i = Math.floor(Math.random() * arr.length);
  if (arr.length > 1 && i === lastPick[pool]) i = (i + 1) % arr.length; // 不连续重复同一句
  lastPick[pool] = i;
  return arr[i];
}
const pickOne = (arr) => arr[Math.floor(Math.random() * arr.length)];

function buildResultScript(data) {
  const det = data.detection || {};
  const auth = data.authority || {};
  const adv = data.advice || {};
  const body = adv.script || det.reason || "";
  const fb = FEEDBACK[det.verdict] || FEEDBACK["存疑"];
  const matched = det.verdict === "诈骗" && (auth.overall || "").includes("矛盾");
  const head = pickOne(matched && fb.matched ? fb.matched : fb.other);
  return [head, body, fb.end].filter(Boolean).join("\n");
}

// ---------- 星云数字人（可选）：后端配置了 App ID/Secret 才启用 ----------
const XINGYUN_SDK = "https://media.xingyun3d.com/xingyun3d/general/litesdk/xmovAvatar_e2e.2.4.1.js";
let avatarCfg = null;
let agent = null;
let agentReady = null;

const cfgReady = fetch("/api/avatar-config")
  .then((r) => r.json())
  .then((c) => { if (c.enabled) avatarCfg = c; })
  .catch(() => { /* 拿不到配置就只用普通语音 */ });

function setAvatarStatus(msg) {
  $("avatar-status").textContent = msg;
}

function loadScript(src) {
  if (window.XingyunAvatarAgent) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error("数字人组件下载失败"));
    document.head.appendChild(s);
  });
}

// 只初始化一次；失败后允许下次重试
function initAgent() {
  if (agentReady) return agentReady;
  agentReady = (async () => {
    await loadScript(XINGYUN_SDK);
    setAvatarStatus("正在请数字人出场，第一次大约要等十几秒……");
    agent = new window.XingyunAvatarAgent({
      containerId: "", // SDK 2.4.1 类型定义仍要求该字段，实际以 container 为准
      container: $("agent-avatar"),
      appId: avatarCfg.appId,
      appSecret: avatarCfg.appSecret,
      gatewayServer: avatarCfg.gatewayServer,
      onMessage(err) {
        console.error("数字人渲染错误", err && err.code, err && err.message);
      },
      // 每段话开始 / 结束时回调，用来实现「暂停后接着讲」
      onVoiceStateChange(state) {
        console.info("[数字人] 语音", state, `第 ${player.idx + 1}/${player.chunks.length} 句`);
        if (state === "start") onChunkStart();
        else if (state === "end") onChunkEnd();
      },
      agentCallbacks: {
        onError(err) {
          console.error("数字人错误", err && err.code, err && err.message);
          setAvatarStatus("数字人出了点问题，可以点「仅用语音」");
          stopPlayer();
        },
      },
    });
    await agent.init({
      onDownloadProgress(p) {
        const msg = `数字人正在准备 ${Number(p).toFixed(0)}%`;
        setAvatarStatus(msg);
      },
    });
    $("avatar-placeholder").hidden = true;
    setAvatarStatus("");
  })();
  agentReady.catch(() => {
    agentReady = null;
    if (agent) {
      Promise.resolve().then(() => agent.destroy("init_failed")).catch(() => {});
      agent = null;
    }
  });
  return agentReady;
}

// ---------- 播放器：把文稿切成短句逐段播，暂停后从当前这句接着讲 ----------
// SDK 2.4.1 的公开接口只有 speak / interrupt，没有暂停续播，所以在前端按句子记录进度。
const player = {
  chunks: [],
  idx: 0,
  state: "idle", // idle | playing | paused
  started: false, // 当前这段是否已收到 start 回调，用来忽略被打断那段迟到的 end
  timer: null,
  onDone: null,
};

function splitChunks(text) {
  const parts = text.match(/[^。！？!?；;\n]+[。！？!?；;]*/g) || [];
  const chunks = [];
  let buf = "";
  for (const p of parts.map((s) => s.trim()).filter(Boolean)) {
    if (buf && (buf + p).length > 50) {
      chunks.push(buf);
      buf = "";
    }
    buf += p;
  }
  if (buf) chunks.push(buf);
  return chunks;
}

function clearChunkTimer() {
  if (player.timer) clearTimeout(player.timer);
  player.timer = null;
}

function interruptAgent() {
  if (!agent) return;
  try { agent.interrupt("speak"); } catch { /* 未在播报时忽略 */ }
}

function speakCurrentChunk() {
  clearChunkTimer();
  if (player.idx >= player.chunks.length) return finishPlayer();
  const chunk = player.chunks[player.idx];
  player.started = false;
  agent.speak(chunk, true, true);
  // 兜底：万一没收到 end 回调，按字数估算时长后自动讲下一句，避免卡住
  player.timer = setTimeout(() => {
    console.warn("[数字人] 没收到「讲完」回调，按计时进入下一句。如果经常出现，说明 SDK 回调没接上");
    onChunkEnd(true);
  }, chunk.length * 400 + 10000);
}

function onChunkStart() {
  if (player.state === "playing") player.started = true;
}

function onChunkEnd(fromTimer) {
  if (player.state !== "playing") return;
  if (!player.started && !fromTimer) return; // 被打断那段的迟到回调
  player.idx += 1;
  speakCurrentChunk();
}

function finishPlayer() {
  clearChunkTimer();
  player.state = "idle";
  updateControls();
  const done = player.onDone;
  player.onDone = null;
  if (done) done();
}

function stopPlayer() {
  clearChunkTimer();
  if (player.state !== "idle") interruptAgent();
  player.state = "idle";
  player.chunks = [];
  player.onDone = null;
  updateControls();
}

// 用数字人讲一段话；onDone 在正常讲完时调用
function avatarSay(text, statusMsg, onDone) {
  stopPlayer();
  player.chunks = splitChunks(text);
  player.idx = 0;
  player.state = "playing";
  player.onDone = onDone || null;
  setAvatarStatus(statusMsg || "数字人正在讲");
  updateControls();
  speakCurrentChunk();
}

function pausePlayer() {
  if (player.state !== "playing") return;
  clearChunkTimer();
  player.state = "paused";
  player.started = false;
  interruptAgent();
  setAvatarStatus("已暂停，点 ▶ 接着讲");
  updateControls();
}

function resumePlayer() {
  if (player.state !== "paused") return;
  player.state = "playing";
  setAvatarStatus(view === "result" ? "数字人正在讲解" : "数字人正在讲");
  updateControls();
  speakCurrentChunk(); // 从暂停时那句的开头接着讲
}

// ---------- 统一出声：数字人可用就用数字人，否则用语音 ----------
let fallbackActive = false; // 当前是否在用普通语音（audio / 浏览器朗读）

async function say(text, statusMsg, onDone) {
  await cfgReady;
  if (avatarCfg) {
    try {
      await initAgent();
      fallbackActive = false;
      avatarSay(text, statusMsg, onDone);
      return;
    } catch (err) {
      console.error("数字人启动失败", err);
      setAvatarStatus("数字人暂时用不了，改用语音朗读");
    }
  } else {
    setAvatarStatus("正在为您朗读……");
  }
  await speakAudio(text);
}

// ---------- 播报控件 ----------
function updateControls() {
  const toggle = $("toggle-play");
  const synth = "speechSynthesis" in window ? speechSynthesis : null;
  let showToggle = false;
  let paused = false;
  if (!fallbackActive && player.state !== "idle") {
    showToggle = true;
    paused = player.state === "paused";
  } else if (fallbackActive && synth && (synth.speaking || synth.paused)) {
    showToggle = true; // 浏览器朗读也支持暂停 / 继续
    paused = synth.paused;
  }
  toggle.hidden = !showToggle;
  toggle.textContent = paused ? "▶" : "⏸";
  toggle.title = paused ? "继续" : "暂停";
  toggle.setAttribute("aria-label", paused ? "继续播报" : "暂停播报");

  $("replay-avatar").hidden = !(view === "result" && resultScript);
  $("speak").hidden = !(view === "result" && resultScript && avatarCfg);
  const sayBtn = $("say-line");
  sayBtn.hidden = view === "result";
  sayBtn.textContent = view === "waiting" ? "🔊 听一句防骗提醒" : "🔊 听我说一句";
}

// 暂停 / 继续共用一个按钮
$("toggle-play").addEventListener("click", () => {
  if (fallbackActive && "speechSynthesis" in window) {
    if (speechSynthesis.paused) speechSynthesis.resume();
    else speechSynthesis.pause();
    setAvatarStatus(speechSynthesis.paused ? "已暂停，点 ▶ 接着读" : "正在为您朗读……");
    updateControls();
    return;
  }
  if (player.state === "playing") pausePlayer();
  else if (player.state === "paused") resumePlayer();
});

// 重新讲：从头播报结果
$("replay-avatar").addEventListener("click", () => {
  if (resultScript) speakResult();
});

$("speak").addEventListener("click", () => {
  stopPlayer();
  speakAudio(resultScript);
});

// 首页 / 等待页：随机听一句
function sayRandomLine() {
  const pool = view === "waiting" ? "waiting" : "home";
  say(pickLine(pool), pool === "waiting" ? "数字人在陪您等结果" : "数字人正在讲", () => setAvatarStatus(""));
}
$("say-line").addEventListener("click", sayRandomLine);
$("avatar-placeholder").addEventListener("click", sayRandomLine);
// 数字人出场后，在首页 / 等待页直接点数字人也能听一句
$("agent-avatar").addEventListener("click", () => {
  if (view !== "result") sayRandomLine();
});

function speakResult() {
  say(resultScript, "数字人正在讲解", () => setAvatarStatus("讲完了，点 🔁 可以再听一遍"));
}

// ---------- 语音播报（数字人不可用时的备选） ----------
function stopAudio() {
  const audio = $("audio");
  audio.pause();
  if (audio.src) URL.revokeObjectURL(audio.src);
  audio.removeAttribute("src");
  audio.hidden = true;
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  fallbackActive = false;
}

async function speakAudio(text) {
  if (!text) return;
  stopAudio();
  fallbackActive = true;
  const btn = $("speak");
  btn.disabled = true;
  const oldText = btn.textContent;
  btn.textContent = "准备中……";
  try {
    const resp = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: text.slice(0, 500) }),
    });
    if (!resp.ok) throw new Error();
    const audio = $("audio");
    audio.src = URL.createObjectURL(await resp.blob());
    audio.hidden = false; // 自带播放 / 暂停 / 进度条
    await audio.play().catch(() => {});
  } catch {
    // 联网语音失败时，退回浏览器自带朗读
    if ("speechSynthesis" in window) {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "zh-CN";
      u.rate = 0.85;
      u.onend = () => updateControls();
      speechSynthesis.speak(u);
    } else {
      setAvatarStatus("语音暂时不可用");
    }
  } finally {
    btn.disabled = false;
    btn.textContent = oldText;
    updateControls();
  }
}

function stopAllSpeech() {
  stopPlayer();
  stopAudio();
  updateControls();
}

// ---------- 核查遮罩 ----------
function showOverlay(text) {
  $("overlay-text").textContent = text;
  $("overlay").hidden = false;
}
function hideOverlay() {
  $("overlay").hidden = true;
}

function setView(v) {
  view = v;
  $("view-input").hidden = v === "result";
  $("view-result").hidden = v !== "result";
  updateControls();
}

// ---------- 输入方式切换（键盘左右键可切换） ----------
const tabs = [$("tab-text"), $("tab-image")];
function selectTab(tab) {
  tabs.forEach((t) => {
    const on = t === tab;
    t.setAttribute("aria-selected", on);
    t.tabIndex = on ? 0 : -1;
    $(t.getAttribute("aria-controls")).hidden = !on;
  });
  mode = tab.id === "tab-image" ? "image" : "text";
  $("error").textContent = "";
}
tabs.forEach((t, i) => {
  t.addEventListener("click", () => selectTab(t));
  t.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
      selectTab(next);
      next.focus();
    }
  });
});

$("text").addEventListener("input", (e) => ($("count").textContent = e.target.value.length));

$("image").addEventListener("change", (e) => {
  const file = e.target.files[0];
  const img = $("preview");
  if (img.src) URL.revokeObjectURL(img.src);
  if (file) {
    img.src = URL.createObjectURL(file);
    img.hidden = false;
  } else {
    img.hidden = true;
  }
});

// ---------- 核查请求：超时自动取消，遮罩上显示已等待时间 ----------
// 3 分钟；勾选「联网查」时更慢，放宽到 5 分钟。后端单次模型调用超时 120s、最多试 2 次。
// 注意：前端取消只是不再等，后端那次分析仍会跑完（会照常消耗额度）。
const ANALYZE_TIMEOUT_MS = 180 * 1000;
const ANALYZE_TIMEOUT_LIVE_MS = 300 * 1000;

async function fetchAnalyze(fd) {
  const ctrl = new AbortController();
  const limit = fd.get("live") === "true" ? ANALYZE_TIMEOUT_LIVE_MS : ANALYZE_TIMEOUT_MS;
  const timer = setTimeout(() => ctrl.abort(), limit);
  const t0 = Date.now();
  const base = $("overlay-text").textContent;
  const tick = setInterval(() => {
    const sec = Math.round((Date.now() - t0) / 1000);
    // 超过 1 分钟时告诉老人还在查，避免以为卡死了
    $("overlay-text").textContent = sec < 60 ? base : `还在帮您核查，已经等了 ${sec} 秒，网络有点慢，请再稍等……`;
  }, 1000);
  try {
    const resp = await fetch("/api/analyze", { method: "POST", body: fd, signal: ctrl.signal });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.detail || "检测失败，请稍后再试");
    return data;
  } catch (err) {
    if (err.name === "AbortError") throw new Error("网络不太稳定，这次没查完。请再点一次「帮我看看」。");
    throw err;
  } finally {
    clearTimeout(timer);
    clearInterval(tick);
  }
}

// ---------- 提交分析：右侧遮罩 + 并行准备数字人，结果出来后播报 ----------
$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("error").textContent = "";
  const fd = new FormData();
  if (mode === "image") {
    const file = $("image").files[0];
    if (!file) return showError("请先选择一张图片");
    if (file.size > 8 * 1024 * 1024) return showError("图片太大，请控制在 8MB 以内");
    fd.append("image", file);
  } else {
    const text = $("text").value.trim();
    if (!text) return showError("请先粘贴要检测的文字");
    fd.append("text", text);
  }
  fd.append("live", $("live").checked);

  $("submit").disabled = true;
  stopAllSpeech();
  setView("waiting");
  showOverlay("正在帮您核查，大约需要 30 秒到 1 分钟……");

  // 等待期间：数字人准备好了就先讲一句防骗提醒（点按钮还能再听）
  await cfgReady;
  if (avatarCfg) {
    initAgent()
      .then(() => { if (view === "waiting" && player.state === "idle") sayRandomLine(); })
      .catch(() => { /* 结果出来后会退回语音 */ });
  }

  try {
    const data = await fetchAnalyze(fd);

    render(data);
    stopAllSpeech();
    hideOverlay();
    setView("result");
    $("view-result").focus();
    speakResult();
  } catch (err) {
    showError(err.message === "Failed to fetch" ? "连不上服务，请确认后台已启动" : err.message);
    stopAllSpeech();
    hideOverlay();
    setView("home");
    $("submit").disabled = false; // 禁用状态的按钮拿不到焦点，先恢复再聚焦
    $("submit").focus(); // 图片模式下文字框是隐藏的，统一把焦点放回提交按钮
  } finally {
    $("submit").disabled = false;
  }
});

function showError(msg) {
  $("error").textContent = msg;
}

// ---------- 渲染结果 ----------
const VERDICT_STYLE = {
  诈骗: ["danger", "⚠️ 这很可能是骗局"],
  存疑: ["warn", "❓ 这条内容有可疑的地方"],
  正常: ["ok", "✅ 看起来是正常内容"],
};

function li(parent, parts) {
  const item = document.createElement("li");
  parts.forEach(([text, cls]) => {
    if (!text) return;
    const span = document.createElement(cls === "br" ? "div" : "span");
    if (cls && cls !== "br") span.className = cls;
    span.textContent = text;
    item.appendChild(span);
  });
  parent.appendChild(item);
}

function render(data) {
  const det = data.detection || {};
  const auth = data.authority || {};
  const adv = data.advice || {};
  const rev = data.review || {};

  const [cls, fallback] = VERDICT_STYLE[det.verdict] || VERDICT_STYLE["存疑"];
  $("verdict").className = "verdict " + cls;
  $("verdict-title").textContent = adv.headline || fallback;
  $("risk").textContent = `风险等级：${det.risk_level || "未知"}`;

  const tips = $("tips");
  tips.replaceChildren();
  (adv.tips || []).forEach((t) => li(tips, [[t]]));
  $("tips-block").hidden = !(adv.tips || []).length;

  // 播报文稿：先说反馈，再讲解读，最后提醒
  resultScript = buildResultScript(data);
  $("script").textContent = resultScript;
  $("script-block").hidden = !resultScript;

  const tactics = $("tactics");
  tactics.replaceChildren();
  if (!(det.tactics || []).length) li(tactics, [["没有发现明显的骗人手法"]]);
  (det.tactics || []).forEach((t) =>
    li(tactics, [[t.name, "tag bad"], [t.explain], [t.evidence ? `原文：「${t.evidence}」` : "", "br"]])
  );

  $("overall").textContent = `结论：${auth.overall || "无"}`;
  const list = $("authority");
  list.replaceChildren();
  (auth.results || []).forEach((r) => {
    const tagCls = r.judgement === "矛盾" ? "tag bad" : r.judgement === "一致" ? "tag good" : "tag";
    li(list, [[r.judgement, tagCls], [r.claim], [r.basis ? `依据：${r.basis}` : "", "br"], [r.source ? `来源：${r.source}` : "", "src"]]);
  });

  const isImage = data.input && data.input.input_type === "image";
  $("ocr-block").hidden = !isImage;
  $("ocr").textContent = isImage ? data.input.text : "";

  $("review").textContent = rev.needs_human_review ? "这条内容已转给人工再核实一遍。在有结论前，先别付钱、别转账。" : "";
  $("disclaimer").textContent = rev.disclaimer || "";
}

// ---------- 回到第一页 ----------
$("back-home").addEventListener("click", () => {
  stopAllSpeech();
  setAvatarStatus("");
  resultScript = "";
  $("text").value = "";
  $("count").textContent = "0";
  $("image").value = "";
  if ($("preview").src) URL.revokeObjectURL($("preview").src);
  $("preview").removeAttribute("src");
  $("preview").hidden = true;
  $("live").checked = false;
  $("error").textContent = "";
  setView("home");
});

window.addEventListener("beforeunload", () => {
  if (agent) Promise.resolve().then(() => agent.destroy("page_unload")).catch(() => {});
});

updateControls();
