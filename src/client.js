/**
 * dsh-alert-sounds — 客户端半边（浏览器 bundle 的源码）。
 *
 * 来源与谱系：本文件是 @machine-126/dsh-alert-sound（MIT）的派生作品，
 * 检测/播放那一批**实测修复**原样保留（见下方注释里标注的 0.3.9 ~ 0.3.13），
 * 本 fork 的改动集中在两处：
 *   1. 全面改名（包名 / loader id / slot id / localStorage 键）；
 *   2. 悬浮提示条从「固定 3.6 秒」改成可配置的停留策略，默认**常驻到鼠标明显移动或点击**
 *      （见 createToastStore 与 src/panel.js）。
 *
 * 本文件由 scripts/build.mjs 包进 `window.__ModuleLoader__.load({ id, factory })`，
 * id 必须等于 package.json 的 name（dsh-client-modules 按 loader 条目的包名解析注册 ID，
 * 写错会 "loaded without registering"）。设置页与浮条在 src/panel.js，由
 * `/*__PANEL__*\/ ''` 锚点内联进同一模块作用域（所以能直接用 settings / t / createToastStore）。
 *
 * 纪律：浏览器半边不做模块解析，只允许 `require('react')`。
 */

const name = "@qgynisc/dsh-alert-sounds";
const inject = ["timer"];

/** 版本号由 scripts/build.mjs 从 package.json 注入（设置页底部显示）。 */
const VERSION = /*__VERSION__*/ '0.0.0'
/**
 * 平台外部模块（DSH 模块加载器提供；build 只放行 react / react-dom）。
 * **刻意不用 const 直接 require**：设置页与浮条是可选装饰，万一某个 DSH 版本不提供
 * react，也必须让声音与检测照常工作，而不是整个客户端模块加载失败。
 * react-dom 用来把浮条 createPortal 到 <body>：`shell.overlay` 的容器是
 * `.overlayLayer { z-index: 20 }`，它自己就是一个堆叠上下文，浮条在里面**永远压不过
 * 设置弹窗**（2026-10-06 用户截图：预览正好被设置窗盖住）。portal 到 body 就自由了。
 */
let react = null;
try { react = require("react"); } catch (e) { react = null; }
let reactDom = null;
try { reactDom = require("react-dom"); } catch (e) { reactDom = null; }

/* ===========================================================================
 * 1. 设置（localStorage）
 *
 * 键名带 `-sounds`（本包名），与上游 `dsh-alert-sound.v1` **刻意不同**：
 * 两个插件同时装着时，各读各的设置，不会互相改。
 * ========================================================================= */
const STORE_KEY = "dsh-alert-sounds.v1";
const DEFAULT_TYPES = {
  approval: { enabled: true, sound: "alarm" },
  question: { enabled: true, sound: "tap" },
  done: { enabled: true, sound: "ding" },
  failed: { enabled: true, sound: "fault" },
  stalled: { enabled: true, sound: "fault" },
};
/**
 * 默认设置。相对上游的三处改动：
 *   - `showToast: true`：上游默认关，于是提示条根本不会出现；
 *   - `toastStyle: "own"`：默认用**自研常驻条**（直到鼠标明显移动或点击才收）；
 *     想回到上游那套「底部彩条 + 3.6 秒自动消失」，设置里选「原方案」；
 *   - `toastScale: 5`：自研浮条默认放大 5 倍（「一走一过也要看得见」），设置里可调 1–10 倍。
 */
const DEFAULTS = {
  volume: 0.7,
  scope: "all",
  repeatMs: 20000,
  notifyEnabled: false,
  readOutput: false,
  stallMs: 0,
  showToast: true,
  toastStyle: "own",
  toastScale: 5,
  voiceRate: 1,
  dndEnabled: false,
  dndStart: 22,
  dndEnd: 8,
  lang: "auto",
  types: DEFAULT_TYPES,
};

function deepMerge(base, over) {
  const out = {};
  for (const k of Object.keys(base)) {
    const b = base[k];
    const o = over && over[k] !== undefined ? over[k] : undefined;
    if (b && typeof b === "object" && !Array.isArray(b)) out[k] = deepMerge(b, o || {});
    else out[k] = o !== undefined ? o : b;
  }
  return out;
}

let settings = deepMerge(DEFAULTS, {});
try {
  const raw = localStorage.getItem(STORE_KEY);
  if (raw) {
    const p = JSON.parse(raw);
    if (p && typeof p === "object") settings = deepMerge(DEFAULTS, p);
  }
} catch (e) { /* ignore */ }

const settingsSubs = new Set();
function notifySettings() {
  settingsSubs.forEach(fn => { try { fn(); } catch (e) {} });
}
function subscribeSettings(fn) {
  settingsSubs.add(fn);
  try { fn(); } catch (e) {}
  return () => settingsSubs.delete(fn);
}
function persistSettings(next) {
  settings = next;
  try { localStorage.setItem(STORE_KEY, JSON.stringify(next)); } catch (e) {}
  notifySettings();
}

/* ---- 自定义音色（每类一份，存 localStorage） ----
 * 上游把上传的音频转成 dataURL 直接塞进 localStorage，上限 2MB。 */
const CUSTOM_KEY = "dsh-alert-sounds.custom.v1";
let customAudio = {}; // kind -> dataUrl
try {
  const raw = localStorage.getItem(CUSTOM_KEY);
  if (raw) {
    const p = JSON.parse(raw);
    if (p && typeof p === "object" && !Array.isArray(p)) customAudio = p;
  }
} catch (e) { /* ignore */ }
function persistCustomAudio() {
  try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(customAudio)); } catch (e) {}
}

/* ===========================================================================
 * 2. 音色与语音
 * ========================================================================= */
