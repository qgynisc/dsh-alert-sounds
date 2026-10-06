/**
 * dsh-alert-sounds — 上游同步助手
 *
 * 本仓库选择了「拆 src/ + build」结构，所以**不能直接 git merge 上游**：上游只发
 * 一个 lib/client.js，我们这边是 src/client.js + src/panel.js。这个脚本把「跟上游」
 * 这件事变成可重复的机械流程：
 *
 *   1. 拉上游当前的 lib/client.js，与 vendor/upstream/<版本>/lib/client.js 逐行比对；
 *   2. 把差异切成带上下文的 hunk，并**指名每个 hunk 属于上游哪个函数**；
 *   3. 去 src/ 里找同名函数，直接告诉你该改哪个文件哪一段（省掉重新读一遍上游）；
 *   4. 默认把新快照落进 vendor/upstream/<新版本>/ 并更新 MANIFEST.json。
 *
 * 用法：
 *   node scripts/sync-upstream.mjs           # 比对 + 落新快照 + 打印搬运指引
 *   node scripts/sync-upstream.mjs --check    # 只比对（有上游更新则退出码 2），适合放进 CI 提醒
 *
 * 网络：走 api.github.com（本机实测 api 通、raw.githubusercontent 不通，故用 api）。
 * 拉不动时脚本会明确报错并给出 git clone 的替代命令，不会静默假装"已是最新"。
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(join(dirname(fileURLToPath(import.meta.url)), '..'))
const VENDOR = join(ROOT, 'vendor', 'upstream')
const UPSTREAM_REPO = 'Machine-126/dsh-alert-sound'
const CHECK_ONLY = process.argv.includes('--check')

const sha = (text) => createHash('sha256').update(text).digest('hex')

/** 当前快照目录（取语义化版本号最大的那个）。 */
function latestSnapshot() {
  if (!existsSync(VENDOR)) throw new Error('找不到 vendor/upstream/，仓库不完整')
  const versions = readdirSync(VENDOR).filter((name) => /^\d+\.\d+\.\d+$/.test(name))
  if (versions.length === 0) throw new Error('vendor/upstream 下没有版本目录')
  versions.sort((a, b) => {
    const pa = a.split('.').map(Number)
    const pb = b.split('.').map(Number)
    return pa[0] - pb[0] || pa[1] - pb[1] || pa[2] - pb[2]
  })
  const version = versions[versions.length - 1]
  return { version, dir: join(VENDOR, version) }
}

async function fetchUpstream(path) {
  const url = `https://api.github.com/repos/${UPSTREAM_REPO}/contents/${path}?ref=main`
  let response
  try {
    response = await fetch(url, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'dsh-alert-sounds-sync' } })
  } catch (error) {
    throw new Error(`拉取上游失败（网络）：${error.message}\n  可改用：git clone --depth 1 https://github.com/${UPSTREAM_REPO} /tmp/upstream`)
  }
  if (!response.ok) {
    throw new Error(`拉取上游失败：HTTP ${response.status}\n  URL：${url}\n  可改用：git clone --depth 1 https://github.com/${UPSTREAM_REPO} /tmp/upstream`)
  }
  const body = await response.json()
  return Buffer.from(body.content, 'base64').toString('utf8')
}

/* ---------- 极简行级 diff（LCS；上游文件 ~800 行，DP 完全够用） ---------- */
function diffLines(before, after) {
  const a = before.split('\n')
  const b = after.split('\n')
  const n = a.length, m = b.length
  const table = new Int32Array((n + 1) * (m + 1))
  const at = (i, j) => i * (m + 1) + j
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[at(i, j)] = a[i] === b[j]
        ? table[at(i + 1, j + 1)] + 1
        : Math.max(table[at(i + 1, j)], table[at(i, j + 1)])
    }
  }
  const ops = []
  let i = 0, j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) { ops.push({ type: 'same', oldLine: i + 1, newLine: j + 1, text: a[i] }); i++; j++ }
    else if (table[at(i + 1, j)] >= table[at(i, j + 1)]) { ops.push({ type: 'del', oldLine: i + 1, text: a[i] }); i++ }
    else { ops.push({ type: 'add', newLine: j + 1, text: b[j] }); j++ }
  }
  while (i < n) { ops.push({ type: 'del', oldLine: i + 1, text: a[i] }); i++ }
  while (j < m) { ops.push({ type: 'add', newLine: j + 1, text: b[j] }); j++ }
  return { ops, before, after }
}

