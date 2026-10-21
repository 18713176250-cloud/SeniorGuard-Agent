// 银龄数字卫士前端：调用 /api/analyze 和 /api/tts。
// 所有模型输出都用 textContent 写入页面，不拼接 HTML，防止注入。
const $ = (id) => document.getElementById(id);
let mode = "text";
let lastScript = "";

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

// ---------- 提交分析 ----------
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

  setBusy(true);
  try {
    const resp = await fetch("/api/analyze", { method: "POST", body: fd });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.detail || "检测失败，请稍后再试");
    render(data);
  } catch (err) {
    showError(err.message === "Failed to fetch" ? "连不上服务，请确认后台已启动" : err.message);
  } finally {
    setBusy(false);
  }
});

function setBusy(busy) {
  $("submit").disabled = busy;
  $("submit").textContent = busy ? "正在核查……" : "帮我看看";
  $("loading").hidden = !busy;
  if (busy) $("result").hidden = true;
}

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

  lastScript = adv.script || det.reason || "";
  $("script").textContent = lastScript;
  const tips = $("tips");
  tips.replaceChildren();
  (adv.tips || []).forEach((t) => li(tips, [[t]]));

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

  const audio = $("audio");
  audio.hidden = true;
  audio.removeAttribute("src");
  $("speak").disabled = !lastScript;

  $("result").hidden = false;
  $("result").focus();
}

// ---------- 语音播报 ----------
$("speak").addEventListener("click", async () => {
  if (!lastScript) return;
  const btn = $("speak");
  btn.disabled = true;
  btn.textContent = "正在准备语音……";
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
      showError("语音暂时不可用");
    }
  } finally {
    btn.disabled = false;
    btn.textContent = "🔊 读给我听";
  }
});