const SOUND_IDS = ["ding", "fault", "tap", "alarm", "voice", "custom", "none"];
const PATTERNS = {
  ding:  { notes: [{ at: 0, f: 523.25, d: 0.18, t: "sine", g: 0.8 }, { at: 0.15, f: 783.99, d: 0.35, t: "sine", g: 0.8 }] },
  fault: { notes: [{ at: 0, f: 196, d: 0.2, t: "sawtooth", g: 0.35 }, { at: 0.18, f: 130.81, d: 0.4, t: "sawtooth", g: 0.35 }] },
  tap:   { notes: [{ at: 0, f: 1046.5, d: 0.07, t: "triangle", g: 0.7 }, { at: 0.1, f: 1046.5, d: 0.07, t: "triangle", g: 0.7 }] },
  alarm: { notes: [{ at: 0, f: 880, d: 0.1, t: "square", g: 0.3 }, { at: 0.16, f: 1174.66, d: 0.12, t: "square", g: 0.3 }, { at: 0.34, f: 1567.98, d: 0.22, t: "square", g: 0.3 }] },
};
// 浮条背景色；显示文字走 t( kind )。
const TOAST_MAP = {
  approval: { bg: "#f59e0b" },
  question: { bg: "#7c3aed" },
  done: { bg: "#16a34a" },
  failed: { bg: "#dc2626" },
  stalled: { bg: "#f97316" },
  connected: { bg: "#2563eb" },
};
const KINDS = ["approval", "question", "done", "failed", "stalled"];
// 语音朗读失败（浏览器 TTS 丢 utterance）时，用哪一声提示音兜底——保证一定有声。
const VOICE_FALLBACK = { approval: "alarm", question: "tap", done: "ding", failed: "fault", stalled: "fault" };

/* ---- i18n: zh/en 词典 + t() ---- */
const I18N = {
  zh: {
    approval: "需要审批", question: "需要回答", done: "输出完成", failed: "发生错误", stalled: "卡住", connected: "🔔 提醒已连接",
    "sound.ding": "叮咚", "sound.fault": "低沉", "sound.tap": "轻点", "sound.alarm": "警醒", "sound.voice": "语音", "sound.custom": "自定义", "sound.none": "静音",
    "lang.label": "界面语言", "lang.auto": "自动", "lang.zh": "中文", "lang.en": "English",
    "settings.title": "🔔 提醒音设置", "nav.title": "提醒音", "overlay.label": "DSH 提醒", "volume": "音量", "scope": "提醒范围", "scope.all": "所有会话", "scope.current": "仅当前会话",
    "repeat": "重复提醒", "repeat.off": "关", "repeat.10": "每10秒", "repeat.20": "每20秒", "repeat.30": "每30秒",
    "notify": "系统通知", "notify.hint": "浏览器通知（后台也弹）",
    "read": "朗读输出", "read.hint": "需配合“语音”音色：开启后，完成时把助手最后的回复念出来（较长时只念开头）", "failed.hint": "⚠️ 此提醒尚未经上游作者实测，可能不准确",
    "stall": "停滞检测", "stall.hint": "开启后才会触发上面第 5 类“卡住”提醒（判定依据不精确，实验性）", "stall.off": "关", "stall.1": "1分钟", "stall.2": "2分钟", "stall.5": "5分钟",
    "toast": "悬浮提示", "toast.hint": "提示条显示在屏幕底部中间（默认开；提示音为主，提示条是给不在屏幕前的人看的）",
    "toastStyle": "提示样式", "toastStyle.own": "自研常驻条（直到鼠标移动或点击）", "toastStyle.original": "原方案（上游彩条，3.6 秒自动消失）",
    "toastScale": "提示大小", "toastScale.hint": "只影响「自研常驻条」",
    "toast.close": "关闭提示", "own.hint": "鼠标移动或点击收起",
    "rate": "语音语速", "rate.slow": "慢", "rate.normal": "标准", "rate.fast": "快",
    "dnd": "勿扰时段", "dnd.on": "开启", "dnd.to": "至",
    "preview": "预览", "preview.title": "各类提醒长什么样（1× 示意）", "preview.hint": "这些是 1× 示意，用来看配色与文字排版；真实大小请点上面的「弹一条看看」或每类右边的「预览」——那会按当前大小弹一条真身。",
    "preview.real": "真实效果", "preview.real.button1": "弹一条", "preview.real.button2": "看大小", "preview.real.hint": "按当前「提示样式 / 提示大小」弹一条真的；点它或 15 秒后消失",
    "sec.base": "基础", "sec.sound": "提醒声音", "sec.screen": "屏幕提示", "sec.reset": "其它",
    "upload": "上传", "sep": "：", "reset": "恢复默认设置", "reset.hint": "恢复全部选项为默认值（已上传的自定义音色保留）", "reset.confirm": "确定恢复全部选项为默认值？",
    "hint": "选“语音”会用朗读代替提示音（需浏览器支持语音合成）。", "stalled.detail": "长时间未进展",
    /* 设置页顶部「标题 + 归属 + 项目地址」区块（qgynisc 所有插件统一形态） */
    "page.byline": "本项目由插件", "page.bylineTail": "实现", "page.repo": "项目地址", "page.version": "版本", "page.fork": "fork 自", "page.forkTail": "（MIT）",
  },
  en: {
    approval: "Needs approval", question: "Needs answer", done: "Output complete", failed: "Error", stalled: "Stalled", connected: "🔔 Alerts ready",
    "sound.ding": "Ding-dong", "sound.fault": "Low", "sound.tap": "Tap", "sound.alarm": "Alert", "sound.voice": "Voice", "sound.custom": "Custom", "sound.none": "Mute",
    "lang.label": "Language", "lang.auto": "Auto", "lang.zh": "中文", "lang.en": "English",
    "settings.title": "🔔 Alert sounds", "nav.title": "Alerts", "overlay.label": "DSH Alerts", "volume": "Volume", "scope": "Scope", "scope.all": "All sessions", "scope.current": "Current session only",
    "repeat": "Repeat", "repeat.off": "Off", "repeat.10": "Every 10s", "repeat.20": "Every 20s", "repeat.30": "Every 30s",
    "notify": "System notification", "notify.hint": "Browser notification (also in background)",
    "read": "Read-aloud", "read.hint": "Works with the “Voice” sound: on completion, speak the assistant's final reply (truncated if long)", "failed.hint": "⚠️ Not yet tested by the upstream author — may be inaccurate",
    "stall": "Stall detection", "stall.hint": "Only when on does the 5th “Stalled” alert fire (heuristic; experimental)", "stall.off": "Off", "stall.1": "1 min", "stall.2": "2 min", "stall.5": "5 min",
    "toast": "Toast", "toast.hint": "Shows a banner at the bottom centre (on by default; sounds are primary, the banner is for when you are away)",
    "toastStyle": "Toast style", "toastStyle.own": "Built-in persistent card (until pointer moves or clicks)", "toastStyle.original": "Original (upstream bar, auto-dismiss after 3.6s)",
    "toastScale": "Toast size", "toastScale.hint": "affects the built-in persistent card only",
    "toast.close": "Dismiss", "own.hint": "move the pointer or click to dismiss",
    "rate": "Voice rate", "rate.slow": "Slow", "rate.normal": "Normal", "rate.fast": "Fast",
    "dnd": "Do-not-disturb", "dnd.on": "On", "dnd.to": "to",
    "preview": "Preview", "preview.title": "What each alert looks like (1× sketch)", "preview.hint": "These are 1× sketches (colours and layout). For the real size use “Pop one” above, or “Preview” next to a kind — those pop the real banner at your current size.",
    "preview.real": "Real preview", "preview.real.button1": "Pop one", "preview.real.button2": "to check size", "preview.real.hint": "pops the real banner at your current style/size; click it or it goes after 15s",
    "sec.base": "Basics", "sec.sound": "Alert sounds", "sec.screen": "Screen banner", "sec.reset": "Other",
    "upload": "Upload", "sep": ": ", "reset": "Restore defaults", "reset.hint": "Reset all options to defaults (uploaded custom sounds are kept)", "reset.confirm": "Restore all options to defaults?",
    "hint": "Choosing “Voice” speaks instead of a tone (requires browser speech synthesis).", "stalled.detail": "No progress for a while",
    "page.byline": "Implemented by the plugin", "page.bylineTail": "", "page.repo": "Repository", "page.version": "Version", "page.fork": "Forked from", "page.forkTail": " (MIT)",
  },
};
/** 纯函数：由「界面语言偏好 + 浏览器语言」定语言，便于单测。 */
function pickLang(pref, code) {
  if (pref === "zh" || pref === "en") return pref;
  return /^zh/i.test(code || "") ? "zh" : "en";
}
function resolveLang() {
  let code = "";
  try { code = (navigator && navigator.language) || ""; } catch (e) {}
  return pickLang(settings.lang || "auto", code);
}
function t(key) {
  const lang = resolveLang();
  const d = I18N[lang] || I18N.zh;
  return d[key] !== undefined ? d[key] : (I18N.zh[key] !== undefined ? I18N.zh[key] : key);
}