/** 把 ops 归并成 hunk（改动 ± 3 行上下文）。 */
function toHunks(ops, context = 3) {
  const changed = ops.map((op, index) => (op.type === 'same' ? -1 : index)).filter((index) => index >= 0)
  if (changed.length === 0) return []
  const groups = []
  let start = changed[0], end = changed[0]
  for (const index of changed.slice(1)) {
    if (index - end <= context * 2 + 1) end = index
    else { groups.push([start, end]); start = index; end = index }
  }
  groups.push([start, end])
  return groups.map(([from, to]) => {
    const lo = Math.max(0, from - context)
    const hi = Math.min(ops.length - 1, to + context)
    return ops.slice(lo, hi + 1)
  })
}

/** 找 hunk 之前最近的函数/常量名（用来把 hunk 映射到 src/ 里的位置）。 */
function ownerOf(beforeLines, oldLine) {
  for (let i = Math.min(oldLine - 1, beforeLines.length - 1); i >= 0; i--) {
    const match = /^\s{0,4}(?:function\s+(\w+)|const\s+(\w+)\s*=|let\s+(\w+)\s*=)/.exec(beforeLines[i])
    if (match) return match[1] ?? match[2] ?? match[3]
  }
  return undefined
}

/** 在 src/ 里找同名符号出现在哪个文件（给搬运指引）。 */
function findInSrc(symbol) {
  if (!symbol) return []
  const hits = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) { walk(full); continue }
      if (!/\.(js|mjs)$/.test(entry.name)) continue
      const text = readFileSync(full, 'utf8')
      if (new RegExp(`\\b${symbol}\\b`).test(text)) hits.push(join('src', full.slice(full.indexOf(join(ROOT, 'src')) + join(ROOT, 'src').length + 1)))
    }
  }
  walk(join(ROOT, 'src'))
  return hits
}

const snapshot = latestSnapshot()
const snapshotClient = readFileSync(join(snapshot.dir, 'lib', 'client.js'), 'utf8')
const upstreamClient = await fetchUpstream('lib/client.js')
const upstreamManifest = JSON.parse(await fetchUpstream('package.json'))
const upstreamVersion = upstreamManifest.version

if (sha(upstreamClient) === sha(snapshotClient)) {
  console.log(`✔ 上游无变化：快照版本 ${snapshot.version}（上游 package.json ${upstreamVersion}）与 main 分支一致`)
  process.exit(0)
}

const { ops } = diffLines(snapshotClient, upstreamClient)
const hunks = toHunks(ops)
const beforeLines = snapshotClient.split('\n')
const added = ops.filter((op) => op.type === 'add').length
const removed = ops.filter((op) => op.type === 'del').length

console.log(`上游有更新：快照 ${snapshot.version} → 上游 ${upstreamVersion}（+${added} 行 / -${removed} 行，${hunks.length} 个 hunk）\n`)

hunks.forEach((hunk, index) => {
  const anchor = hunk.find((op) => op.type !== 'same') ?? hunk[0]
  const oldLine = anchor.oldLine ?? anchor.newLine ?? 0
  const owner = ownerOf(beforeLines, oldLine)
  const targets = findInSrc(owner)
  console.log(`── hunk ${index + 1} ── 上游约第 ${oldLine} 行${owner ? `，位于 ${owner}()` : ''}`)
  console.log(`   本仓库对应位置：${targets.length > 0 ? targets.join('、') : '⚠️ src/ 里找不到同名符号 —— 可能是新函数/新段落，需要人工判断'}`)
  for (const op of hunk) {
    const mark = op.type === 'same' ? ' ' : op.type === 'add' ? '+' : '-'
    console.log(`   ${mark} ${op.text.slice(0, 160)}`)
  }
  console.log('')
})

if (CHECK_ONLY) {
  console.log(`上游有更新但 --check 模式只报告不落盘。要落快照：node scripts/sync-upstream.mjs`)
  process.exit(2)
}

const targetDir = join(VENDOR, upstreamVersion)
mkdirSync(join(targetDir, 'lib'), { recursive: true })
writeFileSync(join(targetDir, 'lib', 'client.js'), upstreamClient)
writeFileSync(join(targetDir, 'package.json'), JSON.stringify(upstreamManifest, null, 2) + '\n')
const manifest = {
  source: `https://github.com/${UPSTREAM_REPO}`,
  ref: 'main',
  npm: `${upstreamManifest.name}@${upstreamVersion}`,
  note: '上游 main 分支的逐字节快照（lib/client.js）。用于 scripts/sync-upstream.mjs 做差异比对：本仓库是 src/ 重构过的，无法直接 git merge 上游，靠这个快照把上游每个 hunk 映射回 src/。',
  files: {
    'lib/client.js': { sha256: sha(upstreamClient), bytes: Buffer.byteLength(upstreamClient) },
  },
}
writeFileSync(join(targetDir, 'MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n')
console.log(`✔ 新快照已落到 vendor/upstream/${upstreamVersion}/`)
console.log('  下一步：按上面的 hunk 指引把改动搬进 src/（改完跑 npm run rename && npm test），再更新 CHANGELOG。')
