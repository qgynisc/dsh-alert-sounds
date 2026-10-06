# dsh-alert-sounds

[![npm](https://img.shields.io/npm/v/@qgynisc/dsh-alert-sounds)](https://www.npmjs.com/package/@qgynisc/dsh-alert-sounds)
[![test](https://github.com/qgynisc/dsh-alert-sounds/actions/workflows/test.yml/badge.svg)](https://github.com/qgynisc/dsh-alert-sounds/actions/workflows/test.yml)
[![license](https://img.shields.io/github/license/qgynisc/dsh-alert-sounds)](https://github.com/qgynisc/dsh-alert-sounds/blob/main/LICENSE)
[![release](https://img.shields.io/github/v/release/qgynisc/dsh-alert-sounds)](https://github.com/qgynisc/dsh-alert-sounds/releases)

**简体中文** | [English](README.en.md)

为 **DeepSeek Harness (dsh) 网页图形界面**提供通知声音与屏幕提示：会话需要**审批**、需要**回答**、一轮**输出完成**、**出错**或**卡住**时，分别播不同的提示音（可选语音），并在屏幕上显示提示条。

> **本项目是 [@machine-126/dsh-alert-sound](https://github.com/Machine-126/dsh-alert-sound) 的 fork**（MIT）。
> 检测与播放那一整套实测修复原样保留，本 fork 只做两件事：
> ① 改名与重新打包（包名、loader id、slot id、localStorage 键全部独立）；
> ② **把「完成提示」从固定 3.6 秒改成可选的常驻式**——人不在屏幕前也能看到。

## 这个 fork 改了什么（相对上游 0.3.14）

| 改动 | 上游行为 | 本 fork |
|---|---|---|
| **完成提示的停留** | 固定 3.6 秒自动消失，且「悬浮提示」默认**关**（等于看不到） | 新增设置项 **提示样式**，在两种**独立实现**里二选一：<br>**① 自研常驻条（默认）**：卡片式提示条，**一直在，直到鼠标明显移动（≥8px）或点击**才收；带完成时刻 `HH:MM` 与右上角 `×`。<br>**② 原方案**：保留上游那条底部彩色横条 + 3.6 秒自动消失。 |
| **自研浮条的观感** | — | 底色用**类别的原色**（完成 = 原来的绿色 `#16a34a`，不是抢不抢眼的深色黑卡片），整体**放大 5 倍**（「一走一过也要看得见」），**只留文字**（无左侧圆点、无右侧 ×），限宽换行不溢出；设置里「提示大小」可 1×–8× 随时调 |
| **设置页顶部** | 只有标题 | 标题 + `本项目由插件 <包名> 实现 · 版本 <版本>` + `项目地址：<仓库>` + fork 来源（与 `@qgynisc/dsh-inline-pastes` 同形态；包名与版本由构建注入） |
| 包名 / 标识 | `@machine-126/dsh-alert-sound`、slot id `dsh-alert`、键 `dsh-alert-sound.v1` | 全部换成本仓库自己的名字，**两套设置互不干扰** |
| 结构 | 单文件 `lib/client.js`（821 行手写 bundle） | `src/client.js` + `src/panel.js`（引擎/界面分开）+ `scripts/build.mjs` 生成 `lib/`；附 50 项单测与安装自检 |
| 跟上游 | — | `npm run check:upstream` 把上游新版与 `vendor/` 快照逐行比对，并指名每个 hunk 属于哪个函数、在本仓库该改哪个文件 |
| React 依赖 | 顶层直接 `require('react')` | 改成可失败获取：拿不到 React 时设置页整块跳过，**声音与检测照常工作** |

其余行为（五类提醒、音色、语音与兜底、重复提醒、勿扰、停滞检测、系统通知、i18n、隐私）与上游一致。

## 功能

- **五类提醒，音色各异**：需要审批 / 需要回答 / 输出完成 / 发生错误，外加实验性的「卡住」（默认关）。
- **完成提示会等你**（本 fork 的重点）：默认那条提示条常驻在屏幕底部中间，你回来动一下鼠标或随手一点才会消失，并显示它是几点完成的。
- **两种提示样式随时切换**：想安静就切回上游的 3.6 秒彩条，想不放过任何一次完成就用自研常驻条。
- **设置页里直接看效果**：五类提醒各有静态预览条，每类还有「预览」按钮按当前大小真弹一条——不用等真的跑完一轮才知道长什么样。
- **启动不打扰**：没有「提醒已连接」的启动浮条（每次刷新都闪一条纯属噪音）。
- **可选语音（中/英文）**：把某类切到「语音」即用浏览器语音合成朗读，语言跟随“界面语言”；若浏览器 TTS 没能开始朗读，会自动改播该类的提示音，**保证一定有声**。开启「朗读输出」后，完成时会把助手最后的回复念出来。
- **提示音一定完整**：播放前有 200ms 静音预热唤醒输出设备（否则久未出声时开头会被吞掉，只剩尾音），多条提醒串行播放不互相打断。
- **阻断事件重复提醒**：审批/提问挂着时每 10/20/30 秒再响一次，直到处理；错误重复几次。
- **勿扰时段**：设定时段内全部静音。
- **提醒范围**：默认对所有会话提醒，也可只提醒当前会话。
- **浏览器系统通知**：开启后提醒时在系统通知区也弹一条。
- **不依赖任何网络**：全部在浏览器内完成，无请求、无遥测。

## 要求

- **DeepSeek Harness `0.1.2` 或更新**（`dsh web`）——审批/提问的检测依赖 `0.1.2` 引入的 `uiSession.pendingInteractions`；更早版本只能收到“完成/错误”提醒。
- 支持 Web Audio 的浏览器（播放音色）；Web Speech 用于语音，可选、缺失时自动降级为提示音。

## 安装

推荐用 npm 包（预构建、免构建授权）：

```sh
dsh plugin --profile desktop add @qgynisc/dsh-alert-sounds
```

也可从 GitHub 安装（`lib/` 已入库，纯 JS 无构建，直接生效）：

```sh
dsh plugin --profile desktop add github:qgynisc/dsh-alert-sounds
```

本仓库自带安装脚本（先备份 profile 清单，并顺手移除上游插件避免双响）：

```sh
npm run install:desktop     # 等价于 node scripts/install.mjs --profile desktop
```

> ⚠️ **不要和上游 `@machine-126/dsh-alert-sound` 同时装**：同一件事会响两套声音、弹两条提示。
> `npm run install:desktop` 默认帮你移除上游（想保留加 `--keep-upstream`）；`scripts/verify-install.mjs` 也会检查这一点。

装完**重启 `dsh web`**（或刷新页面），打开 **设置 → 提醒音**。

## 设置项

| 项 | 说明 |
|---|---|
| **设置分四组** | **基础** / **提醒声音** / **屏幕提示**（提示相关全在这一组）/ **其它**，每组标题上方有分隔线——不必在长列表里翻找提示设置 |
| 界面语言 | 自动 / 中文 / English（影响设置页、浮条文案与语音语言） |
| 音量 | 0–200% |
| 提醒范围 | 所有会话 / 仅当前会话 |
| 重复提醒 | 关 / 每 10 / 20 / 30 秒（审批、提问会一直响到处理为止） |
| 系统通知 | 浏览器通知，后台也能看到 |
| 朗读输出 | 配合「语音」音色，完成时念出助手最后的回复 |
| 停滞检测 | 关 / 1 / 2 / 5 分钟（实验性；**开了它第 5 类「卡住」才会触发**） |
| **悬浮提示** | 总开关（默认开） |
| **提示样式** | **自研常驻条**（直到鼠标移动或点击）/ **原方案**（底部彩条，3.6 秒自动消失） |
| **提示大小** | 自研浮条的放大倍数：1× / 2× / 3× / 4× / **5×（默认）** / 6× / 8×（只影响自研常驻条；原方案永远是上游那句 14px 彩条） |
| 语音语速 | 慢 / 标准 / 快 |
| 勿扰时段 | 起止小时 |
| **各类提醒预览** | 「屏幕提示」组里列出五类提醒的静态预览条（**1× 示意**，与真身**共用同一个组件**，样式不会漂移）；每类右边的 **「预览」** 按钮会按当前「提示大小」**真弹一条**并同时试听声音 |
| **真实效果预览** | 「弹一条看看」按当前「提示样式 / 提示大小」弹一条真身；**改样式或大小会自动弹一条**给你看；预览点一下即关、15 秒兜底，且不受「悬浮提示」总开关影响 |
| 每类提醒 | 启用开关 + 音色（叮咚/低沉/轻点/警醒/语音/自定义/静音）+ **预览**；选“自定义”可上传音频（≤2MB） |
| 恢复默认设置 | 带二次确认（已上传的自定义音色保留） |

偏好存在 `localStorage`：`dsh-alert-sounds.v1`（设置）、`dsh-alert-sounds.custom.v1`（自定义音色）。**与上游的键不同**，所以两个插件不会互相改设置。

## 隐私

所有处理都在浏览器内完成，插件**不发起任何网络请求**、不用 analytics/telemetry。只在内存中读取：会话列表的 `running`/`updatedAt`、挂起交互 `uiSession.pendingInteractions`（审批/提问的类型与工具名、原因、问题文本）、会话快照的 `lastAgentError`，以及**仅在开启「朗读输出」时**读取最后一条助手回复文本。以上不保存、不外发；唯一持久化的是你自己的设置与上传的自定义音色。

## 项目结构

```
├─ package.json            # dsh.bundle + dsh.client（web 客户端插件）
├─ cordis.patch.yml        # 组合补丁：插入一行插件（行 id=alert-sounds，name=包名）
├─ src/
│  ├─ client.js            # 引擎：设置、音色/语音、检测、槽注册（含 /*__PANEL__*/ 锚点）
│  ├─ panel.js             # 界面：设置页 + 两种浮条实现
│  └─ host.js              # 宿主半边（占位）
├─ scripts/
│  ├─ build.mjs            # 生成 lib/index.js 与 lib/client.js（loader id 取自包名）
│  ├─ rename.mjs           # 幂等改名（跟上游搬运后用）
│  ├─ sync-upstream.mjs    # 上游差异 → hunk 级搬运指引（npm run check:upstream）
│  ├─ install.mjs          # 装进 profile（默认顺手移除上游）
│  └─ verify-install.mjs   # 加载器解析链自检（支持 --simulate 在 CI 跑）
├─ tests/                  # 50 项单测：测的是 lib/ 里的构建产物
├─ vendor/upstream/        # 上游逐字节快照（跟上游时做差异比对）
└─ lib/                    # 构建产物，**必须入库**（git 安装不跑构建）
```

常用命令：

```sh
npm run build            # 改完 src/ 必须重新构建并提交 lib/
npm test                 # 构建 + 单测 + 安装自检
npm run test:ci          # CI 用（不含需要真 profile 的检查）
npm run rename           # 幂等改名（上游搬运后跑）
npm run check:upstream   # 上游有更新吗？有则打印搬运指引
```

## 跟上上游

上游发新版时**不能直接 `git merge`**（本仓库把 `lib/client.js` 拆成了 `src/`）。流程见 [docs/UPSTREAM.md](docs/UPSTREAM.md)：

```sh
npm run check:upstream   # 看上游改了什么、每个 hunk 该搬到哪个文件
# 按指引把改动搬进 src/（引擎部分函数名与上游保持一致，便于对应）
npm run rename           # 把上游名字换成本仓库的标识符
npm run build && npm test
git commit && git tag v1.0.1 && git push --follow-tags   # CI 自动发 npm
```

> 已知限制（沿用上游）：页面刚加载时**已经在运行**的会话，那一轮结束不会提醒（`seed()` 只建基线不记本轮）。正常一轮“开始→结束”都会响。

## 致谢（来源参考）

- **本 fork 的上游**：[Machine-126/dsh-alert-sound](https://github.com/Machine-126/dsh-alert-sound)（MIT）——检测思路、音色设计、播放与语音的那批实测修复都来自它。
- 上游的致谢一并保留：检测思路参考 [dsh-session-notification](https://github.com/dingyi222666/dsh-session-notification)（BSD-3-Clause）；「任务完成提示音」概念参考 [dsh-chime](https://github.com/HtO404/dsh-chime)（Apache-2.0）；打包结构 / web 客户端插件形态参考官方文档 `docs/user/develop/basic/publish.md`，以及 [dsh-plugin-tts](https://github.com/1624318455/dsh-plugin-tts)、[dsh-status-rotator](https://github.com/01Virex/dsh-status-rotator)、[dsh-web-ui-notify](https://github.com/omdsh-dev/dsh-web-ui-notify)。

## 许可

MIT。原版权归 Machine-126，本 fork 的改动归 qgynisc，详见 [LICENSE](LICENSE)。
