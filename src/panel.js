/* ---------------------------------------------------------------------------
 * 5. 设置页与悬浮提示条（React）
 *
 * 本文件由 scripts/build.mjs 内联进 src/client.js 的 `/*__PANEL__*\/ ''` 锚点，
 * 与 client.js 共用同一个模块作用域（所以能直接用 settings / t / VERSION /
 * TOAST_MAP / createToastStore 等）。单独成文件只为可读性。
 *
 * 浮条有两种**独立实现**，在设置里二选一（settings.toastStyle）：
 *   1. original —— 上游那套：底部居中彩色横条 + 3.6 秒自动消失（一字不改地保留，
 *      给习惯原方案的人）；
 *   2. own      —— 自研：卡片式常驻条，**直到鼠标明显移动或点击才收**，
 *      显示类别、完成时刻与收起方式，右上角带 ×（默认）。
 *
 * 两条纪律：
 *   1. 设置页是**可选装饰**：拿不到 React / slots 就整块跳过，不影响声音与检测；
 *   2. 组件直接读模块作用域里的 settings，改设置调 persistSettings ——
 *      面板里看到的就是插件正在用的那一份，不存在两份状态。
 * ------------------------------------------------------------------------- */

/** 设置页底部的项目信息（点得动）。 */
const REPO_URL = "https://github.com/qgynisc/dsh-alert-sounds";
const NPM_URL = "https://www.npmjs.com/package/@qgynisc/dsh-alert-sounds";
const UPSTREAM_URL = "https://github.com/Machine-126/dsh-alert-sound";

const rowStyle = { display: "flex", alignItems: "center", gap: "10px", padding: "6px 0" };
const keyStyle = { width: "120px", fontWeight: 600, fontSize: 12 };
const selStyle = { fontSize: 12, padding: "3px 6px", borderRadius: "6px" };
const cardStyle = { display: "flex", flexDirection: "column", gap: "10px", padding: "14px 16px", borderRadius: "10px", fontSize: 13, border: "1px solid var(--color-border, rgba(128,128,128,0.25))", background: "var(--color-card-bg, rgba(128,128,128,0.06))" };
const btnStyle = { padding: "3px 10px", borderRadius: "6px", fontSize: 12, cursor: "pointer", border: "1px solid var(--color-border, rgba(128,128,128,0.4))", background: "transparent", color: "inherit" };
const hintStyle = { fontSize: 12, opacity: 0.6 };
const mutedStyle = { fontSize: 12, opacity: 0.7 };

/* 设置页里「各类提醒长什么样」区块的排版 */
const previewTitleStyle = { fontSize: 12, fontWeight: 600, opacity: 0.75, marginTop: "4px" };
const previewListStyle = { display: "flex", flexDirection: "column", gap: "8px" };
const previewRowStyle = { display: "flex", alignItems: "center", gap: "10px" };
const previewLabelStyle = { width: "76px", flex: "0 0 auto", fontSize: 12, opacity: 0.75 };
const previewCellStyle = { flex: "1 1 auto", minWidth: 0 };

/** 分组小标题：上边一条分隔线 + 小号粗体字（与 @qgynisc/dsh-inline-pastes 设置页同一形态）。
 *  用户要求：「把提示相关的设置要放在一起，上下用线分开」。 */
const sectionStyle = {
  marginTop: "4px",
  paddingTop: "8px",
  borderTop: "0.5px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.25))",
  color: "var(--dsw-alias-label-tertiary, rgba(128,128,128,0.85))",
  fontSize: 12,
  fontWeight: 600,
};
function section(titleKey) {
  return react.createElement("div", { style: sectionStyle }, t(titleKey));
}

/* 设置页顶部「标题 + 归属 + 项目地址」区块。
 * 形态与配色对齐 @qgynisc/dsh-inline-pastes 的设置页（qgynisc 所有插件统一成这样）：
 *   标题 15px/600 → 次行 12px/18px 三次色 → 分隔线。
 * 用 var(--dsw-alias-*) 取 DSH 自己的语义色，深浅主题下都不用另做适配。 */
