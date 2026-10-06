/**
 * 安装自检：从 profile 目录出发，把 dsh-client-modules 的解析链**原样走一遍**，
 * 在重启应用之前就能发现「装了但加载器找不到 / 注册 ID 对不上」这类问题。
 *
 * 校验项：
 *   1. profile 的 node_modules 能按包名解析到 package.json；
 *   2. dsh.client 声明存在且 platform === 'web'；dsh.bundle.patch 指向真实文件；
 *   3. exports["./client"] 指向的文件真的存在；
 *   4. bundle 里注册的 id === 包名（不等就是 "loaded without registering"）；
 *   5. bundle 能以 window.__ModuleLoader__ 形态求值，**拿不到 react 也能**导出 apply / inject；
 *   6. cordis.patch.yml 的 insert 行 name === 包名（行 id 故意不同，便于识别）；
 *   7. profile 的 dsh.profile.bundles 里包含本包。
 *
 * 用法：
 *   node scripts/verify-install.mjs [--profile desktop]   # 检查本机真 profile
 *   node scripts/verify-install.mjs --simulate            # 建一个临时假 profile 再检查
 */
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const ROOT = resolve(join(dirname(fileURLToPath(import.meta.url)), '..'))
const OWN_MANIFEST = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const PACKAGE_NAME = OWN_MANIFEST.name

const args = process.argv.slice(2)
const profileIndex = args.indexOf('--profile')
const PROFILE = profileIndex >= 0 ? args[profileIndex + 1] : 'desktop'
const SIMULATE = args.includes('--simulate')
const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')

/** 临时假 profile 的根（--simulate 时才有值，结束时删掉）。 */
let simulatedHome
let PROFILE_DIR = join(DSH_HOME, 'profiles', PROFILE)
let PROFILE_MANIFEST = join(PROFILE_DIR, 'package.json')

if (SIMULATE) {
  simulatedHome = mkdtempSync(join(tmpdir(), 'dsh-alert-sounds-profile-'))
  PROFILE_DIR = join(simulatedHome, 'profiles', 'simulated')
  PROFILE_MANIFEST = join(PROFILE_DIR, 'package.json')
  mkdirSync(join(PROFILE_DIR, 'node_modules'), { recursive: true })
  writeFileSync(
    PROFILE_MANIFEST,
    `${JSON.stringify(
      {
        name: 'dsh-profile-simulated',
        private: true,
        dsh: { profile: { bundles: [PACKAGE_NAME] } },
        dependencies: { [PACKAGE_NAME]: `link:${ROOT}` },
      },
      null,
      2,
    )}\n`,
  )
  const linkPath = join(PROFILE_DIR, 'node_modules', PACKAGE_NAME)
  // scoped 包名（@scope/name）的软链目标需要中间目录 @scope/，symlinkSync 不会自动创建
  mkdirSync(dirname(linkPath), { recursive: true })
  symlinkSync(ROOT, linkPath, 'dir')
  console.log(`（--simulate）临时 profile：${PROFILE_DIR}\n`)
}

const checks = []
const check = (name, ok, detail) => checks.push({ name, ok: ok === true, detail: detail === undefined ? '' : String(detail) })

/** 结束前清理临时 profile。 */
const cleanup = () => {
  if (simulatedHome === undefined) return
  try {
    rmSync(simulatedHome, { recursive: true, force: true })
  } catch (error) {
    /* 清不掉不影响结论 */
  }
}

if (!existsSync(PROFILE_MANIFEST)) {
  console.error(`✘ 找不到 profile 清单：${PROFILE_MANIFEST}`)
  console.error('  想在干净机器 / CI 上自检，加 --simulate（会临时造一个假 profile）')
  cleanup()
  process.exit(1)
}

/* 1) 按包名解析 */
const require = createRequire(PROFILE_MANIFEST)
let packageJsonPath
try {
  packageJsonPath = require.resolve(`${PACKAGE_NAME}/package.json`)
} catch (error) {
  packageJsonPath = undefined
}
check(`profile 能解析 ${PACKAGE_NAME}/package.json`, packageJsonPath !== undefined, packageJsonPath ?? '解析失败')

const installed = packageJsonPath === undefined ? undefined : JSON.parse(readFileSync(packageJsonPath, 'utf8'))
const packageRoot = packageJsonPath === undefined ? undefined : dirname(packageJsonPath)

/* 2) dsh.client / dsh.bundle 声明 */
check('package.json 带 dsh.client 声明', installed?.dsh?.client !== undefined)
check("dsh.client.platform === 'web'", installed?.dsh?.client?.platform === 'web', installed?.dsh?.client?.platform)
const bundlePatch = installed?.dsh?.bundle?.patch
check('package.json 带 dsh.bundle.patch 声明', typeof bundlePatch === 'string', bundlePatch ?? '缺少 dsh.bundle → 加载器会 "declares no dsh.bundle" 跳过整包')
const bundlePatchPath = packageRoot !== undefined && typeof bundlePatch === 'string' ? join(packageRoot, bundlePatch) : undefined
check('dsh.bundle.patch 指向真实文件', bundlePatchPath !== undefined && existsSync(bundlePatchPath), bundlePatchPath ?? '')

