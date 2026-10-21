// 银龄数字卫士前端：单页两视图（输入 → 结果），核查时用 overlay 遮罩。
// 所有模型输出都用 textContent 写入页面，不拼接 HTML，防止注入。
const $ = (id) => document.getElementById(id);
let mode = "text";
let lastScript = "";

// ---------- 星云数字人（可选）：后端配置了 App ID/Secret 才启用 ----------
const XINGYUN_SDK = "https://media.xingyun3d.com/xingyun3d/general/litesdk/xmovAvatar_e2e.2.4.1.js";
let avatarCfg = null;
let agent = null;
let agentReady = null;
let avatarPlaying = false;

fetch("/api/avatar-config")
  .then((r) => r.json())
  .then((c) => { if (c.enabled) avatarCfg = c; })
  .catch(() => { /* 拿不到配置就只用普通语音 */ });

// ---------- overlay 遮罩 ----------
function showOverlay(text) {
  $("overlay-text").textContent = text;
  $("overlay").hidden = false;
}
function hideOverlay() {
  $("overlay").hidden = true;
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

// ---------- 提交分析：overlay 遮罩 + 并行预载 SDK，就绪后进入结果页 ----------
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

  // 显示 overlay，盖在输入页上
  showOverlay("正在帮您核查，大约需要 30 秒到 1 分钟……");

  try {
    // 并行：核查 + 预下载星云 SDK 脚本（不阻塞核查）
    const analyzePromise = fetch("/api/analyze", { method: "POST", body: fd }).then(async (r) => {
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.detail || "检测失败，请稍后再试");
      return data;
    });
    const sdkPromise = avatarCfg ? loadScript(XINGYUN_SDK).catch(() => null) : Promise.resolve();
    const [data] = await Promise.all([analyzePromise, sdkPromise]);

    // 渲染结果
    render(data);

    // 把结果页挂到 DOM（preparing 态：有尺寸但不可见），供数字人 SDK 初始化
    $("view-input").hidden = true;
    const vr = $("view-result");
    vr.hidden = false;
    vr.classList.add("preparing");

    // 预初始化数字人（容器已有尺寸），等其就绪后再进入结果页
    if (avatarCfg && lastScript) {
      showOverlay("数字人正在准备出场，马上就好……");
      try { await initAgent(); } catch { /* 进入结果页后可重试 */ }
    }

    // 就绪：显示结果页，关闭 overlay，开始播报
    vr.classList.remove("preparing");
    hideOverlay();
    vr.focus();
    autoSpeak();
  } catch (err) {
    showError(err.message === "Failed to fetch" ? "连不上服务，请确认后台已启动" : err.message);
    hideOverlay();
    $("view-input").hidden = false;
    const vr = $("view-result");
    vr.hidden = true;
    vr.classList.remove("preparing");
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

  // 提醒：直接显示
  const tips = $("tips");
  tips.replaceChildren();
  (adv.tips || []).forEach((t) => li(tips, [[t]]));
  $("tips-block").hidden = !(adv.tips || []).length;

  // 播报文稿：放进可展开
  lastScript = adv.script || det.reason || "";
  $("script").textContent = lastScript;
  $("script-block").hidden = !lastScript;

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

  // 重置音频
  const audio = $("audio");
  audio.hidden = true;
  audio.pause();
  audio.removeAttribute("src");

  // 停掉上一段播报，重置按钮
  if (agent) {
    try { agent.interrupt("speak"); } catch { /* 未在播报时忽略 */ }
  }
  avatarPlaying = false;
  $("pause-avatar").hidden = true;
  $("replay-avatar").hidden = !avatarCfg || !lastScript;
  $("speak").hidden = !lastScript;
}

// ---------- 自动播报：进入结果页后直接开始 ----------
async function autoSpeak() {
  if (!lastScript) return;
  if (avatarCfg && agent) {
    // SDK 已在 overlay 期间预初始化好，直接播报
    try { agent.interrupt("speak"); } catch { /* 忽略 */ }
    agent.speak(lastScript, true, true);
    avatarPlaying = true;
    $("pause-avatar").hidden = false;
    $("replay-avatar").hidden = false;
    setAvatarStatus("数字人正在讲解");
  } else if (avatarCfg) {
    // agent 未就绪，走完整启动流程
    await startAvatar();
  } else {
    // 没配置数字人，自动用普通语音朗读
    setAvatarStatus("正在为您朗读……");
    await speakAudio();
  }
}