/* ---- Web Audio ---- */
let audioCtx = null;
let master = null;
function ensureCtx() {
  if (typeof window === "undefined") return null;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!audioCtx) {
    try {
      audioCtx = new AC();
      master = audioCtx.createGain();
      master.connect(audioCtx.destination);
    } catch (e) { return null; }
  }
  if (audioCtx.state === "suspended") { try { audioCtx.resume(); } catch (e) {} }
  return audioCtx;
}
// ---- 播放队列：同一时刻的多条提醒串行播放，避免互相打断/只出尾音（上游 0.3.x） ----
const playQueue = [];
let playingNow = false;
function enqueuePlay(start) {
  playQueue.push(start);
  if (playQueue.length > 8) playQueue.shift(); // 极端堆积时丢弃最早排队的
  drainPlay();
}
function drainPlay() {
  if (playingNow) return;
  const start = playQueue.shift();
  if (!start) return;
  playingNow = true;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    playingNow = false;
    drainPlay();
  };
  try { start(release); } catch (e) { release(); }
}
function later(fn, ms) {
  if (typeof window !== "undefined" && typeof window.setTimeout === "function") { window.setTimeout(fn, ms); return true; }
  return false;
}
function patternMs(pattern) {
  let end = 0;
  for (const n of pattern.notes) end = Math.max(end, n.at + n.d + 0.06);
  return end * 1000;
}
// 立即排程一个音型（不排队；供 playPattern 与语音失败兜底共用）。
function schedulePatternNow(pattern, done) {
  let finished = false;
  const finish = () => { if (finished) return; finished = true; if (done) done(); };
  const ac = ensureCtx();
  if (!ac || !master) { finish(); return; }
  let fired = false;
  const schedule = () => {
    if (fired) return;
    fired = true;
    if (!audioCtx || audioCtx !== ac || !master) { finish(); return; }
    const vol = Math.min(2, Math.max(0, settings.volume));
    const base = ac.currentTime + 0.06; // 排程基准（留启动余量）
    const warmup = 0.2;                 // 静音预热：先喂一段音频把输出设备唤醒（0.3.13 修的“只播尾音”）
    master.gain.setValueAtTime(vol, base);
    try {
      const wg = ac.createGain();
      wg.gain.value = 0;
      const wo = ac.createOscillator();
      wo.frequency.value = 440;
      wo.connect(wg);
      wg.connect(master);
      wo.start(base);
      wo.stop(base + warmup);
    } catch (e) { /* ignore */ }
    const start = base + warmup;
    for (const n of pattern.notes) {
      const osc = ac.createOscillator();
      const g = ac.createGain();
      osc.type = n.t;
      osc.frequency.value = n.f;
      const at = start + n.at;
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(n.g, at + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, at + n.d);
      osc.connect(g);
      g.connect(master);
      osc.start(at);
      osc.stop(at + n.d + 0.05);
    }
    // 释放排在“实际排程之后”：context 晚启动时也按真实时长放行下一条，
    // 否则下一条会在本条还没播完时就插进来（互相重叠）。
    if (!later(finish, (warmup * 1000) + patternMs(pattern) + 80)) finish();
  };
  // resume() 是异步的：等它 resolve 再排程，否则 context 尚未运行时
  // 前面几个音符会被丢弃（表现为“只播尾音”）。
  if (ac.state === "running") schedule();
  else {
    try { ac.resume().then(schedule, schedule); } catch (e) { schedule(); }
    // 兜底：context 起不来（例如无用户手势）时不要卡死整个队列。
    later(() => { if (!fired) { fired = true; finish(); } }, 1200);
  }
}
function playPattern(sound) {
  const pattern = PATTERNS[sound];
  if (!pattern) return;
  enqueuePlay((release) => schedulePatternNow(pattern, release));
}
// 语音朗读。浏览器 TTS 会偶发“吞掉 utterance / 不触发 onstart”，
// 因此加 1 秒看门狗：没真正开始就改播该类提示音兜底，保证一定有声音（0.3.9/0.3.10）。
function speak(text, fallbackSound) {
  enqueuePlay((release) => {
    let started = false;
    let released = false;
    let fellBack = false;
    const done = () => { if (released) return; released = true; release(); };
    const fallback = () => {
      // 防重入：看门狗触发后 cancel() 往往会再触发 onerror，
      // 不设标志会把兜底音播两次。
      if (started || released || fellBack) return;
      fellBack = true;
      try { if (typeof window !== "undefined" && window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) {}
      const pattern = PATTERNS[fallbackSound];
      if (pattern) schedulePatternNow(pattern, done); else done();
    };
    try {
      if (typeof window === "undefined" || !window.speechSynthesis || !window.SpeechSynthesisUtterance) { fallback(); return; }
      const synth = window.speechSynthesis;
      const u = new window.SpeechSynthesisUtterance(text);
      u.lang = resolveLang() === "en" ? "en-US" : "zh-CN";
      u.volume = Math.min(1, Math.max(0, settings.volume));
      u.rate = Math.min(2, Math.max(0.5, settings.voiceRate || 1));
      u.onstart = () => { started = true; };
      u.onend = done;
      u.onerror = () => { if (started) done(); else fallback(); };
      // 只在真的还在朗读时才 cancel：无条件 cancel 会把新句开头一起吞掉。
      if (synth.speaking || synth.pending) { try { synth.cancel(); } catch (e) {} }
      const go = () => { try { synth.speak(u); } catch (e) { fallback(); } };
      if (!later(go, 60)) go();
      // 看门狗：1 秒内没有 onstart → 判定 TTS 失败，改播提示音。
      later(() => { if (!started) fallback(); }, 1000);
      // 总兜底：onend 未触发时也不卡住队列。
      const capMs = Math.max(4000, Math.min(20000, (text ? text.length : 0) * 150));
      later(done, capMs);
    } catch (e) { fallback(); }
  });
}
function clip(text, max) {
  if (!text) return "";
  return text.length <= max ? text : text.slice(0, max - 1) + "…";
}
function inDnd() {
  if (!settings.dndEnabled) return false;
  const h = new Date().getHours();
  const start = settings.dndStart, end = settings.dndEnd;
  if (start <= end) return h >= start && h < end;
  return h >= start || h < end; // 跨天（如 22-8）
}
function playCustom(kind) {
  const url = customAudio[kind];
  if (!url) return;
  enqueuePlay((release) => {
    try {
      if (typeof Audio === "undefined") { release(); return; }
      const a = new Audio(url);
      a.volume = Math.min(1, Math.max(0, settings.volume));
      a.onended = release;
      a.onerror = release;
      a.play().catch(() => release());
      later(release, 20000); // 兜底
    } catch (e) { release(); }
  });
}
function uploadCustomAudio(kind, file) {
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) return; // 2MB 上限
  const reader = new FileReader();
  reader.onload = () => {
    customAudio[kind] = String(reader.result);
    persistCustomAudio();
    playType(kind);
  };
  reader.onerror = () => {};
  reader.readAsDataURL(file);
}
function playType(kind, detail) {
  const cfg = settings.types && settings.types[kind];
  if (!cfg || !cfg.enabled) return;
  if (cfg.sound === "none") return;
  if (cfg.sound === "voice") speak(t(kind) + (detail ? t("sep") + clip(detail, settings.readOutput ? 400 : 120) : ""), VOICE_FALLBACK[kind] || "ding");
  else if (cfg.sound === "custom") playCustom(kind);
  else playPattern(cfg.sound);
}
function requestNotifyPermission() {
  try {
    if (typeof window === "undefined" || !("Notification" in window)) return Promise.resolve(null);
    if (window.Notification.permission === "granted") return Promise.resolve("granted");
    return window.Notification.requestPermission();
  } catch (e) { return Promise.resolve(null); }
}
function notify(kind, detail) {
  try {
    if (!settings.notifyEnabled) return;
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (window.Notification.permission !== "granted") return;
    const title = t(kind) || "dsh-alert-sounds";
    const body = detail ? clip(detail, 120) : "";
    new window.Notification(title, { body: body || undefined });
  } catch (e) { /* ignore */ }
}