/* 2b) 版本兼容闸门：只有 @deepseek-ai/dsh* 的 peer 会被卡（cordis 不算） */
const dshPeers = Object.keys(installed?.peerDependencies ?? {}).filter((name) => name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-'))
check('peerDependencies 里没有会被兼容闸门拦下的 @deepseek-ai/dsh* 项', dshPeers.length === 0, dshPeers.length === 0 ? '无' : JSON.stringify(dshPeers))

/* 2c) 包名必须与 loader id 一致 */
check('package.json 的 name 是本仓库的包名', installed?.name === PACKAGE_NAME, installed?.name)

/* 3) exports["./client"] 指向的文件存在 */
const clientExport = installed?.exports?.['./client']
const clientRelative = typeof clientExport === 'string' ? clientExport : clientExport?.default
const clientPath = packageRoot !== undefined && typeof clientRelative === 'string' ? join(packageRoot, clientRelative) : undefined
check('exports["./client"] 指向真实文件', clientPath !== undefined && existsSync(clientPath), clientPath ?? '缺少 exports["./client"]')

/* 4)(5) bundle 形态：注意这里**故意让 require('react') 失败**，验证设置页缺失时插件照常加载 */
if (clientPath !== undefined && existsSync(clientPath)) {
  const code = readFileSync(clientPath, 'utf8')
  let loaded
  const sandbox = {
    console,
    URL,
    File,
    Blob,
    setTimeout,
    clearTimeout,
    Date,
    Math,
    JSON,
    window: { __ModuleLoader__: { load: (mod) => (loaded = mod) } },
  }
  try {
    vm.createContext(sandbox)
    vm.runInContext(code, sandbox, { filename: clientPath })
  } catch (error) {
    check('bundle 可求值', false, error.message)
  }
  check('bundle 调用了 window.__ModuleLoader__.load', loaded !== undefined)
  check('bundle 注册 id === 包名', loaded?.id === PACKAGE_NAME, `${loaded?.id} vs ${PACKAGE_NAME}`)
  let mod
  try {
    mod = loaded?.factory(() => {
      throw new Error('本环境不提供 react')
    })
  } catch (error) {
    check('bundle factory 在拿不到 react 时可执行', false, error.message)
  }
  check('bundle 导出 apply()', typeof mod?.apply === 'function')
  check('bundle 导出 inject 服务列表', Array.isArray(mod?.inject) && mod.inject.length > 0, JSON.stringify(mod?.inject))
  check('bundle 仍暴露 __test（单测入口）', typeof mod?.__test?.createToastStore === 'function')
  check('插件默认用自研常驻条', mod?.__test?.DEFAULTS?.toastStyle === 'own', mod?.__test?.DEFAULTS?.toastStyle)
}

/* 6) cordis.patch.yml 的行 */
const patchPath = join(ROOT, 'cordis.patch.yml')
const patch = existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : ''
const patchName = /-\s*insert:\s*\n\s*-\s*id:\s*(\S+)\s*\n\s*name:\s*'?([^'\n]+)'?/.exec(patch)
check('cordis.patch.yml 有 insert 行且 name === 包名', patchName?.[2]?.trim() === PACKAGE_NAME, patchName === null ? '没匹配到 insert 行' : `id=${patchName[1]} name=${patchName[2].trim()}`)
check('cordis.patch.yml 行 id 与包名不同（避免插件卡片重复显示）', patchName !== null && patchName[1] !== PACKAGE_NAME, patchName?.[1])

/* 7) profile bundles 列表 */
const profileManifest = JSON.parse(readFileSync(PROFILE_MANIFEST, 'utf8'))
const bundles = profileManifest?.dsh?.profile?.bundles ?? []
check(`profile bundles 含 ${PACKAGE_NAME}`, bundles.includes(PACKAGE_NAME))

/* 8) 上游插件若还装着，两个都注册同一批 slot/存储键会打架 —— 这里只提示 */
const LEGACY = '@machine-126/dsh-alert-sound'
if (bundles.includes(LEGACY) || Object.hasOwn(profileManifest?.dependencies ?? {}, LEGACY)) {
  check(`profile 里已无上游插件 ${LEGACY}（两个同时装会双响）`, false, '仍有，建议卸载')
} else {
  check(`profile 里已无上游插件 ${LEGACY}`, true)
}

let failed = 0
for (const item of checks) {
  if (!item.ok) failed += 1
  console.log(`${item.ok ? '✔' : '✘'} ${item.name}${item.detail ? ` — ${item.detail}` : ''}`)
}
console.log(`\n安装自检：${checks.length - failed}/${checks.length} 通过（profile=${SIMULATE ? 'simulated(临时)' : PROFILE}）`)
cleanup()
process.exit(failed === 0 ? 0 : 1)
