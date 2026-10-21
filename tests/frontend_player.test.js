// 前端播报逻辑单测：模拟 DOM、计时器和星云 SDK，不需要浏览器、不耗额度。
// 用法（项目根目录）：node tests/frontend_player.test.js
// 覆盖：按句播报、暂停/继续、迟到回调、兜底计时、随机台词、结果反馈、核查超时。
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "..", "frontend", "app.js"), "utf8");

// ---- 模拟 DOM ----
const els = {};
const mk = (id) => ({
  id, hidden: false, textContent: "", value: "", disabled: false, checked: false, files: [], _l: {},
  addEventListener(t, f) { (this._l[t] ||= []).push(f); },
  setAttribute(k, v) { this[k] = v; },
  getAttribute(k) { return this[k] || (id === "tab-text" ? "panel-text" : "panel-image"); },
  removeAttribute(k) { this[k] = ""; },
  focus() {}, pause() {}, play() { return Promise.resolve(); },
  classList: { add() {}, remove() {} }, replaceChildren() {}, appendChild() {},
  click() { (this._l.click || []).forEach((f) => f({ preventDefault() {} })); },
});
global.document = { getElementById: (id) => (els[id] ||= mk(id)), createElement: () => mk("x"), head: { appendChild() {} } };
global.window = { addEventListener() {} };
console.info = () => {};
console.warn = () => {};

// ---- 可手动触发的计时器 ----
const timers = [];
global.setTimeout = (f, ms) => { timers.push({ f, ms }); return timers.length; };
global.clearTimeout = (id) => { if (id && timers[id - 1]) timers[id - 1].f = null; };
global.setInterval = () => 0;
global.clearInterval = () => {};
const fireLast = (pred) => {
  const t = [...timers].reverse().find((x) => x.f && pred(x));
  if (!t) return false;
  const f = t.f;
  t.f = null;
  f();
  return true;
};

// ---- 模拟星云 SDK ----
const spoken = [];
let cbs;
window.XingyunAvatarAgent = class {
  constructor(o) { cbs = o; }
  async init() {}
  speak(t) { spoken.push(t); }
  interrupt() { spoken.push("<INT>"); }
  destroy() {}
};

// ---- 模拟接口：/api/analyze 一直不返回，直到被取消 ----
global.fetch = async (url, opts = {}) => {
  if (url === "/api/analyze") {
    return new Promise((_, reject) => {
      opts.signal.addEventListener("abort", () => {
        const e = new Error("aborted");
        e.name = "AbortError";
        reject(e);
      });
    });
  }
  return { ok: true, json: async () => ({ enabled: true, appId: "a", appSecret: "b", gatewayServer: "g" }) };
};

// 把 app.js 里的内部状态挂出来供断言
const hook = [
  "globalThis.T = {",
  "  get player() { return player; },",
  "  setView: (v) => { view = v; },",
  "  setScript: (x) => { resultScript = x; },",
  "  speakResult, stopPlayer, updateControls, LINES, buildResultScript, fetchAnalyze,",
  "};",
].join("\n");
eval(src + "\n" + hook);

const tick = () => new Promise((r) => setImmediate(r));
let failed = 0;
const assert = (c, m) => {
  if (c) console.log("ok  ", m);
  else { console.error("FAIL", m); failed++; }
};

