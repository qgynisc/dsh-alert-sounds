/**
 * 设置页顶部「标题 + 归属 + 项目地址」区块测试（qgynisc 所有插件的统一约定）。
 *
 * 做法：用 React 替身把注册进 settings.section 的组件**真的调用一次**，
 * 再从返回的元素树里把文字全部收集出来做断言——测的是产物里那段真实代码。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadBundle, createFakeCtx } from '../helpers/bundle.mjs'
import { createReactShim } from '../helpers/react-shim.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))

/** 假的 localStorage：让 t() 走指定语言。 */
function storageWith(settings) {
  return { getItem: (key) => (key === 'dsh-alert-sounds.v1' ? JSON.stringify(settings) : null), setItem: () => {} }
}

/** 渲染设置页组件，返回元素树。 */
function renderSettingsPage(options = {}) {
  const { ctx, registered } = createFakeCtx({ services: {} })
  const { mod } = loadBundle({
    require: () => createReactShim(),
    localStorage: storageWith(options.settings ?? { lang: 'zh' }),
  })
  mod.apply(ctx)
  const entry = registered['settings.section'][0]
  assert.ok(entry, '设置页没有注册进 settings.section')
  const wrapper = entry.component({
    getSettings: () => Object.assign({}, mod.__test.DEFAULTS, options.settings ?? {}),
    setSettings: () => {},
    subscribeSettings: () => () => {},
    play: () => {},
    requestNotify: () => {},
    uploadCustom: () => {},
  })
  // 槽里注册的是 `props => createElement(SettingsPanel, props)`，
  // 所以再往里一层才是真正的设置页元素（type 就是 SettingsPanel）。
  return typeof wrapper.type === 'function' ? wrapper.type(wrapper.props) : wrapper
}

/** 把元素树里所有文本摊平成一个字符串。 */
function texts(node, out = []) {
  if (node === null || node === undefined || node === false) return out
  if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out }
  if (Array.isArray(node)) { for (const child of node) texts(child, out); return out }
  if (node.props) texts(node.props.children, out)
  return out
}

/** 取出元素树里所有 <a> 的 href。 */
function hrefs(node, out = []) {
  if (!node || typeof node !== 'object') return out
  if (Array.isArray(node)) { for (const child of node) hrefs(child, out); return out }
  if (node.type === 'a' && node.props && node.props.href) out.push(node.props.href)
  if (node.props) hrefs(node.props.children, out)
  return out
}

test('设置页最上方是「标题 + 归属 + 项目地址」区块', () => {
  const page = renderSettingsPage()
  const first = page.props.children[0]
  assert.ok(first && first.props && first.props.style, '第一个子节点应当是顶部区块')
  const lines = texts(first)
  const joined = lines.join('')

  // 第 1 行：标题
  assert.match(joined, /提醒音设置/, `第一行应是设置页标题，实际：${joined}`)
  // 第 2 行：本项目由插件 <包名> 实现 · 版本 <版本>
  assert.ok(joined.includes('本项目由插件'), '缺少「本项目由插件」归属行')
  assert.ok(joined.includes(manifest.name), `归属行要写出包名 ${manifest.name}`)
  assert.ok(joined.includes('实现'), '缺少「实现」')
  assert.ok(joined.includes('版本'), '缺少「版本」')
  assert.ok(joined.includes(manifest.version), `归属行要写出当前版本 ${manifest.version}`)
  // 第 3 行：项目地址
  assert.ok(joined.includes('项目地址'), '缺少「项目地址」行')
  assert.ok(joined.includes('https://github.com/qgynisc/dsh-alert-sounds'), '项目地址要指向本仓库')
  // 附加：fork 归属（MIT 要求保留上游署名）
  assert.ok(joined.includes('fork 自'), 'fork 项目要写明上游')
  assert.ok(joined.includes('Machine-126/dsh-alert-sound'), '要写出上游仓库')
})

test('区块里的链接都可点，且指向正确的地方', () => {
  const page = renderSettingsPage()
  const head = page.props.children[0]
  const urls = hrefs(head)
  assert.ok(urls.includes('https://github.com/qgynisc/dsh-alert-sounds'), `缺少仓库链接：${urls.join(', ')}`)
  assert.ok(urls.includes('https://www.npmjs.com/package/@qgynisc/dsh-alert-sounds'), `缺少 npm 链接：${urls.join(', ')}`)
  assert.ok(urls.includes('https://github.com/Machine-126/dsh-alert-sound'), `缺少上游链接：${urls.join(', ')}`)
})

test('英文界面下同一区块用的是英文字案', () => {
  const page = renderSettingsPage({ settings: { lang: 'en' } })
  const joined = texts(page.props.children[0]).join('')
  assert.ok(joined.includes('Implemented by the plugin'), `英文归属行缺失：${joined}`)
  assert.ok(joined.includes('Repository'), `英文项目地址行缺失：${joined}`)
  assert.ok(joined.includes('Forked from'), `英文 fork 行缺失：${joined}`)
  assert.ok(joined.includes(manifest.version))
})

test('顶部区块是设置页的第一个元素（在语言、音量等所有设置项之前）', () => {
  const page = renderSettingsPage()
  const children = page.props.children
  const head = children[0]
  const headText = texts(head).join('')
  // 第二行起才是设置项（语言选择）
  const rest = texts({ props: { children: children.slice(1) } }).join('')
  assert.ok(headText.includes('本项目由插件'), '第 0 个子节点必须是归属区块')
  assert.ok(!rest.includes('本项目由插件'), '归属区块不该在别处重复出现')
  assert.ok(rest.includes('界面语言'), '设置项应排在归属区块之后')
})

test('归属区块的版本号跟着 package.json 走（不会写死）', () => {
  const page = renderSettingsPage()
  const joined = texts(page.props.children[0]).join('')
  const match = /版本\s*([0-9]+\.[0-9]+\.[0-9]+)/.exec(joined)
  assert.ok(match, `没找到版本号：${joined}`)
  assert.equal(match[1], manifest.version)
})