const headStyle = {
  display: "flex",
  flexDirection: "column",
  gap: "4px",
  paddingBottom: "8px",
  borderBottom: "0.5px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.25))",
};
const headTitleStyle = { fontSize: "15px", fontWeight: 600 };
const headSubStyle = { color: "var(--dsw-alias-label-tertiary, rgba(128,128,128,0.85))", fontSize: "12px", lineHeight: "18px" };
const headLinkStyle = { color: "var(--dsw-alias-label-link, #2b5cd9)", textDecoration: "none" };

/** 浮条统一挂在屏幕底部中间（与上游同位置，换实现不换位置）。
 *  z-index 用 int32 上限：横幅会被 portal 到 `<body>`，这个值才真的是「最前面」。 */
const TOAST_BASE = {
  position: "fixed",
  left: "50%",
  bottom: "28px",
  transform: "translateX(-50%)",
  zIndex: 2147483647,
  fontFamily: "system-ui, sans-serif",
};

/** 把时间戳格式化成 HH:MM（本地时区）。 */
function formatClock(at) {
  const d = new Date(typeof at === "number" ? at : Date.now());
  const pad = (n) => String(n).padStart(2, "0");
  return pad(d.getHours()) + ":" + pad(d.getMinutes());
}

/* ===================== 设置页 ===================== */
function SettingsPanel(props) {
  const pair = react.useState(props.getSettings());
  const s = pair[0], setS = pair[1];
  react.useEffect(() => props.subscribeSettings(() => setS(props.getSettings())), []);
  function commit(next) { setS(next); props.setSettings(next); }
  const hourOpts = () => Array.from({ length: 24 }, (_, h) => react.createElement("option", { key: h, value: String(h) }, String(h).padStart(2, "0") + ":00"));
  const rows = KINDS.map(kind => {
    const ts = (s.types && s.types[kind]) || DEFAULT_TYPES[kind];
    const opts = SOUND_IDS.map(sid => react.createElement("option", { key: sid, value: sid }, t("sound." + sid)));
    const upload = ts.sound === "custom"
      ? react.createElement("label", { key: "upload", style: btnStyle },
          react.createElement("input", { type: "file", accept: "audio/*", style: { display: "none" }, onChange: e => { const f = e.target.files && e.target.files[0]; props.uploadCustom(kind, f); e.target.value = ""; } }),
          t("upload"))
      : null;
    return react.createElement("div", { key: kind },
      react.createElement("div", { style: rowStyle },
        react.createElement("label", { style: { display: "flex", alignItems: "center", gap: "8px", width: "150px" } },
          react.createElement("input", { type: "checkbox", checked: !!ts.enabled, onChange: () => commit(Object.assign({}, s, { types: Object.assign({}, s.types, { [kind]: Object.assign({}, ts, { enabled: !ts.enabled }) }) })) }),
          react.createElement("span", null, t(kind))),
        react.createElement("select", { value: ts.sound, onChange: e => commit(Object.assign({}, s, { types: Object.assign({}, s.types, { [kind]: Object.assign({}, ts, { sound: e.target.value }) }) })), style: selStyle }, opts),
        /* 一键预览：既按当前「提示大小」弹这条真身，也播它的声音 */
        react.createElement("button", { style: btnStyle, onClick: () => { props.play(kind); props.previewToast(kind); } }, t("preview")),
        upload
      ),
      kind === "failed" ? react.createElement("div", { style: { fontSize: 12, opacity: 0.6, marginTop: "-4px" } }, t("failed.hint")) : null
    );
  });
  return react.createElement("div", { style: cardStyle },
    /* ---- 顶部：标题 + 归属 + 项目地址（本仓库约定，见 ~/.dsh/AGENTS.md）---- */
    react.createElement("div", { style: headStyle },
      react.createElement("div", { style: headTitleStyle }, t("settings.title")),
      react.createElement("div", { style: headSubStyle },
        t("page.byline") + " ",
        react.createElement("a", { href: NPM_URL, target: "_blank", rel: "noreferrer", style: headLinkStyle }, name),
        t("page.bylineTail") === "" ? null : " " + t("page.bylineTail"),
        " · " + t("page.version") + " " + VERSION),
      react.createElement("div", { style: headSubStyle },
        t("page.repo") + t("sep"),
        react.createElement("a", { href: REPO_URL, target: "_blank", rel: "noreferrer", style: headLinkStyle }, REPO_URL)),
      react.createElement("div", { style: headSubStyle },
        t("page.fork") + " ",
        react.createElement("a", { href: UPSTREAM_URL, target: "_blank", rel: "noreferrer", style: headLinkStyle }, "Machine-126/dsh-alert-sound"),
        t("page.forkTail"))),
    /* ===================== 基础 ===================== */
    section("sec.base"),
    react.createElement("div", { style: rowStyle },
      react.createElement("span", { style: keyStyle }, t("lang.label")),
      react.createElement("select", { value: s.lang || "auto", onChange: e => commit(Object.assign({}, s, { lang: e.target.value })), style: selStyle },
        react.createElement("option", { value: "auto" }, t("lang.auto")),
        react.createElement("option", { value: "zh" }, t("lang.zh")),
        react.createElement("option", { value: "en" }, t("lang.en")))),
    react.createElement("div", { style: rowStyle },
      react.createElement("span", { style: keyStyle }, t("scope")),
      react.createElement("select", { value: s.scope || "all", onChange: e => commit(Object.assign({}, s, { scope: e.target.value })), style: selStyle },
        react.createElement("option", { value: "all" }, t("scope.all")),
        react.createElement("option", { value: "current" }, t("scope.current")))),
    react.createElement("div", { style: rowStyle },
      react.createElement("span", { style: keyStyle }, t("repeat")),
      react.createElement("select", { value: String(s.repeatMs || 0), onChange: e => commit(Object.assign({}, s, { repeatMs: Number(e.target.value) })), style: selStyle },
        react.createElement("option", { value: "0" }, t("repeat.off")),
        react.createElement("option", { value: "10000" }, t("repeat.10")),
        react.createElement("option", { value: "20000" }, t("repeat.20")),
        react.createElement("option", { value: "30000" }, t("repeat.30")))),
    react.createElement("div", { style: rowStyle },
      react.createElement("span", { style: keyStyle }, t("notify")),
      react.createElement("label", { style: { display: "flex", alignItems: "center", gap: "8px" } },
        react.createElement("input", { type: "checkbox", checked: !!s.notifyEnabled, onChange: e => { const next = !!e.target.checked; commit(Object.assign({}, s, { notifyEnabled: next })); if (next) props.requestNotify(); } }),
        react.createElement("span", { style: mutedStyle }, t("notify.hint")))),
    react.createElement("div", { style: rowStyle },
      react.createElement("span", { style: keyStyle }, t("dnd")),
      react.createElement("label", { style: { display: "flex", alignItems: "center", gap: "6px" } },
        react.createElement("input", { type: "checkbox", checked: !!s.dndEnabled, onChange: e => commit(Object.assign({}, s, { dndEnabled: !!e.target.checked })) }),
        react.createElement("span", { style: mutedStyle }, t("dnd.on"))),
      react.createElement("select", { value: String(s.dndStart), onChange: e => commit(Object.assign({}, s, { dndStart: Number(e.target.value) })), style: selStyle }, hourOpts()),
      react.createElement("span", { style: mutedStyle }, t("dnd.to")),
      react.createElement("select", { value: String(s.dndEnd), onChange: e => commit(Object.assign({}, s, { dndEnd: Number(e.target.value) })), style: selStyle }, hourOpts())),

    /* ===================== 提醒声音 ===================== */
    section("sec.sound"),
    react.createElement("div", { style: rowStyle },
      react.createElement("span", { style: keyStyle }, t("volume")),
      react.createElement("input", { type: "range", min: "0", max: "2", step: "0.05", value: s.volume, onChange: e => commit(Object.assign({}, s, { volume: Number(e.target.value) })), style: { width: "160px" } }),
      react.createElement("span", null, Math.round(s.volume * 100) + "%")),
    react.createElement("div", { style: rowStyle },
      react.createElement("span", { style: keyStyle }, t("rate")),
      react.createElement("select", { value: String(s.voiceRate || 1), onChange: e => commit(Object.assign({}, s, { voiceRate: Number(e.target.value) })), style: selStyle },
        react.createElement("option", { value: "0.7" }, t("rate.slow")),
        react.createElement("option", { value: "1" }, t("rate.normal")),
        react.createElement("option", { value: "1.3" }, t("rate.fast")))),
    react.createElement("div", { style: rowStyle },
      react.createElement("span", { style: keyStyle }, t("read")),
      react.createElement("label", { style: { display: "flex", alignItems: "center", gap: "8px" } },
        react.createElement("input", { type: "checkbox", checked: !!s.readOutput, onChange: e => commit(Object.assign({}, s, { readOutput: !!e.target.checked })) }),
        react.createElement("span", { style: mutedStyle }, t("read.hint")))),
    react.createElement("div", { style: rowStyle },
      react.createElement("span", { style: keyStyle }, t("stall")),
      react.createElement("select", { value: String(s.stallMs || 0), onChange: e => commit(Object.assign({}, s, { stallMs: Number(e.target.value) })), style: selStyle },
        react.createElement("option", { value: "0" }, t("stall.off")),
        react.createElement("option", { value: "60000" }, t("stall.1")),
        react.createElement("option", { value: "120000" }, t("stall.2")),
        react.createElement("option", { value: "300000" }, t("stall.5"))),
      react.createElement("span", { style: mutedStyle }, t("stall.hint"))),
    /* 每类提醒：启用 + 音色 + 一键预览（放在「提醒声音」组末尾） */
    rows,

    /* ===================== 屏幕提示（提示相关全在一起） ===================== */
    section("sec.screen"),
    react.createElement("div", { style: rowStyle },
      react.createElement("span", { style: keyStyle }, t("toast")),
      react.createElement("label", { style: { display: "flex", alignItems: "center", gap: "8px" } },
        react.createElement("input", { type: "checkbox", checked: !!s.showToast, onChange: e => commit(Object.assign({}, s, { showToast: !!e.target.checked })) }),
        react.createElement("span", { style: mutedStyle }, t("toast.hint")))),
    react.createElement("div", { style: rowStyle },
      react.createElement("span", { style: keyStyle }, t("toastStyle")),
      react.createElement("select", { value: s.toastStyle === "original" ? "original" : "own", onChange: e => { commit(Object.assign({}, s, { toastStyle: e.target.value })); props.previewToast("done"); }, style: selStyle },
        react.createElement("option", { value: "own" }, t("toastStyle.own")),
        react.createElement("option", { value: "original" }, t("toastStyle.original")))),
    react.createElement("div", { style: rowStyle },
      react.createElement("span", { style: keyStyle }, t("toastScale")),
      react.createElement("select", { value: String(toastScaleOf(s)), onChange: e => { commit(Object.assign({}, s, { toastScale: Number(e.target.value) })); props.previewToast("done"); }, style: selStyle },
        TOAST_SCALES.map(n => react.createElement("option", { key: n, value: String(n) }, n + "×"))),
      react.createElement("span", { style: mutedStyle }, t("toastScale.hint"))),
    /* 真实预览：按当前大小弹一条真身（调完上面两项顺手点一下就看到了）
     * 文案分两行「弹一条 / 看大小」：一行四个字会被按钮宽度挤成 3+1 的难看断行。 */
    react.createElement("div", { style: rowStyle },
      react.createElement("span", { style: keyStyle }, t("preview.real")),
      react.createElement("button", {
        style: Object.assign({}, btnStyle, { lineHeight: 1.5, textAlign: "center", whiteSpace: "nowrap" }),
        onClick: () => props.previewToast("done"),
      },
        react.createElement("span", { style: { display: "block" } }, t("preview.real.button1")),
        react.createElement("span", { style: { display: "block" } }, t("preview.real.button2"))),
      react.createElement("span", { style: mutedStyle }, t("preview.real.hint"))),
    /* ---- 各类提醒长什么样：静态预览（1× 示意，看配色与文字）----
     * 与真身**共用同一个 OwnToast**（inline 模式），所以排版配色不会漂移；
     * **真实大小**请点上面的「弹一条看看」或每类右边的「预览」。 */
    react.createElement("div", { style: previewTitleStyle }, t("preview.title")),
    react.createElement("div", { style: previewListStyle },
      KINDS.map(kind => react.createElement("div", { key: kind, style: previewRowStyle },
        react.createElement("span", { style: previewLabelStyle }, t(kind)),
        react.createElement("div", { style: previewCellStyle },
          react.createElement(OwnToast, { kind: kind, at: Date.now(), inline: true }))))),
    react.createElement("div", { style: hintStyle }, t("preview.hint")),

    /* ===================== 恢复默认 ===================== */
    section("sec.reset"),
    react.createElement("div", { style: rowStyle },
      react.createElement("button", { style: btnStyle, onClick: () => { if (typeof window === "undefined" || typeof window.confirm !== "function" || window.confirm(t("reset.confirm"))) commit(deepMerge(DEFAULTS, {})); } }, t("reset")),
      react.createElement("span", { style: mutedStyle }, t("reset.hint"))),

    /* ===================== 诊断（为什么没提醒？） ===================== */
    section("sec.diag"),
    react.createElement(DiagBlock, {
      // 兜底：单测/异常环境下即使没拿到诊断接口也不能让整页崩掉
      getDiag: props.getDiag || (() => ({ sessionsReady: false, seen: 0, running: 0, observes: 0, lastKind: null, lastAt: 0, lastBlocked: null })),
      testAlert: props.testAlert || (() => {}),
    }),
    react.createElement("div", { style: hintStyle }, t("hint"))
  );
}