(async () => {
  await tick(); await tick();
  const P = () => T.player;
  const SCRIPT = "我查过了，这条内容和官方反诈通报对得上，是诈骗信息。这是一条冒充亲友的短信，对方让您转三万块钱到陌生账户，还让您别告诉家里人。建议您不点击、不回复、不转账，必要时拨打96110咨询。";

  // ---- 按句播报 + 暂停/继续 ----
  T.setView("result");
  T.setScript(SCRIPT);
  T.speakResult(); await tick(); await tick();
  assert(P().chunks.length >= 2, "文稿切成多句: " + P().chunks.length);
  assert(spoken.at(-1) === P().chunks[0], "先讲第 1 句");
  cbs.onVoiceStateChange("start"); cbs.onVoiceStateChange("end");
  assert(spoken.at(-1) === P().chunks[1] && P().idx === 1, "第 1 句讲完自动讲第 2 句");

  cbs.onVoiceStateChange("start");
  els["toggle-play"].click();
  assert(P().state === "paused" && spoken.at(-1) === "<INT>", "暂停 → 打断当前播报");
  assert(els["toggle-play"].textContent === "▶", "按钮变成 ▶");
  cbs.onVoiceStateChange("end");
  assert(P().idx === 1, "暂停中迟到的 end 不推进进度");

  els["toggle-play"].click();
  assert(P().state === "playing" && spoken.at(-1) === P().chunks[1], "继续 → 从第 2 句接着讲");
  assert(els["toggle-play"].textContent === "⏸", "按钮变回 ⏸");
  cbs.onVoiceStateChange("end");
  assert(P().idx === 1, "继续后、新句 start 前迟到的 end 被忽略");

  const n = P().chunks.length;
  for (let i = 1; i < n; i++) { cbs.onVoiceStateChange("start"); cbs.onVoiceStateChange("end"); }
  assert(P().state === "idle" && els["toggle-play"].hidden, "全部讲完，按钮隐藏");
  assert(els["avatar-status"].textContent.includes("讲完了"), "讲完后提示可以再听");

  // ---- 兜底计时：SDK 没发 end 回调时也能讲下一句 ----
  T.speakResult(); await tick(); await tick();
  assert(P().idx === 0, "重新讲从第 1 句开始");
  assert(fireLast((t) => t.ms >= 10000 && t.ms < 60000), "第 1 句设了兜底计时");
  assert(P().idx === 1 && spoken.at(-1) === P().chunks[1], "兜底计时到点 → 讲第 2 句");
  els["toggle-play"].click();
  assert(!fireLast((t) => t.ms >= 10000 && t.ms < 60000), "暂停时兜底计时已取消，不会自己往下讲");
  T.stopPlayer();

  // ---- 首页 / 等待页随机台词 ----
  T.setView("home"); T.updateControls();
  els["say-line"].click(); await tick(); await tick();
  assert(T.LINES.home.some((l) => l.startsWith(P().chunks[0])), "首页讲开场/引导台词");
  T.stopPlayer();
  els["agent-avatar"].click(); await tick(); await tick();
  assert(P().state === "playing", "首页直接点数字人画面也能听一句");

  T.setView("waiting"); T.stopPlayer(); T.updateControls();
  els["say-line"].click(); await tick(); await tick();
  assert(T.LINES.waiting.some((l) => l.startsWith(P().chunks[0])), "等待页讲反诈警示");
  assert(els["say-line"].textContent.includes("防骗提醒"), "等待页按钮文字是「听一句防骗提醒」");
  T.stopPlayer();

  T.setView("result"); T.updateControls();
  assert(els["say-line"].hidden, "结果页隐藏「听我说一句」");
  const before = spoken.length;
  els["agent-avatar"].click(); await tick();
  assert(spoken.length === before, "结果页点数字人画面不会插播随机台词");

  // ---- 结果反馈开头 ----
  const s1 = T.buildResultScript({ detection: { verdict: "诈骗" }, authority: { overall: "与官方信息矛盾" }, advice: { script: "X" } });
  assert(s1.includes("官方") && s1.includes("96110"), "诈骗 + 权威判矛盾 → 说与官方通报一致");
  const s2 = T.buildResultScript({ detection: { verdict: "正常" }, authority: {}, advice: { script: "X" } });
  assert(s2.includes("没有发现问题") || s2.includes("正常"), "正常 → 放心反馈");
  const s3 = T.buildResultScript({ detection: { verdict: "诈骗" }, authority: { overall: "资料不足" }, advice: { script: "X" } });
  assert(!s3.includes("官方反诈通报"), "诈骗但权威资料不足 → 不说与官方通报一致");
  const s4 = T.buildResultScript({ detection: { verdict: "存疑" }, authority: {}, advice: { script: "X" } });
  assert(s4.includes("先别") && s4.includes("96110"), "存疑 → 温和提醒");

  // ---- 核查请求超时 ----
  const fd = new FormData();
  fd.append("live", "false");
  const p1 = T.fetchAnalyze(fd).then(() => null, (e) => e);
  assert(fireLast((t) => t.ms === 180000), "普通核查 3 分钟超时");
  const e1 = await p1;
  assert(e1 && e1.message.includes("再点一次"), "超时后提示老人再点一次");

  const fd2 = new FormData();
  fd2.append("live", "true");
  const p2 = T.fetchAnalyze(fd2).then(() => null, (e) => e);
  assert(fireLast((t) => t.ms === 300000), "勾选联网查时放宽到 5 分钟");
  await p2;

  console.log(failed ? `\n${failed} 项失败` : "\nALL PASS");
  process.exit(failed ? 1 : 0);
})();