/* ===========================================================================
 * 3. 浮条存储（悬浮提示）
 *
 * 与 React 解耦：src/panel.js 里的 AlertToast 只是它的订阅者。
 * 两种停留策略，由设置 toastStyle 映射（见 toastModeFor）：
 *   - "short"     3.6 秒自动消失 —— 「原方案」（上游行为）；
 *   - "untilMove" 常驻，直到鼠标**明显移动**（≥8px）或任意点击 —— 「自研」默认。
 * **不提供「只能手动关」的模式**：自研浮条已按要求去掉 × 按钮（只留文字），
 * 那种模式会变成关不掉的条幅；所以未知/非法模式一律回落到 short（自己会消失）。
 *
 * 为什么需要「武装延迟」：提示条弹出的瞬间，指针往往还停在原处或有微小抖动，
 * 立刻开始监听会把刚弹出的条一并关掉（等于这个功能没做）。所以先等 ARM_DELAY_MS
 * 再挂监听，并且第一次 pointermove 只记基准点、不计位移。
 * ========================================================================= */
const TOAST_SHORT_MS = 3600;
const TOAST_ARM_DELAY_MS = 500;
const TOAST_MOVE_PX = 8;
/** 设置页「预览」弹出的真身：点一下即关，最多赖 15 秒兜底（免得看忘了留一条条幅）。 */
const PREVIEW_MAX_MS = 15000;