/* ===================== 诊断块：回答「为什么没提醒」 =====================
 * 2026-10-06：用户反馈「每次完成怎么没有提醒」，而设置里所有闸门都是开的。
 * 与其继续猜，不如把插件**实际看到的东西**摆出来：
 *   - 会话检测是否就绪、看到几个会话、几个在跑、被观察了多少次；
 *   - 上次提醒是什么类别、什么时候、有没有被勿扰挡下；
 *   - 当前闸门快照：悬浮提示 / 音量 / 勿扰 / 范围 / 完成音色；
 *   - 一个「测试一次完整提醒」按钮：走真实 alert() 路径（受上面这些闸门影响），
 *     点了没声音、没横幅，就直接说明是哪道闸门挡的。
 * 每 1 秒轮询一次（面板关闭即停），不影响任何提醒逻辑。 */
function DiagBlock(props) {
  const pair = react.useState(props.getDiag());
  const d = pair[0], setD = pair[1];
  react.useEffect(() => {
    if (typeof window === "undefined" || typeof window.setInterval !== "function") return undefined;
    const id = window.setInterval(() => setD(props.getDiag()), 1000);
    return () => { try { window.clearInterval(id); } catch (e) {} };
  }, []);
  const line = (label, value) => react.createElement("div", { style: hintStyle },
    react.createElement("span", { style: { opacity: 0.75 } }, label + t("sep")),
    react.createElement("span", null, value));
  const onOff = (flag) => (flag ? t("diag.on") : t("diag.off"));
  const doneSound = (settings.types && settings.types.done && settings.types.done.sound) || "ding";
  const lastValue = d.lastKind
    ? t(d.lastKind) + " " + formatClock(d.lastAt) + (d.lastBlocked === "dnd" ? "（" + t("diag.blockedDnd") + "）" : "")
    : t("diag.never");
  return react.createElement("div", { style: { display: "flex", flexDirection: "column", gap: "4px" } },
    line(t("diag.detect"), (d.sessionsReady ? t("diag.ok") : t("diag.no"))
      + " · " + t("diag.sessions") + " " + d.seen + "（" + t("diag.running") + " " + d.running + "）"
      + " · " + t("diag.observes") + " " + d.observes),
    line(t("diag.last"), lastValue),
    line(t("diag.gates"), onOff(settings.showToast) + " · " + Math.round(settings.volume * 100) + "% · "
      + t("dnd") + " " + onOff(settings.dndEnabled) + " · " + (settings.scope === "current" ? t("scope.current") : t("scope.all"))
      + " · " + t("sound." + doneSound)),
    react.createElement("div", { style: rowStyle },
      react.createElement("button", { style: btnStyle, onClick: () => props.testAlert("done") }, t("diag.test")),
      react.createElement("span", { style: mutedStyle }, t("diag.test.hint"))));
}

