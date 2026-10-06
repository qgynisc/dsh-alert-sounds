/**
 * 一次跑完本仓库的两层验证：
 *   1. 构建（scripts/build.mjs）→ 单测（node --test tests/unit）—— 测的是 lib/ 里的**构建产物**；
 *   2. 安装自检（scripts/verify-install.mjs --simulate）—— 临时假 profile 走一遍加载器解析链。
 *
 * 用法：
 *   node tests/run-all.mjs          # 两层都跑（本地一条命令）
 *   node tests/run-all.mjs --unit   # 只跑构建 + 单测（CI 里由 npm run test:ci 分步调用）
 */
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const UNIT_ONLY = process.argv.includes('--unit')
const run = (args) => spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit' })

/* 自己枚举测试文件，不依赖 shell 展开 glob：
 * `node --test <目录>` 在 Node 20/24 上行为不一致，显式列文件最稳。 */
const UNIT_DIR = join(ROOT, 'tests', 'unit')
const unitFiles = readdirSync(UNIT_DIR)
  .filter((name) => name.endsWith('.test.mjs'))
  .sort()
  .map((name) => join(UNIT_DIR, name))
if (unitFiles.length === 0) {
  console.error('✘ tests/unit 下一个测试文件都没有')
  process.exit(1)
}

console.log('== 1/2 构建 ==')
const build = run(['scripts/build.mjs'])
if (build.status !== 0) process.exit(build.status ?? 1)

console.log(`\n== 2/2 单测（${unitFiles.length} 个文件） ==`)
const unit = run(['--test', ...unitFiles])
if (unit.status !== 0) {
  console.error('\n✘ 单测未通过')
  process.exit(unit.status ?? 1)
}

if (UNIT_ONLY) {
  console.log('\n✔ 构建 + 单测通过（--unit：跳过安装自检）')
  process.exit(0)
}

console.log('\n== 附加：安装自检（临时假 profile） ==')
const verify = run(['scripts/verify-install.mjs', '--simulate'])
if (verify.status !== 0) {
  console.error('\n✘ 安装自检未通过')
  process.exit(verify.status ?? 1)
}

console.log('\n✔ 全部通过')