/**
 * 纯函数：该用哪条停留策略。
 *   toastStyle === "original" → "short"（上游那套：底部彩条 + 3.6 秒自动消失）
 *   自研（默认）               → "untilMove"（常驻到鼠标明显移动或点击）
 * 说明：`connected` 那条启动提示已经不再自动弹（见 apply 末尾）；这里保留兜底判断，
 * 万一以后重新启用，也不会变成一条赖着不走的条幅。
 */
function toastModeFor(kind, cfg) {
  if (kind === "connected") return "short";
  return (cfg && cfg.toastStyle) === "original" ? "short" : "untilMove";
}
/** 纯函数：位移是否算「人回来了」——横向+纵向合计超过阈值才算，避免手抖误关。 */
function movedEnough(dx, dy) {
  return Math.abs(dx) + Math.abs(dy) >= TOAST_MOVE_PX;
}

/**
 * 建一个浮条存储。
 * @param options.env      提供 addEventListener/removeEventListener 的对象（缺省 window）
 * @param options.getMode  (kind) => 'short' | 'untilMove'（非法值按 short 处理）
 * @param options.timeout  (fn, ms) => 取消函数（生产传 ctx.timeout，单测传假定时器）
 */
function createToastStore(options) {
  const env = (options && options.env) || (typeof window !== "undefined" ? window : null);
  const getMode = (options && options.getMode) || (() => "short");
  const timeout = (options && options.timeout) || ((fn, ms) => {
    const id = env.setTimeout(fn, ms);
    return () => { try { env.clearTimeout(id); } catch (e) {} };
  });
  let current = null;
  let currentAt = 0; // 这一条是什么时候来的（自研浮条显示 HH:MM）
  let currentIsPreview = false; // 是不是设置页「预览」弹的（预览要无视「悬浮提示」总开关）
  const subs = new Set();
  let timer = null;  // 自动消失 / 武装延迟的取消器
  let disarm = null; // 输入监听的解绑器

  const notify = () => { subs.forEach(fn => { try { fn(); } catch (e) {} }); };

  function clearTimers() {
    if (timer) { try { timer(); } catch (e) {} timer = null; }
    if (disarm) { try { disarm(); } catch (e) {} disarm = null; }
  }
  function subscribe(fn) {
    subs.add(fn);
    try { fn(); } catch (e) {}
    return () => subs.delete(fn);
  }
  function getCurrent() { return current; }
  function getCurrentAt() { return currentAt; }
  function getCurrentIsPreview() { return currentIsPreview; }
  /** 关闭。带 kind 时只在「当前还是这一条」时才关，避免上一条的定时器误关后一条。 */
  function close(kind) {
    if (kind !== undefined && kind !== null && current !== kind) return;
    clearTimers();
    if (current === null) return;
    current = null;
    notify();
  }
  /** 鼠标明显移动或任意点击即关。 */
  function armInputDismissal(kind) {
    if (!env || typeof env.addEventListener !== "function") return;
    timer = timeout(() => {
      timer = null;
      let baseX = null, baseY = null, done = false;
      const finish = () => {
        if (done) return;
        done = true;
        try {
          env.removeEventListener("pointermove", onMove);
          env.removeEventListener("pointerdown", onDown);
        } catch (e) {}
        close(kind);
      };
      const onMove = (event) => {
        const x = event && typeof event.clientX === "number" ? event.clientX : null;
        const y = event && typeof event.clientY === "number" ? event.clientY : null;
        if (x === null || y === null) return;
        if (baseX === null) { baseX = x; baseY = y; return; } // 第一次移动只记基准
        if (movedEnough(x - baseX, y - baseY)) finish();
      };
      const onDown = () => finish();
      try {
        env.addEventListener("pointermove", onMove, { passive: true });
        env.addEventListener("pointerdown", onDown, { passive: true });
      } catch (e) { return; }
      disarm = () => {
        done = true;
        try {
          env.removeEventListener("pointermove", onMove);
          env.removeEventListener("pointerdown", onDown);
        } catch (e) {}
      };
    }, TOAST_ARM_DELAY_MS);
  }
  /** 预览专用收起：**只听点击**，不听鼠标移动。
   *  否则你在设置页点完「预览」、一动鼠标想看仔细，它就跑掉了（2026-10-06 反馈）。 */
  function armClickDismissal(kind) {
    if (!env || typeof env.addEventListener !== "function") return;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      try { env.removeEventListener("pointerdown", onDown); } catch (e) {}
      close(kind);
    };
    const onDown = () => finish();
    try { env.addEventListener("pointerdown", onDown, { passive: true }); } catch (e) { return; }
    disarm = () => { done = true; try { env.removeEventListener("pointerdown", onDown); } catch (e) {} };
  }
  /**
   * 播一条浮条（kind 为 null = 清空）。
   * options.preview = true（设置页的「预览」按钮）：
   *   - 更宽松的收起方式：点一下 / 15 秒兜底，**不听鼠标移动**，方便停下来看清；
   *   - 「原方案」仍按它自己的 3.6 秒还原（预览要忠实，不能比真身赖得久）。
   */
  function emit(kind, options) {
    const preview = !!(options && options.preview);
    clearTimers();
    if (kind) { currentAt = Date.now(); currentIsPreview = preview; }
    current = kind;
    notify();
    if (!kind) return;
    const mode = getMode(kind);
    if (mode !== "untilMove") {
      // "short" 以及任何非法值：自动消失，绝不留关不掉的条幅
      timer = timeout(() => { timer = null; close(kind); }, TOAST_SHORT_MS);
      return;
    }
    if (preview) {
      armClickDismissal(kind);
      timer = timeout(() => { timer = null; close(kind); }, PREVIEW_MAX_MS);
      return;
    }
    armInputDismissal(kind);
  }

  return { emit, close, subscribe, getCurrent, getCurrentAt, getCurrentIsPreview };
}