// ---------- 数字人播报 ----------
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
    agent = new window.XingyunAvatarAgent({
      containerId: "", // SDK 2.4.1 类型定义仍要求该字段，实际以 container 为准
      container: $("agent-avatar"),
      appId: avatarCfg.appId,
      appSecret: avatarCfg.appSecret,
      gatewayServer: avatarCfg.gatewayServer,
      onMessage(err) {
        console.error("数字人渲染错误", err && err.code, err && err.message);
      },
      agentCallbacks: {
        onError(err) {
          console.error("数字人错误", err && err.code, err && err.message);
          setAvatarStatus("数字人出了点问题，可以点「仅用语音」");
          $("pause-avatar").hidden = true;
          avatarPlaying = false;
        },
      },
    });
    await agent.init({
      onDownloadProgress(p) {
        const msg = `数字人正在准备 ${Number(p).toFixed(0)}%`;
        setAvatarStatus(msg);
        // overlay 期间把进度同步到遮罩文字上
        if (!$("overlay").hidden) $("overlay-text").textContent = msg;
      },
    });
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

async function startAvatar() {
  setAvatarStatus("正在请数字人出场，第一次大约要等十几秒……");
  try {
    await initAgent();
    try { agent.interrupt("speak"); } catch { /* 忽略 */ }
    agent.speak(lastScript, true, true);
    avatarPlaying = true;
    $("pause-avatar").hidden = false;
    $("replay-avatar").hidden = false;
    setAvatarStatus("数字人正在讲解");
  } catch (err) {
    console.error("数字人启动失败", err);
    setAvatarStatus("数字人暂时用不了，改用语音朗读");
    $("pause-avatar").hidden = true;
    avatarPlaying = false;
    await speakAudio();
  }
}

// 暂停：停掉播报，提示用 🔁 重新讲
$("pause-avatar").addEventListener("click", () => {
  if (!agent) return;
  try { agent.interrupt("speak"); } catch { /* 忽略 */ }
  avatarPlaying = false;
  setAvatarStatus("已暂停，点 🔁 重新讲一遍");
});

// 重新讲：从头播报
$("replay-avatar").addEventListener("click", () => {
  if (!agent || !lastScript) return;
  try { agent.interrupt("speak"); } catch { /* 忽略 */ }
  agent.speak(lastScript, true, true);
  avatarPlaying = true;
  $("pause-avatar").hidden = false;
  setAvatarStatus("数字人正在讲解");
});

window.addEventListener("beforeunload", () => {
  if (agent) Promise.resolve().then(() => agent.destroy("page_unload")).catch(() => {});
});

// ---------- 语音播报（数字人不可用时的备选） ----------
async function speakAudio() {
  if (!lastScript) return;
  const btn = $("speak");
  btn.disabled = true;
  const oldText = btn.textContent;
  btn.textContent = "准备中……";
  try {
    const resp = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: lastScript.slice(0, 500) }),
    });
    if (!resp.ok) throw new Error();
    const audio = $("audio");
    if (audio.src) URL.revokeObjectURL(audio.src);
    audio.src = URL.createObjectURL(await resp.blob());
    audio.hidden = false;
    await audio.play().catch(() => {});
  } catch {
    // 联网语音失败时，退回浏览器自带朗读
    if ("speechSynthesis" in window) {
      const u = new SpeechSynthesisUtterance(lastScript);
      u.lang = "zh-CN";
      u.rate = 0.85;
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    } else {
      setAvatarStatus("语音暂时不可用");
    }
  } finally {
    btn.disabled = false;
    btn.textContent = oldText;
  }
}

$("speak").addEventListener("click", speakAudio);

// ---------- 回到第一页 ----------
$("back-home").addEventListener("click", () => {
  // 停止数字人
  if (agent) {
    try { agent.interrupt("speak"); } catch { /* 忽略 */ }
  }
  avatarPlaying = false;
  $("pause-avatar").hidden = true;
  // 停止语音
  const audio = $("audio");
  if (audio.src) {
    audio.pause();
    audio.removeAttribute("src");
    audio.hidden = true;
  }
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  setAvatarStatus("");
  // 重置表单
  $("text").value = "";
  $("count").textContent = "0";
  $("image").value = "";
  if ($("preview").src) URL.revokeObjectURL($("preview").src);
  $("preview").hidden = true;
  $("live").checked = false;
  $("error").textContent = "";
  // 切回输入页
  $("view-result").hidden = true;
  $("view-result").classList.remove("preparing");
  $("view-input").hidden = false;
});
