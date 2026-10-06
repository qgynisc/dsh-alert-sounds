# 跟上上游（dsh-alert-sound）的流程

本仓库是 [Machine-126/dsh-alert-sound](https://github.com/Machine-126/dsh-alert-sound) 的 fork，但**代码结构不同**：

| | 上游 | 本仓库 |
|---|---|---|
| 客户端源码 | 单文件 `lib/client.js`（手写 bundle，821 行） | `src/client.js`（引擎）+ `src/panel.js`（界面） |
| 产物 | 仓库里的就是源码 | `scripts/build.mjs` 生成 `lib/client.js` / `lib/index.js` |
| 标识符 | `@machine-126/dsh-alert-sound`、`dsh-alert-sound.v1`… | `@qgynisc/dsh-alert-sounds`、`dsh-alert-sounds.v1`… |

**所以 `git merge upstream/main` 没有意义**（文件不是同一批，冲突会覆盖掉我们的拆分）。跟上游靠三步机械流程：

1. `vendor/upstream/<版本>/` —— 上游 `lib/client.js` 的**逐字节快照**（`MANIFEST.json` 里有 sha256）；
2. `npm run check:upstream` —— 把上游当前 main 与快照逐行比对，切成 hunk，**指名每个 hunk 属于上游哪个函数，并去 `src/` 里找同名符号**告诉你该改哪个文件；
3. `npm run rename` —— 搬运过来的代码里带的是上游标识符，跑一次幂等改名统一。

## 标准流程

```sh
# 0) 干净起点
git status                 # 别有未提交改动
npm test                   # 起点必须全绿

# 1) 看上游改了什么，落新快照
npm run check:upstream     # 只报告（有更新则退出码 2）；确认后：
npm run sync:upstream      # 落快照到 vendor/upstream/<新版本>/ 并打印搬运指引

# 2) 按指引把改动搬进 src/
#    - 引擎/检测/播放 → src/client.js（**保持上游的函数名与注释**，下次好对应）
#    - 设置页/浮条    → src/panel.js
#    - 新增的设置项：同时补 I18N 中英两份、DEFAULTS、设置页那一行

# 3) 改完立刻做的三件事
npm run rename             # 上游标识符 → 本仓库标识符（幂等，可重复跑）
npm run build              # 重新生成 lib/（lib/ 必须入库）
npm test                   # 50 项单测 + 安装自检

# 4) 记录 + 发布
#   CHANGELOG.md 里加一条：跟了上游哪个版本、搬了哪几个修复
npm version minor          # 或 patch：跟上游 bug 修复用 patch
git push --follow-tags     # CI 自动发 npm + 建 GitHub Release
```

## 判断「要不要跟」

- **补丁类**（修 bug、兼容新 DSH 版本）：**必跟**。上游 0.3.x 整批都在修「完成不响」「只剩尾音」「TTS 丢 utterance」这类真实问题，这些正是本插件能不能用的关键。
- **界面/交互类**：按本仓库的定位取舍（例如上游若把浮条改回纯短时，我们保留「提示样式」二选一）。
- **新增设置项**：跟，但要保证 i18n 齐全（`tests/unit/i18n.test.mjs` 会强制中英键集合一致）。

## 单测是你的护栏

搬运上游代码时，哪些行为不能被破坏，测试里都有对应条目：

| 测试文件 | 守住什么 |
|---|---|
| `tests/unit/bundle.test.mjs` | 产物形态：loader id = 包名、只解析 react、改名闸门、`lib/` 不能进 .gitignore |
| `tests/unit/detect.test.mjs` | 完成/失败/审批/提问的检测链路、加载前已挂起不误响、范围与勿扰 |
| `tests/unit/toast.test.mjs` | 两种浮条实现与停留策略（本 fork 的核心改动） |
| `tests/unit/settings.test.mjs` | 老设置读入不丢项、默认值语义 |
| `tests/unit/i18n.test.mjs` | 中英词典成对齐全 |
| `scripts/verify-install.mjs` | 加载器解析链（`--simulate` 可在 CI 跑） |

## 冲突与大改预案

- **上游重写某个函数**：以行为为准搬过来，别按行硬套；搬完跑 `npm test`，红了就对着上表定位是哪个行为变了。
- **上游改了 `package.json`**：只取真正需要的字段（如新增 `dsh.client` 声明），**包名/仓库地址/版本一律保留本仓库的**。
- **上游改了 `cordis.patch.yml`**：我们的行 id 是 `alert-sounds`、name 是包名，不要照抄上游的行 id（`dsh-alert-sound`）——那会与我们的插件卡片重复显示。
- **完全跟不动了**（上游大重构）：把 `vendor/upstream/<新版本>/lib/client.js` 通读一遍，只挑「影响用户可见行为」的修复移植，并在 CHANGELOG 里写明**主动跳过**了哪些改动。诚实记录比假装全跟更重要。

## 发布链路（本仓库自己的一套）

上游用的是 npm **可信发布（OIDC staged publishing）**，那是上游在自己包上配的权限，本仓库**不适用**。本仓库走 GitHub Actions + `NPM_TOKEN`：

1. 在 npm 建 **Granular Access Token**（务必勾选 *Bypass two-factor authentication*，classic token 已被 npm 废弃）；
2. 仓库 **Settings → Secrets and variables → Actions** 里添加 `NPM_TOKEN`；
3. 本地 `npm version patch|minor` 会打 `vX.Y.Z` tag，`git push --follow-tags` 触发 `.github/workflows/release.yml`：
   校验 tag 与 `package.json` 版本一致 → `npm run test:ci` → `npm publish --access public` → 建 GitHub Release。