/* ===========================================================================
 * 4. apply：检测 + 播报 + UI 挂载
 * ========================================================================= */
function apply(ctx) {
  const toast = createToastStore({
    env: typeof window !== "undefined" ? window : null,
    getMode: (kind) => toastModeFor(kind, settings),
    timeout: (fn, ms) => ctx.timeout(fn, ms),
  });

  // 一次提醒 = 声音/语音 + 系统通知 + 悬浮提示（勿扰时段则全部静音）
  function alert(kind, detail) {
    if (inDnd()) return;
    try { playType(kind, detail); } catch (e) {}
    try { notify(kind, detail); } catch (e) {}
    toast.emit(kind);
  }

  // ---- 检测：会话列表的边沿 ----
  const prev = new Map();
  const runs = new Map();
  const settling = new Set();
  const lastFire = new Map();
  // 同一会话 1.5 秒内不重复同一类（防竞态）。
  function shouldFire(id, kind) {
    const now = Date.now();
    const last = lastFire.get(id);
    if (last && last.kind === kind && now - last.at < 1500) return false;
    lastFire.set(id, { kind, at: now });
    return true;
  }
  // DSH 0.1.2+ 把挂起交互从 Session 列表摘要 / Session 快照里挪到了
  // ctx.uiSession.pendingInteractions（Map<SessionId, PendingInteraction>），
  // 每条自带明细（approval: toolName/reason；question: questions[]）。从这里读。
  function pendingOf(id) {
    const ui = ctx.get("uiSession");
    if (!ui || !ui.pendingInteractions) return undefined;
    try {
      const m = ui.pendingInteractions.getSnapshot();
      return m ? m.get(id) : undefined;
    } catch (e) { return undefined; }
  }
  // 把挂起交互映射成提醒类别；plan-review 也按“提问”算。
  function pendingKindOf(id) {
    const p = pendingOf(id);
    if (!p || typeof p.kind !== "string") return undefined;
    return p.kind === "approval" ? "approval" : "question";
  }
  function seed(list) {
    const byId = (list && list.byId) || {};
    for (const id of Object.keys(byId)) {
      const s = byId[id] || {};
      prev.set(id, { running: !!s.running, pending: pendingKindOf(id) });
    }
  }
  // 只刷新“挂起”基线，绝不碰 running —— 否则在某一轮运行途中执行会把
  // prev.running 记成 true，让这一轮的完成/失败被漏掉。
  function reseedPending(list) {
    const byId = (list && list.byId) || {};
    for (const id of Object.keys(byId)) {
      const p = prev.get(id);
      if (p) p.pending = pendingKindOf(id);
    }
  }
  function detailOf(id) {
    const s = ctx.get("sessions");
    try {
      const b = s && s.binding && s.binding(id);
      return b && b.session ? b.session.getSnapshot() || null : null;
    } catch (e) { return null; }
  }
  // 提取审批/提问的具体内容（toolName/reason、问题文本），供语音播报。
  function pendingDetailOf(id) {
    const out = { approval: null, question: null };
    try {
      const p = pendingOf(id);
      if (!p) return out;
      if (p.kind === "approval") {
        const toolName = typeof p.toolName === "string" ? p.toolName : "";
        const reason = typeof p.reason === "string" ? p.reason : "";
        out.approval = reason ? toolName + t("sep") + reason : toolName;
      } else {
        const qs = p.questions;
        if (Array.isArray(qs) && qs.length && qs[0] && typeof qs[0].question === "string") out.question = qs[0].question;
      }
    } catch (e) {}
    return out;
  }
  // 最后一条助手文本：DSH 0.1.2+ 的 Session 快照已无 `chat`，改从会话视图取。
  function finalTextOf(id) {
    try {
      const uiConv = ctx.get("uiConversation");
      if (!uiConv || !uiConv.binding) return "";
      const binding = uiConv.binding(id);
      if (!binding || !binding.target) return "";
      const src = binding.target("chat");
      if (!src || !src.getSnapshot) return "";
      // chat target 需被订阅才会激活；仅在开启“朗读输出”时激活，
      // 避免为所有会话常驻组装会话视图。
      if (settings.readOutput && src.subscribe) {
        try { const off = src.subscribe(() => {}); if (typeof off === "function") off(); } catch (e) {}
      }
      const chat = src.getSnapshot();
      if (!chat) return "";
      let nodes = null;
      if (chat.legacy && Array.isArray(chat.legacy.nodes)) nodes = chat.legacy.nodes;
      else if (Array.isArray(chat.order) && chat.nodes && chat.nodes.get) {
        nodes = [];
        for (const key of chat.order) { const n = chat.nodes.get(key); if (n) nodes.push(n); }
      }
      if (!nodes) return "";
      for (let i = nodes.length - 1; i >= 0; i--) {
        const n = nodes[i];
        if (n && n.kind === "assistant" && Array.isArray(n.blocks)) {
          const text = n.blocks
            .filter(b => b && b.kind === "text" && typeof b.text === "string")
            .map(b => b.text)
            .join("");
          if (text) return text;
        }
      }
    } catch (e) {}
    return "";
  }
  // 提取完成/失败时的详情。错误文本取 lastAgentError；最后回复取会话视图。
  function completionDetail(id) {
    const out = { finalText: "", failMsg: "" };
    try {
      const snap = detailOf(id);
      if (snap && typeof snap.lastAgentError === "string" && snap.lastAgentError) out.failMsg = snap.lastAgentError;
      out.finalText = finalTextOf(id);
    } catch (e) {}
    return out;
  }
  function armRun(id) {
    const snap = detailOf(id);
    runs.set(id, { agentErr: snap ? snap.lastAgentError || null : null });
  }
  function settleRun(id) {
    const run = runs.get(id);
    if (!run || settling.has(id)) return;
    runs.delete(id);
    settling.add(id);
    ctx.timeout(() => {
      if (runs.has(id)) { settling.delete(id); return; }
      const snap = detailOf(id);
      // DSH 0.1.2+ 起会话快照只保留 lastAgentError，用它判定本轮是否新出错。
      const failed = !!(snap && snap.lastAgentError != null && snap.lastAgentError !== run.agentErr);
      const kind = failed ? "failed" : "done";
      if (shouldFire(id, kind)) {
        const cd = completionDetail(id);
        alert(kind, kind === "failed" ? cd.failMsg : cd.finalText);
        if (kind === "failed") startRepeat(id, "failed", 3);
      }
      settling.delete(id);
    }, 250);
  }
  // ---- 阻断事件重复提醒：审批/提问挂着时每 N 秒再响，直到处理；错误重复几次 ----
  const repeatTimers = new Map(); // id -> { disposer, kind, count, limit }
  function stopRepeat(id) {
    const rec = repeatTimers.get(id);
    if (rec) { rec.disposer(); repeatTimers.delete(id); }
  }
  function startRepeat(id, kind, limit) {
    const existing = repeatTimers.get(id);
    if (existing) {
      if (existing.kind === kind) return; // 已在重复同类型
      stopRepeat(id); // 类型变了，重启
    }
    const rawMs = settings.repeatMs || 0;
    if (rawMs <= 0) return; // 关闭重复（用户选“关”）——须在 clamp 之前判断
    const intervalMs = Math.max(3000, rawMs);
    const rec = { disposer: null, kind, count: 0, limit };
    const tick = () => {
      const sessions = ctx.get("sessions");
      if (!sessions || !sessions.list) { stopRepeat(id); return; }
      const pend = pendingKindOf(id);
      if (kind === "approval" || kind === "question") {
        // 挂在“审批/提问”直到处理掉
        if (pend !== kind) { stopRepeat(id); return; }
      } else {
        rec.count += 1;
        if (rec.count >= rec.limit) { stopRepeat(id); return; }
      }
      if (kind === "failed") {
        const cd = completionDetail(id);
        alert("failed", cd.failMsg);
      } else {
        const pd = pendingDetailOf(id);
        const d = kind === "question" ? pd.question : pd.approval;
        alert(kind, d);
      }
    };
    rec.disposer = ctx.interval(tick, intervalMs);
    repeatTimers.set(id, rec);
  }
  function observe(list) {
    // 提醒范围：默认对所有会话提醒；设置为“仅当前会话”时只响正在看的那个。
    const byId = (list && list.byId) || {};
    const current = list && list.current;
    const scope = (settings.scope) || "all";
    for (const id of Object.keys(byId)) {
      if (scope === "current" && id !== current) continue;
      const s = byId[id] || {};
      const running = !!s.running;
      const pending = pendingKindOf(id);
      const p = prev.get(id);
      if (p) {
        if (pending !== p.pending) {
          if (pending === "approval") {
            const pd = pendingDetailOf(id);
            if (shouldFire(id, "approval")) { alert("approval", pd.approval); startRepeat(id, "approval", Infinity); }
          } else if (pending === "question") {
            const pd = pendingDetailOf(id);
            if (shouldFire(id, "question")) { alert("question", pd.question); startRepeat(id, "question", Infinity); }
          } else {
            stopRepeat(id);
          }
        }
        if (p.running && !running) settleRun(id);
        else if (!p.running && running) armRun(id);
      }
      prev.set(id, { running, pending });
    }
    // 清理已离开列表的会话
    for (const id2 of prev.keys()) {
      if (!Object.prototype.hasOwnProperty.call(byId, id2)) { prev.delete(id2); runs.delete(id2); stopRepeat(id2); }
    }
  }
  // 会话列表订阅必须等服务就绪后再建立：若在 apply 时 sessions 尚未就绪，
  // 旧的 ctx.get 写法会永久返回空 disposer，导致 running 真→假（完成/失败）
  // 这条路径从未被订阅——这正是“完成不响”的根因（上游 0.3.x 实测）。
  ctx.inject(["sessions"], (scope) => {
    scope.effect(() => {
      const sessions = scope.get("sessions");
      if (!sessions || !sessions.list) return () => {};
      const list = sessions.list;
      seed(list.getSnapshot());
      return list.subscribe(() => observe(list.getSnapshot()));
    });
  });
  // 挂起交互（审批/提问）走独立 observable（DSH 0.1.2+），
  // 它的变化不会再触发会话列表订阅，必须单独订阅。
  ctx.inject(["uiSession"], (scope) => {
    scope.effect(() => {
      const ui = scope.get("uiSession");
      if (!ui || !ui.pendingInteractions || !ui.pendingInteractions.subscribe) return () => {};
      // uiSession 就绪后只刷新“挂起”基线（不动 running）：否则若 seed 早于
      // uiSession 就绪（prev.pending 记为 undefined），加载前就已挂起的
      // 审批/提问会在下一次 observe 时被误判为“新事件”而响。
      const sessions0 = scope.get("sessions");
      const list0 = sessions0 && sessions0.list;
      if (list0) reseedPending(list0.getSnapshot());
      return ui.pendingInteractions.subscribe(() => {
        const sessions = scope.get("sessions");
        const list = sessions && sessions.list;
        if (list) observe(list.getSnapshot());
      });
    });
  });

  // ---- 卡住检测：running 会话的 updatedAt 太久没更新 → 提醒 ----
  const stallAlerted = new Map(); // id -> 上次提醒时间戳
  ctx.effect(() => ctx.interval(() => {
    const sessions = ctx.get("sessions");
    const list = sessions && sessions.list;
    if (!list) return;
    const snap = list.getSnapshot();
    const byId = (snap && snap.byId) || {};
    const current = snap && snap.current;
    const scope = (settings.scope) || "all";
    const stallMs = settings.stallMs || 0;
    const repeatMs = Math.max(3000, (settings.repeatMs || 20000));
    const now = Date.now();
    for (const id of Object.keys(byId)) {
      if (scope === "current" && id !== current) continue;
      const s = byId[id] || {};
      if (!s.running) { stallAlerted.delete(id); continue; }
      const at = s.updatedAt;
      if (typeof at !== "number" || !stallMs) continue;
      if (now - at > stallMs) {
        const last = stallAlerted.get(id) || 0;
        if (now - last >= repeatMs) {
          alert("stalled", t("stalled.detail"));
          stallAlerted.set(id, now);
        }
      } else {
        stallAlerted.delete(id);
      }
    }
  }, 5000));

  // ---- 音频解锁（浏览器 autoplay 策略） ----
  ctx.effect(() => {
    if (typeof window === "undefined") return () => {};
    // 预热语音合成：提前触发浏览器加载语音列表（否则首次朗读易被丢）。
    try { if (window.speechSynthesis && window.speechSynthesis.getVoices) window.speechSynthesis.getVoices(); } catch (e) {}
    const unlock = () => {
      const ac = ensureCtx();
      if (ac && ac.state === "suspended") { try { ac.resume(); } catch (e) {} }
      try { window.removeEventListener("pointerdown", unlock); window.removeEventListener("keydown", unlock); } catch (e) {}
    };
    try { window.addEventListener("pointerdown", unlock); window.addEventListener("keydown", unlock); } catch (e) {}
    return () => { try { window.removeEventListener("pointerdown", unlock); window.removeEventListener("keydown", unlock); } catch (e) {} };
  });

  // ---- slots ----
  // 同样用 ctx.inject 等服务就绪：ctx.get + 早退在服务晚到时会永久不注册。
  ctx.inject(["slots"], (scope) => {
    const slots = scope.get("slots");
    if (!slots) return;
    // 拿不到 React 就整块跳过：设置页与浮条是可选装饰，声音与检测不受影响。
    if (!react) return;
    scope.effect(() => slots.inject("settings.section", () => slots.register(
      { name: "settings.section", id: "dsh-alert-sounds", order: 45, label: () => t("nav.title") },
      props => react.createElement(SettingsPanel, Object.assign({}, props, {
        getSettings: () => settings,
        setSettings: persistSettings,
        subscribeSettings,
        play: playType,
        // 设置页「预览」：按当前大小真弹一条**真身**（同时试听声音）。preview 标记让它不受
        // 「悬浮提示」总开关影响，也不会被你一动鼠标就收掉（见 createToastStore）。
        previewToast: (kind) => toast.emit(kind, { preview: true }),
        requestNotify: requestNotifyPermission,
        uploadCustom: uploadCustomAudio,
      }))
    )));
    scope.effect(() => slots.inject("shell.overlay", () => slots.register(
      { name: "shell.overlay", id: "dsh-alert-sounds-toast", order: 50, label: () => t("overlay.label") },
      () => react.createElement(AlertToast, {
        subscribe: toast.subscribe,
        getCurrent: toast.getCurrent,
        getCurrentAt: toast.getCurrentAt,
        isPreview: toast.getCurrentIsPreview,
      })
    )));
  });

  // 启动时**不再**弹「🔔 提醒已连接」蓝条（2026-10-06 用户实际反馈）：
  // 悬浮提示默认是开的，于是每次刷新页面都会闪一条蓝条，放大后更显眼，
  // 用户会误以为「提醒出错了」——它就是唯一用蓝色的那条。声音解锁照旧由上面
  // 那对 pointerdown/keydown 监听完成，不需要视觉提示。
}

exports.apply = apply;
exports.inject = inject;
exports.name = name;
/** 单测入口：暴露纯函数与浮条存储，便于在 Node 里直接跑决策路径（不影响 DSH 加载）。 */
exports.__test = {
  DEFAULTS,
  DEFAULT_TYPES,
  I18N,
  KINDS,
  TOAST_MAP,
  SOUND_IDS,
  STORE_KEY,
  CUSTOM_KEY,
  TOAST_SHORT_MS,
  TOAST_ARM_DELAY_MS,
  TOAST_MOVE_PX,
  PATTERNS,
  deepMerge,
  clip,
  inDnd,
  pickLang,
  toastModeFor,
  movedEnough,
  createToastStore,
};

/*__PANEL__*/ ''