/* ===================== 浮条 1：原方案（上游彩条，3.6 秒自关） ===================== */
function OriginalToast(props) {
  const s = TOAST_MAP[props.kind] || TOAST_MAP.connected;
  return react.createElement("div", {
    style: Object.assign({}, TOAST_BASE, {
      padding: "12px 20px",
      borderRadius: "12px",
      color: "#fff",
      fontWeight: 600,
      fontSize: 14,
      lineHeight: 1.4,
      boxShadow: "0 8px 30px rgba(0,0,0,.28)",
      background: s.bg,
      pointerEvents: "none",
    }),
  }, t(props.kind));
}

/* ===================== 浮条 2：自研常驻条 =====================
 *
 * 需求（2026-10-06，用户原话）：
 *   1.「不要用黑色，不明显，也用原来的绿色」→ 背景用**该类别的原色**（完成 = 原来的绿色
 *      #16a34a，出错 = 红，审批 = 琥珀，提问 = 紫，卡住 = 橙），不再用深色黑卡片；
 *   2.「大小先放大 5 倍……这东西要的就是一走一过，明显能看到才行」→ 尺寸由
 *      OWN_TOAST_SCALE 统一缩放（设置里「提示大小」可调），基数在 OWN_TOAST_BASE；
 *   3.「提示只保留文字，左面的点，右面的 X 都不用」→ 只有文字，没有圆点、没有关闭按钮；
 *      收起方式就是鼠标明显移动或点击一下（见 createToastStore）。
 * 文字居中两行：类别 /「时刻 · 怎么收起」。 */
