/**
 * dsh-alert-sounds — 改名脚本（幂等）
 *
 * 为什么需要它：本仓库把上游（@machine-126/dsh-alert-sound）的 lib/client.js 拆成了
 * src/ 结构，所以上游发新版时**不能直接 git merge**，要人工把上游 hunk 搬进 src/
 * （见 docs/UPSTREAM.md）。搬进来的代码里带的是上游的包名 / loader id / localStorage
 * 键 / cordis 行 id —— 搬完跑一次本脚本，把这些**标识符**统一换成本仓库的。
 *
 * 关键纪律：只换「作为标识符出现」的形态，绝不全文替换。原因：
 *   - 致谢与来源声明里合法地写着上游名字（`本文件是 @machine-126/dsh-alert-sound 的派生作品`、
 *     `https://github.com/Machine-126/dsh-alert-sound`），那些是**必须保留**的归属信息，
 *     盲改会把 MIT 的署名改成假的；
 *   - vendor/upstream/ 是上游的逐字节快照，改了就没法做差异比对了。
 *
 * 用法：
 *   node scripts/rename.mjs          # 应用改名
 *   node scripts/rename.mjs --check  # 只检查（有需要改的就退出码 1）
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readdirSync, statSync } from 'node:fs'

const ROOT = resolve(join(dirname(fileURLToPath(import.meta.url)), '..'))
const CHECK_ONLY = process.argv.includes('--check')

/** 要改名的标识符规则（顺序有意义：先长后短）。 */
const RULES = [
  { name: 'localStorage 自定义音色键', from: 'dsh-alert-sound.custom.v1', to: 'dsh-alert-sounds.custom.v1' },
  { name: 'localStorage 设置键', from: 'dsh-alert-sound.v1', to: 'dsh-alert-sounds.v1' },
  { name: 'loader id / 包名（双引号）', from: '"@machine-126/dsh-alert-sound"', to: '"@qgynisc/dsh-alert-sounds"' },
  { name: 'loader id / 包名（单引号）', from: "'@machine-126/dsh-alert-sound'", to: "'@qgynisc/dsh-alert-sounds'" },
  { name: '宿主导出名', from: "name = 'dsh-alert-sound'", to: "name = 'dsh-alert-sounds'" },
  { name: '宿主导出名（双引号）', from: 'name = "dsh-alert-sound"', to: 'name = "dsh-alert-sounds"' },
  { name: 'cordis 行 id', from: 'id: dsh-alert-sound\n', to: 'id: alert-sounds\n' },
  { name: 'slot id（设置页）', from: 'id: "dsh-alert"', to: 'id: "dsh-alert-sounds"' },
  { name: 'slot id（浮条）', from: 'id: "dsh-alert-toast"', to: 'id: "dsh-alert-sounds-toast"' },
]

/** 扫描范围：源码与文档；vendor/ 是上游快照，绝不动。 */
const SKIP_DIRS = new Set(['node_modules', '.git', 'vendor', 'lib', '.workbuddy'])
const TEXT_EXTENSIONS = ['.js', '.mjs', '.cjs', '.json', '.yml', '.yaml', '.md', '.txt']

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue
      walk(full, out)
    } else if (TEXT_EXTENSIONS.some((ext) => entry.endsWith(ext))) {
      out.push(full)
    }
  }
  return out
}

const files = walk(ROOT).filter((file) => relative(ROOT, file) !== join('scripts', 'rename.mjs'))
const changes = []

for (const file of files) {
  const original = readFileSync(file, 'utf8')
  let text = original
  const hits = []
  for (const rule of RULES) {
    if (!text.includes(rule.from)) continue
    const count = text.split(rule.from).length - 1
    text = text.split(rule.from).join(rule.to)
    hits.push(`${rule.name} ×${count}`)
  }
  if (text !== original) {
    changes.push({ file: relative(ROOT, file), hits })
    if (!CHECK_ONLY) writeFileSync(file, text)
  }
}

/* 剩下的裸 `dsh-alert-sound`：多半是致谢 / URL / 上游引用，**只提示、不自动改**。 */
const leftovers = []
for (const file of files) {
  const text = readFileSync(file, 'utf8')
  text.split('\n').forEach((line, index) => {
    if (!line.includes('dsh-alert-sound')) return
    if (line.includes('dsh-alert-sounds')) return
    leftovers.push(`${relative(ROOT, file)}:${index + 1}: ${line.trim()}`)
  })
}

if (changes.length === 0) {
  console.log('✔ 改名已是最新，无需改动')
} else {
  for (const item of changes) console.log(`${CHECK_ONLY ? '✘ 待改' : '✔ 已改'} ${item.file} — ${item.hits.join('、')}`)
}

if (leftovers.length > 0) {
  console.log('\nℹ️ 以下位置仍出现裸 `dsh-alert-sound`，脚本**刻意没有自动改**（多半是致谢 / URL / 上游引用，请人工确认）：')
  for (const line of leftovers) console.log(`   ${line}`)
}

process.exit(CHECK_ONLY && changes.length > 0 ? 1 : 0)
