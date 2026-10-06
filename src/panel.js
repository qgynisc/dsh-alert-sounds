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

/** 浮条统一挂在屏幕底部中间（与上游同位置，换实现不换位置）。 */
const TOAST_BASE = {
  position: "fixed",
  left: "50%",
  bottom: "28px",
  transform: "translateX(-50%)",
  zIndex: 2147483000,
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
        react.createElement("button", { style: btnStyle, onClick: () => props.play(kind) }, t("preview")),
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
    react.createElement("div", { style: rowStyle },
      react.createElement("span", { style: keyStyle }, t("lang.label")),
      react.createElement("select", { value: s.lang || "auto", onChange: e => commit(Object.assign({}, s, { lang: e.target.value })), style: selStyle },
        react.createElement("option", { value: "auto" }, t("lang.auto")),
        react.createElement("option", { value: "zh" }, t("lang.zh")),
        react.createElement("option", { value: "en" }, t("lang.en")))),
    react.createElement("div", { style: rowStyle },
      react.createElement("span", { style: keyStyle }, t("volume")),
      react.createElement("input", { type: "range", min: "0", max: "2", step: "0.05", value: s.volume, onChange: e => commit(Object.assign({}, s, { volume: Number(e.target.value) })), style: { width: "160px" } }),
      react.createElement("span", null, Math.round(s.volume * 100) + "%")),
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
    react.createElement("div", { style: rowStyle },
      react.createElement("span", { style: keyStyle }, t("toast")),
      react.createElement("label", { style: { display: "flex", alignItems: "center", gap: "8px" } },
        react.createElement("input", { type: "checkbox", checked: !!s.showToast, onChange: e => commit(Object.assign({}, s, { showToast: !!e.target.checked })) }),
        react.createElement("span", { style: mutedStyle }, t("toast.hint")))),
    /* 两种浮条实现二选一：原方案（上游彩条，3.6 秒自关）/ 自研常驻条 */
    react.createElement("div", { style: rowStyle },
      react.createElement("span", { style: keyStyle }, t("toastStyle")),
      react.createElement("select", { value: s.toastStyle === "original" ? "original" : "own", onChange: e => commit(Object.assign({}, s, { toastStyle: e.target.value })), style: selStyle },
        react.createElement("option", { value: "own" }, t("toastStyle.own")),
        react.createElement("option", { value: "original" }, t("toastStyle.original")))),
    react.createElement("div", { style: rowStyle },
      react.createElement("span", { style: keyStyle }, t("rate")),
      react.createElement("select", { value: String(s.voiceRate || 1), onChange: e => commit(Object.assign({}, s, { voiceRate: Number(e.target.value) })), style: selStyle },
        react.createElement("option", { value: "0.7" }, t("rate.slow")),
        react.createElement("option", { value: "1" }, t("rate.normal")),
        react.createElement("option", { value: "1.3" }, t("rate.fast")))),
    react.createElement("div", { style: rowStyle },
      react.createElement("span", { style: keyStyle }, t("dnd")),
      react.createElement("label", { style: { display: "flex", alignItems: "center", gap: "6px" } },
        react.createElement("input", { type: "checkbox", checked: !!s.dndEnabled, onChange: e => commit(Object.assign({}, s, { dndEnabled: !!e.target.checked })) }),
        react.createElement("span", { style: mutedStyle }, t("dnd.on"))),
      react.createElement("select", { value: String(s.dndStart), onChange: e => commit(Object.assign({}, s, { dndStart: Number(e.target.value) })), style: selStyle }, hourOpts()),
      react.createElement("span", { style: mutedStyle }, t("dnd.to")),
      react.createElement("select", { value: String(s.dndEnd), onChange: e => commit(Object.assign({}, s, { dndEnd: Number(e.target.value) })), style: selStyle }, hourOpts())),
    react.createElement("div", { style: rowStyle },
      react.createElement("button", { style: btnStyle, onClick: () => { if (typeof window === "undefined" || typeof window.confirm !== "function" || window.confirm(t("reset.confirm"))) commit(deepMerge(DEFAULTS, {})); } }, t("reset")),
      react.createElement("span", { style: mutedStyle }, t("reset.hint"))),
    rows,
    react.createElement("div", { style: hintStyle }, t("hint"))
  );
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

/* ===================== 浮条 2：自研常驻条 ===================== */
function OwnToast(props) {
  const accent = (TOAST_MAP[props.kind] || TOAST_MAP.connected).bg;
  const card = Object.assign({}, TOAST_BASE, {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "12px 14px 12px 16px",
    borderRadius: "12px",
    color: "#fff",
    background: "rgba(24,24,27,0.94)",
    border: "1px solid rgba(255,255,255,0.10)",
    borderLeft: "4px solid " + accent,
    boxShadow: "0 10px 34px rgba(0,0,0,.34)",
    pointerEvents: "none",
  });
  const closeBtn = {
    marginLeft: "4px",
    width: "22px",
    height: "22px",
    lineHeight: "18px",
    fontSize: "15px",
    borderRadius: "6px",
    cursor: "pointer",
    color: "#fff",
    background: "transparent",
    border: "1px solid rgba(255,255,255,0.28)",
    pointerEvents: "auto",
  };
  return react.createElement("div", { style: card, role: "status", "aria-live": "polite" },
    react.createElement("span", { style: { width: "9px", height: "9px", borderRadius: "50%", background: accent, flex: "0 0 auto" } }),
    react.createElement("div", { style: { display: "flex", flexDirection: "column", gap: "2px" } },
      react.createElement("span", { style: { fontWeight: 600, fontSize: 14, lineHeight: 1.3 } }, t(props.kind)),
      react.createElement("span", { style: { fontSize: 11, opacity: 0.62 } }, formatClock(props.at) + " · " + t("own.hint"))),
    react.createElement("button", { style: closeBtn, onClick: props.onClose, title: t("toast.close"), "aria-label": t("toast.close") }, "×")
  );
}

/* ===================== 浮条分发：按设置挑一种实现 ===================== */
function AlertToast(props) {
  const pair = react.useState(props.getCurrent());
  const msg = pair[0], setMsg = pair[1];
  const atPair = react.useState(props.getCurrentAt());
  const at = atPair[0], setAt = atPair[1];
  react.useEffect(() => props.subscribe(() => { setMsg(props.getCurrent()); setAt(props.getCurrentAt()); }), []);
  if (!msg) return null;
  if (!settings.showToast) return null;
  if (settings.toastStyle === "original") return react.createElement(OriginalToast, { kind: msg });
  return react.createElement(OwnToast, { kind: msg, at: at, onClose: props.close });
}
