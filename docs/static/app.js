// 银龄数字卫士前端：左侧常驻数字人 + 右侧两视图（输入 → 结果），核查时右侧显示遮罩。
// 所有模型输出都用 textContent 写入页面，不拼接 HTML，防止注入。
const $ = (id) => document.getElementById(id);
let mode = "text";
let view = "home"; // home | waiting | result
let resultScript = "";

// ---------- 数字人台词（首页 / 等待 / 结果反馈） ----------
// 每条台词只有一句话：点一下随机讲一句就够了
const LINES = {
  home: [
    "我是银龄数字卫士，收到可疑短信或宣传单，拍张照发给我看看。",
    "不确定是不是骗局？粘贴文字或拍照，我帮您辨真假。",
    "看不清字没关系，拍照就行，我来帮您读。",
    "操作很简单，拍一张照或粘一段话，就能出结果。",
    "有人让您转账、要验证码？先别急，发给我帮您看看。",
    "保健品、中奖、冒充客服，这些骗局我都能帮您识别。",
  ],
  waiting: [
    "凡是说包治百病、国家特批的，多半是骗局。",
    "真官方不会让您转账，也不会向您要验证码。",
    "公检法不会电话办案，也没有什么安全账户。",
    "孩子换号码要钱？先打他原来的号码核实。",
    "天上不会掉馅饼，中奖先交手续费的都是骗局。",
    "不轻信短信链接，遇事先验证再掏钱。",
    "我正在帮您核对官方资料，马上就好。",
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

const cfgReady = fetch((window.API_BASE || "") + "/api/avatar-config")
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

// 等数字人出第一帧再撤掉占位图，避免中间露出黑屏（最多等 8 秒）
function waitFirstFrame() {
  return new Promise((resolve) => {
    const box = $("agent-avatar");
    const t0 = Date.now();
    const tick = () => {
      const v = box.querySelector("video");
      const c = box.querySelector("canvas");
      const ok = (v && v.readyState >= 2 && v.videoWidth > 0) || (!v && c && c.width > 0);
      if (ok || Date.now() - t0 > 8000) return setTimeout(resolve, 250);
      setTimeout(tick, 150);
    };
    tick();
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
    await waitFirstFrame();
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
  toggle.innerHTML = `<svg class="ic" aria-hidden="true"><use href="#i-${paused ? "play" : "pause"}"/></svg>`;
  toggle.title = paused ? "继续" : "暂停";
  toggle.setAttribute("aria-label", paused ? "继续播报" : "暂停播报");

  $("replay-avatar").hidden = !(view === "result" && resultScript);
  $("speak").hidden = !(view === "result" && resultScript && avatarCfg);
  const sayBtn = $("say-line");
  sayBtn.hidden = view === "result";
  sayBtn.innerHTML = '<svg class="ic" aria-hidden="true"><use href="#i-sound"/></svg> ' + (view === "waiting" ? "听一句防骗提醒" : "听我说一句");
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
    const resp = await fetch((window.API_BASE || "") + "/api/tts", {
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
function setProgress(pct, text) {
  const v = Math.max(0, Math.min(100, Math.round(pct)));
  $("pbar-fill").style.width = v + "%";
  $("pbar-pct").textContent = v + "%";
  document.querySelector(".pbar").setAttribute("aria-valuenow", v);
  if (text) $("overlay-text").textContent = text;
}
function showOverlay(text) {
  setProgress(0, text);
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
  // 进度条：按经验耗时（约 30 秒）缓慢逼近 95%，结果回来前不会走满；超过 40 秒补一句安抚
  const showWait = () => {
    const sec = (Date.now() - t0) / 1000;
    const pct = 95 * (1 - Math.exp(-sec / 22));
    setProgress(pct, sec < 40 ? "正在帮您核查，请稍等……" : "还在帮您核查，网络有点慢，请再稍等……");
  };
  showWait();
  const tick = setInterval(showWait, 1000);
  try {
    const resp = await fetch((window.API_BASE || "") + "/api/analyze", { method: "POST", body: fd, signal: ctrl.signal });
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
  showOverlay("正在帮您核查，请稍等……");

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
    const isBlock = cls && /^(br|basis)\b/.test(cls);
    const span = document.createElement(isBlock ? "div" : "span");
    if (cls && cls !== "br") span.className = cls;
    span.textContent = text;
    item.appendChild(span);
  });
  parent.appendChild(item);
}

// 来源：http(s) 开头的做成新页面打开的超链接，其余只显示文字
function makeSourceNode(src) {
  const text = String(src).trim();
  if (/^https?:\/\//i.test(text)) {
    const a = document.createElement("a");
    a.href = text;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    try {
      const u = new URL(text);
      a.textContent = u.hostname.replace(/^www\./, "") + (u.pathname.length > 1 ? " · " + decodeURIComponent(u.pathname).slice(0, 40) : "");
    } catch (e) {
      a.textContent = text;
    }
    a.title = text;
    return a;
  }
  return document.createTextNode(text);
}

// ---------- 原文展示 + 矛盾语句高亮 ----------
function bigrams(t) {
  const s = t.replace(/[\s，。,.！!？?、；;：:“”"'（）()]/g, "");
  const out = new Set();
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
}

function findHighlightRanges(text, data) {
  const auth = data.authority || {};
  const det = data.detection || {};
  const bad = (auth.results || []).filter((r) => r.judgement === "矛盾");
  const ranges = [];
  const add = (a, b) => { if (b > a) ranges.push([a, b]); };

  const exact = (frag) => {
    frag = (frag || "").trim();
    if (frag.length < 4) return false;
    const i = text.indexOf(frag);
    if (i < 0) return false;
    add(i, i + frag.length);
    return true;
  };

  // 句子切分（保留位置）
  const sents = [];
  const re = /[^。！？!?；;，,\n]+[。！？!?；;，,\n]*/g;
  let m;
  while ((m = re.exec(text))) sents.push([m.index, m.index + m[0].length, m[0]]);

  bad.forEach((r) => {
    const claim = r.claim || "";
    if (exact(claim)) return;
    let hit = false;
    claim.split(/[，。,.；;、\s]+/).forEach((c) => { if (exact(c)) hit = true; });
    if (hit) return;
    // 说法是转述：选与说法重合最多的那一句
    const cb = bigrams(claim);
    if (!cb.size) return;
    let best = null, bestScore = 0;
    sents.forEach((s) => {
      const sb = bigrams(s[2]);
      let n = 0;
      cb.forEach((g) => { if (sb.has(g)) n++; });
      const score = n / cb.size;
      if (score > bestScore) { bestScore = score; best = s; }
    });
    if (best && bestScore >= 0.3) add(best[0], best[1]);
  });

  // 兜底：有矛盾但没定位到，用识别出的骗人手法里的原文引用
  if (bad.length && !ranges.length) {
    (det.tactics || []).forEach((t) => exact(t.evidence));
  }

  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  ranges.forEach((r) => {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push(r.slice());
  });
  return merged;
}

function renderOriginal(data) {
  const isImage = data.input && data.input.input_type === "image";
  const text = (data.input && data.input.text) || "";
  $("orig-title").firstChild.textContent = isImage ? "从图片里认出的文字" : "您输入的内容";
  const box = $("orig-text");
  box.replaceChildren();
  if (!text) {
    box.textContent = "（没有内容）";
    return;
  }
  let pos = 0;
  const ranges = findHighlightRanges(text, data);
  ranges.forEach(([a, b]) => {
    if (a > pos) box.append(text.slice(pos, a));
    const mk = document.createElement("mark");
    mk.textContent = text.slice(a, b);
    box.appendChild(mk);
    pos = b;
  });
  if (pos < text.length) box.append(text.slice(pos));
  document.querySelector(".orig-legend").hidden = !ranges.length;
}

// ---------- 诈骗概率 ----------
function estimateProb(det) {
  const table = {
    诈骗: { 高: 92, 中: 80, 低: 68 },
    存疑: { 高: 62, 中: 50, 低: 38 },
    正常: { 高: 20, 中: 12, 低: 5 },
  };
  return (table[det.verdict] || table["存疑"])[det.risk_level] ?? 50;
}
function renderProb(det, cls) {
  const raw = Number(det.scam_probability);
  const pct = Number.isFinite(raw) && det.scam_probability !== null && det.scam_probability !== "" ? Math.max(0, Math.min(100, Math.round(raw))) : estimateProb(det);
  $("v-ring").className = "v-ring " + cls;
  $("prob-num").textContent = pct + "%";
  $("ring").style.setProperty("--p", pct);
  $("ring").setAttribute("aria-label", `诈骗概率 ${pct}%`);
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
  renderProb(det, cls);

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
    li(list, [[r.judgement, tagCls], [r.claim, r.judgement === "矛盾" ? "claim hl" : "claim"], [r.basis ? `依据：${r.basis}` : "", "basis"]]);
    if (r.source) {
      const item = list.lastChild;
      const row = document.createElement("div");
      row.className = "src";
      row.append("来源：");
      row.appendChild(makeSourceNode(r.source));
      item.appendChild(row);
    }
  });
  if (!(auth.results || []).length) li(list, [["暂时没有可对照的官方说法"]]);

  renderOriginal(data);

  const evList = $("evidence");
  evList.replaceChildren();
  const seen = new Set();
  (auth.evidence || []).forEach((e) => {
    if (!e.source || seen.has(e.source)) return;
    seen.add(e.source);
    const item = document.createElement("li");
    item.appendChild(makeSourceNode(e.source));
    evList.appendChild(item);
  });
  $("evidence-wrap").hidden = !seen.size;

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

// ---------- 界面增强：字号、语音引导、示例、清空、听结果 ----------
(function () {
  const root = document.documentElement;
  let size = parseInt(localStorage.getItem("sg-font") || "20", 10);
  const applySize = () => { size = Math.min(26, Math.max(16, size)); root.style.fontSize = size + "px"; localStorage.setItem("sg-font", size); };
  applySize();
  $("font-up").addEventListener("click", () => { size += 2; applySize(); });
  $("font-down").addEventListener("click", () => { size -= 2; applySize(); });

  $("voice-guide").addEventListener("click", sayRandomLine);

  document.querySelectorAll(".chip").forEach((c) =>
    c.addEventListener("click", () => {
      selectTab($("tab-text"));
      const t = $("text");
      t.value = c.dataset.sample;
      $("count").textContent = t.value.length;
      t.focus();
    })
  );

  $("clear").addEventListener("click", () => {
    $("text").value = "";
    $("count").textContent = "0";
    $("image").value = "";
    $("preview").hidden = true;
    $("error").textContent = "";
  });

  $("listen-result").addEventListener("click", () => { if (resultScript) speakResult(); });
  $("back-top").addEventListener("click", () => $("back-home").click());
})();


// ---------- 常见骗局：点开看典型案例 ----------
const SCAM_CASES = {
  kefu: {
    title: "冒充客服",
    cases: [
      ["“退款理赔”变转账", "接到自称电商平台客服的电话，说您买的商品有质量问题要赔偿，让您下载“屏幕共享”软件、报出短信验证码。对方趁机操作手机，把银行卡里的钱转走。"],
      ["“关闭会员自动扣费”", "自称平台客服，说您的会员每月自动扣费，要帮您关闭，并让您按“指引”给所谓的“安全账户”转账来验证。其实根本没有什么自动扣费。"],
    ],
    tip: "正规客服不会要求您共享屏幕、报验证码或转账。遇到这类电话，先挂断，再通过官方 App 或官网上的电话核实。",
  },
  touzi: {
    title: "养老投资",
    cases: [
      ["“以房养老”“养老项目”高返利", "宣称投入养老项目，每月返利 8% 到 10%，还送旅游、送礼品。前几个月真的返钱，等投入大笔资金，平台就无法提现、人去楼空。"],
      ["拉进群里的“投资老师”", "被拉进股票或理财群，群里“老师”天天晒收益，诱导下载指定 App 充值。App 里显示盈利，却提不出来，说要先交“保证金”“税费”。"],
    ],
    tip: "保本又高收益的项目基本都是骗局。投钱之前，先和子女商量，并到金融监管部门官网核对机构资质。",
  },
  baojian: {
    title: "虚假保健品",
    cases: [
      ["免费讲座、送鸡蛋送礼品", "以免费体检、听讲座送礼品为名吸引老人，讲座上“专家”吹嘘产品能治糖尿病、高血压，现场限时抢购，一盒几千元，实际成本很低。"],
      ["直播间“名医”“义诊”", "直播间里有人冒充名医，声称某产品能“根治”“逆转”慢性病，催您马上下单。收到的货往往是三无产品，没有任何疗效。"],
    ],
    tip: "保健品不能代替药品，也不可能“包治百病”。真有不舒服，请去正规医院，买药看国家药监局的批准文号。",
  },
};

(function () {
  const dlg = $("case-dialog");
  const body = $("case-body");
  let opener = null;
  function open(key, btn) {
    const d = SCAM_CASES[key];
    if (!d) return;
    opener = btn;
    $("case-title").textContent = d.title + " · 典型案例";
    body.replaceChildren();
    d.cases.forEach(([t, txt], i) => {
      const card = document.createElement("div");
      card.className = "case-item";
      const h = document.createElement("h3");
      h.textContent = `案例 ${i + 1}：${t}`;
      const p = document.createElement("p");
      p.textContent = txt;
      card.append(h, p);
      body.appendChild(card);
    });
    const tip = document.createElement("div");
    tip.className = "case-tip";
    tip.textContent = "怎么防：" + d.tip;
    body.appendChild(tip);
    if (dlg.showModal) dlg.showModal();
    else dlg.setAttribute("open", "");
  }
  function close() {
    if (dlg.close) dlg.close();
    else dlg.removeAttribute("open");
    if (opener) opener.focus();
  }
  document.querySelectorAll(".scam-card").forEach((b) => b.addEventListener("click", () => open(b.dataset.scam, b)));
  $("case-close").addEventListener("click", close);
  $("case-ok").addEventListener("click", close);
  dlg.addEventListener("click", (e) => { if (e.target === dlg) close(); }); // 点遮罩关闭
})();