const OWN_TOAST_SCALE = 5; // = DEFAULTS.toastScale，也是设置缺失时的兜底
const OWN_TOAST_BASE = {
  paddingX: 16, paddingY: 12,
  title: 14, sub: 11,
  bottom: 28, radius: 12,
};
/** 设置里「提示大小」可选的倍数。 */
const TOAST_SCALES = [1, 2, 3, 4, 5, 6, 8];
/** 从设置里取放大倍数：非法/缺失回默认，并夹在 1–10 之间（别把整个屏幕吃光）。 */
function toastScaleOf(cfg) {
  const value = Number(cfg && cfg.toastScale);
  if (!Number.isFinite(value)) return OWN_TOAST_SCALE;
  return Math.min(10, Math.max(1, value));
}

/**
 * 自研浮条。
 * props.inline === true 时渲染成「设置页里的静态预览」：去掉 fixed/居中变换、按 1 倍显示、
 * 撑满可用宽度——与真身**共用同一套样式**，所以预览不会跟实际效果漂移。
 */
function OwnToast(props) {
  const accent = (TOAST_MAP[props.kind] || TOAST_MAP.connected).bg;
  const inline = props.inline === true;
  const k = inline ? 1 : toastScaleOf(settings);
  const b = OWN_TOAST_BASE;
  const px = (value) => Math.round(value * k) + "px";
  /* 两条硬约定（2026-10-06 用户截图：5× 时第二行折成两行、整条变三行）：
   *   1. **两行永不断行** —— `whiteSpace: nowrap`；
   *   2. **底色与文字同比** —— 内边距、圆角、字号全用同一个 k，并且**不设宽度上限**，
   *      卡片跟着内容一起变宽；之前限了 `maxWidth: 100vw-32px`，字号上去、宽度被卡住，
   *      于是折行。 */
  const noWrap = inline ? "normal" : "nowrap";
  const card = {
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    gap: px(2),
    textAlign: "center",
    padding: px(b.paddingY) + " " + px(b.paddingX),
    borderRadius: px(b.radius),
    color: "#fff",
    background: accent,
    fontFamily: "system-ui, sans-serif",
    whiteSpace: noWrap,
    pointerEvents: "none",
  };
  if (inline) {
    card.position = "static";
    card.width = "100%";
    card.boxShadow = "none";
    card.opacity = 0.95;
  } else {
    card.position = "fixed";
    card.left = "50%";
    card.bottom = px(b.bottom);
    card.transform = "translateX(-50%)";
    card.zIndex = 2147483647;
    card.boxShadow = "0 " + px(4) + " " + px(14) + " rgba(0,0,0,.35)";
  }
  const title = { display: "block", fontWeight: 600, fontSize: px(b.title), lineHeight: 1.2, whiteSpace: noWrap };
  const sub = { display: "block", fontSize: px(b.sub), lineHeight: 1.2, opacity: 0.85, whiteSpace: noWrap };
  return react.createElement("div", { style: card, role: "status", "aria-live": "polite" },
    react.createElement("span", { style: title }, t(props.kind)),
    react.createElement("span", { style: sub }, formatClock(props.at) + " · " + t("own.hint")));
}

