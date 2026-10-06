/**
 * 构建产物形态测试：测的是 lib/client.js 本体（DSH 真正加载的东西），不是 src/。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadBundle } from '../helpers/bundle.mjs'
import { createReactShim } from '../helpers/react-shim.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const bundleCode = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8')
const hostCode = readFileSync(join(ROOT, 'lib', 'index.js'), 'utf8')
const patch = readFileSync(join(ROOT, 'cordis.patch.yml'), 'utf8')
const gitignore = readFileSync(join(ROOT, '.gitignore'), 'utf8')

test('bundle 注册的 loader id 等于包名', () => {
  const { id } = loadBundle()
  assert.equal(id, manifest.name)
  assert.equal(id, '@qgynisc/dsh-alert-sounds')
})

test('拿不到 react 时 factory 仍能执行，并导出 apply / inject / name', () => {
  const { mod } = loadBundle() // 缺省 require 会抛错，模拟平台不提供 react
  assert.equal(typeof mod.apply, 'function')
  // 注意：数组来自 vm 沙箱，原型与宿主 realm 不同，必须先展开再比较
  assert.deepEqual([...mod.inject], ['timer'])
  // 客户端半边导出的 name 就是包名（与 loader id 一致；宿主半边那份是短名，沿用上游习惯）
  assert.equal(mod.name, manifest.name)
})

test('提供 react 时仍走同一条路径（不会因为可选装饰而变形）', () => {
  const { mod } = loadBundle({ require: () => createReactShim() })
  assert.equal(typeof mod.apply, 'function')
  assert.equal(typeof mod.__test.createToastStore, 'function')
})

test('__test 暴露单测入口', () => {
  const { mod } = loadBundle()
  for (const key of ['DEFAULTS', 'DEFAULT_TYPES', 'I18N', 'KINDS', 'SOUND_IDS', 'createToastStore', 'deepMerge', 'pickLang', 'toastModeFor', 'movedEnough', 'clip']) {
    assert.ok(mod.__test[key] !== undefined, `__test.${key} 缺失`)
  }
})

test('默认设置：悬浮提示开、浮条默认自研常驻条', () => {
  const { mod } = loadBundle()
  assert.equal(mod.__test.DEFAULTS.showToast, true)
  assert.equal(mod.__test.DEFAULTS.toastStyle, 'own')
})

test('localStorage 键与上游刻意不同（两个插件共存时互不污染）', () => {
  const { mod } = loadBundle()
  assert.equal(mod.__test.STORE_KEY, 'dsh-alert-sounds.v1')
  assert.equal(mod.__test.CUSTOM_KEY, 'dsh-alert-sounds.custom.v1')
})

test('产物里没有上游标识符字面量（loader id / 存储键 / 包名）', () => {
  for (const needle of ['"@machine-126/dsh-alert-sound"', "'@machine-126/dsh-alert-sound'", '"dsh-alert-sound.v1"', "'dsh-alert-sound.v1'", '"dsh-alert-sound.custom.v1"']) {
    assert.ok(!bundleCode.includes(needle), `产物里残留 ${needle}`)
  }
})

test('只解析 react 一个平台模块', () => {
  assert.equal(bundleCode.split('require("react")').length - 1, 1, '应当只有一处 require("react")')
  assert.ok(bundleCode.includes('} catch (e) { react = null; }'), 'react 必须是可失败获取（可选装饰）')
})

test('版本号按 package.json 注入', () => {
  assert.ok(bundleCode.includes(`const VERSION = ${JSON.stringify(manifest.version)}`))
  assert.ok(bundleCode.includes(`const name = ${JSON.stringify(manifest.name)}`))
})

test('宿主半边是可加载的 ESM 占位（与 client 同名、无副作用）', () => {
  assert.ok(hostCode.includes(`export const name = 'dsh-alert-sounds'`))
  assert.ok(hostCode.includes('export function apply()'))
  assert.ok(!hostCode.includes('export const inject'), '宿主不该声明服务依赖（与上游一致，避免多一个未经实测的耦合）')
})

test('cordis.patch.yml：行 id 与包名不同，name 等于包名', () => {
  const match = /-\s*insert:\s*\n\s*-\s*id:\s*(\S+)\s*\n\s*name:\s*'?([^'\n]+)'?/.exec(patch)
  assert.ok(match, 'cordis.patch.yml 里没有 insert 行')
  assert.equal(match[2].trim(), manifest.name)
  assert.notEqual(match[1], manifest.name)
})

test('package.json 声明齐备（DSH 加载器需要的每一项）', () => {
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(manifest.dsh.client.platform, 'web')
  assert.equal(manifest.main, 'lib/index.js')
  assert.equal(manifest.exports['./client'], './lib/client.js')
  assert.equal(manifest.publishConfig.access, 'public')
  assert.equal(manifest.type, 'module')
  for (const required of ['lib', 'cordis.patch.yml', 'README.md', 'LICENSE']) {
    assert.ok(manifest.files.includes(required), `files 里缺 ${required}`)
  }
  assert.ok(!String(manifest.repository.url).includes('Machine-126'), '仓库地址不该指向上游')
})

test('.gitignore 不能忽略 lib/（git 安装时不会跑构建，必须直接可加载）', () => {
  const lines = gitignore.split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('#'))
  assert.ok(!lines.includes('lib/'), '.gitignore 忽略了 lib/，git 安装会缺产物')
  assert.ok(!lines.includes('lib'), '.gitignore 忽略了 lib，git 安装会缺产物')
})