/**
 * 把浮条挂到 `<body>` 上。
 *
 * 为什么必须 portal：`shell.overlay` 的容器是 `.overlayLayer { z-index: 20 }`——
 * 它自己就是一个堆叠上下文，浮条写在里面的 z-index 再大也**压不过设置弹窗**
 * （2026-10-06 用户截图：点「预览」后横幅正好被设置窗盖住）。
 * portal 到 body 之后，2147483647 才是真的在最前面。
 * 拿不到 react-dom 时退回槽内渲染：仍能用，只是可能被弹窗压住。
 */
function portalToBody(node) {
  if (node && reactDom && typeof reactDom.createPortal === "function"
    && typeof document !== "undefined" && document && document.body) {
    try { return reactDom.createPortal(node, document.body); } catch (e) { /* 回落到槽内渲染 */ }
  }
  return node;
}

/* ===================== 浮条分发：按设置挑一种实现 ===================== */
function AlertToast(props) {
  const pair = react.useState(props.getCurrent());
  const msg = pair[0], setMsg = pair[1];
  const atPair = react.useState(props.getCurrentAt());
  const at = atPair[0], setAt = atPair[1];
  react.useEffect(() => props.subscribe(() => { setMsg(props.getCurrent()); setAt(props.getCurrentAt()); }), []);
  if (!msg) return null;
  // 「预览」是你主动点的，所以即使「悬浮提示」总开关关着也要显示——否则点了预览什么都没发生，
  // 用户会以为功能坏了（这正是 2026-10-06 反馈「无法看到真实效果」的一种可能）。
  const isPreview = typeof props.isPreview === "function" ? props.isPreview() : false;
  if (!settings.showToast && !isPreview) return null;
  const card = settings.toastStyle === "original"
    ? react.createElement(OriginalToast, { kind: msg })
    : react.createElement(OwnToast, { kind: msg, at: at });
  return portalToBody(card);
}

/* 供单测读取浮条尺寸旋钮（panel.js 的 const 在 __test 之后才求值，所以这里补挂）。 */
exports.__test.OWN_TOAST_SCALE = OWN_TOAST_SCALE;
exports.__test.OWN_TOAST_BASE = OWN_TOAST_BASE;
exports.__test.TOAST_SCALES = TOAST_SCALES;
exports.__test.toastScaleOf = toastScaleOf;
