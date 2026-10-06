/**
 * 自研浮条的外观测试。
 *
 * 依据 2026-10-06 用户要求（原话）：
 *   「不要用黑色，不明显，也用原来的绿色，大小先放大 5 倍……这东西要的就是一走一过，
 *     明显能看到才行」；以及「提示只保留文字，左面的点，右面的 X 都不用」。
 * 这些是**用户可见的观感约定**，所以固化成断言：底色必须是类别原色（完成=绿色）且够亮、
 * 尺寸真的放大、只留文字（无圆点无 ×）、设置页里的静态预览与真身共用同一套样式。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadBundle, createFakeCtx } from '../helpers/bundle.mjs'
import { createReactShim } from '../helpers/react-shim.mjs'

function storageWith(settings) {
  return { getItem: (key) => (key === 'dsh-alert-sounds.v1' ? JSON.stringify(settings) : null), setItem: () => {} }
}

function makeMod(settings) {
  const { ctx, registered } = createFakeCtx({ services: {} })
  const loaded = loadBundle({ require: () => createReactShim(), localStorage: storageWith(settings) })
  loaded.mod.apply(ctx)
  return { ...loaded, registered }
}

/**
 * 渲染一条真身浮条。
 * 做法：先拿到注册进 shell.overlay 的 `<AlertToast …/>`，再指定 kind 重新调用一次
 * （只替换 getCurrent / getCurrentAt），于是不需要驱动检测链路也能测到真实外观。
 */
function renderToast(kind, options = {}) {
  const { registered, mod } = makeMod(options.settings ?? { lang: 'zh' })
  const overlay = registered['shell.overlay'][0].component()
  const element = overlay.type(Object.assign({}, overlay.props, {
    getCurrent: () => kind,
    getCurrentAt: () => Date.parse('2026-10-06T14:32:00'),
  }))
  if (element === null || element === undefined) return { element: null, mod }
  // element 是 <OwnToast/> 或 <OriginalToast/>，再往里一层才是真正的 <div style=…>
  return { element, which: element.type.name, rendered: element.type(element.props), mod }
}

/** 渲染设置页（返回页面元素树 + 读当前浮条状态的方法）。 */
function renderPage(options = {}) {
  const { registered, mod } = makeMod(options.settings ?? { lang: 'zh' })
  const wrapper = registered['settings.section'][0].component({
    getSettings: () => Object.assign({}, mod.__test.DEFAULTS, options.settings ?? {}),
    setSettings: () => {},
    subscribeSettings: () => () => {},
    play: () => {},
    requestNotify: () => {},
    uploadCustom: () => {},
  })
  return {
    page: wrapper.type(wrapper.props),
    mod,
    // 浮条状态从 overlay 槽读：设置页的「预览」按钮点下去必须真的走同一个 store
    getCurrent: () => registered['shell.overlay'][0].component().props.getCurrent(),
  }
}

/** 摊平元素树里的所有文本。 */
function texts(node, out = []) {
  if (node === null || node === undefined || node === false) return out
  if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out }
  if (Array.isArray(node)) { for (const child of node) texts(child, out); return out }
  if (node.props) texts(node.props.children, out)
  return out
}

/** 收集元素树里所有符合条件的元素。 */
function collect(node, match, out = []) {
  if (!node || typeof node !== 'object') return out
  if (Array.isArray(node)) { for (const child of node) collect(child, match, out); return out }
  if (match(node)) { out.push(node); return out }
  if (node.props) collect(node.props.children, match, out)
  return out
}

const px = (value) => Math.round(value) + 'px'

/** 感知亮度（0-255）：用来判断底色是不是「太暗，瞥一眼看不到」。 */
function luminance(color) {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(color))
  if (!match) return 0
  const [r, g, b] = match.slice(1).map((part) => parseInt(part, 16))
  return 0.299 * r + 0.587 * g + 0.114 * b
}

test('自研浮条：背景是类别原色，不再用黑色卡片（完成=原来的绿色）', () => {
  const { rendered, mod } = renderToast('done')
  const bg = rendered.props.style.background
  assert.equal(bg, mod.__test.TOAST_MAP.done.bg)
  assert.equal(bg, '#16a34a', '完成必须是上游那套绿色')
  assert.ok(!/rgba\(\s*24\s*,\s*24\s*,\s*27/.test(String(bg)), `不能再是深色黑卡片：${bg}`)
  assert.ok(luminance(bg) > 60, `背景太暗，瞥一眼看不到（亮度 ${luminance(bg)}）：${bg}`)
})

test('自研浮条：每类提醒用自己那套原色', () => {
  const { mod } = renderToast('done')
  const map = mod.__test.TOAST_MAP
  for (const kind of ['approval', 'question', 'done', 'failed', 'stalled']) {
    const { rendered } = renderToast(kind)
    assert.equal(rendered.props.style.background, map[kind].bg, `${kind} 的底色应为 ${map[kind].bg}`)
  }
})

test('自研浮条：只保留文字——没有左侧圆点、没有右侧 ×', () => {
  const { rendered } = renderToast('done')
  const children = rendered.props.children
  assert.ok(Array.isArray(children), '应当是 [标题, 副文案] 两个文本节点')
  assert.equal(children.length, 2, `只该有两个文本子节点，实际 ${children.length}`)
  assert.equal(children[0].type, 'span')
  assert.equal(children[1].type, 'span')
  assert.equal(children[0].props.children, '输出完成')
  assert.equal(collect(rendered, (node) => node.type === 'button').length, 0, '不该有 button（× 已去掉）')
  assert.ok(!texts(rendered).join('').includes('×'), '文字里也不该出现 ×')
  // 文字居中：卡片是列方向的居中排版
  assert.equal(rendered.props.style.textAlign, 'center')
  assert.equal(rendered.props.style.flexDirection, 'column')
})

test('自研浮条：尺寸按 OWN_TOAST_SCALE 整体放大（当前 5 倍）', () => {
  const { rendered, mod } = renderToast('done')
  const scale = mod.__test.OWN_TOAST_SCALE
  const base = mod.__test.OWN_TOAST_BASE
  assert.ok(scale >= 3, `放大倍数不该小于 3，否则「一走一过」看不见：${scale}`)
  const style = rendered.props.style
  assert.equal(style.padding, px(base.paddingY * scale) + ' ' + px(base.paddingX * scale))
  assert.equal(style.bottom, px(base.bottom * scale))
  assert.equal(style.borderRadius, px(base.radius * scale))
  assert.equal(rendered.props.children[0].props.style.fontSize, px(base.title * scale))
  assert.equal(rendered.props.children[1].props.style.fontSize, px(base.sub * scale))
  assert.ok(parseFloat(rendered.props.children[0].props.style.fontSize) >= 42, '标题字号至少要 3 倍于原 14px')
})

test('自研浮条：大小在设置里可调（默认 5 倍，1–10 倍夹紧）', () => {
  const base = renderToast('done').mod.__test.OWN_TOAST_BASE

  const two = renderToast('done', { settings: { lang: 'zh', toastScale: 2 } })
  assert.equal(two.rendered.props.style.bottom, px(base.bottom * 2), '设成 2× 就按 2× 渲染')

  const tiny = renderToast('done', { settings: { lang: 'zh', toastScale: 0.2 } })
  assert.equal(tiny.rendered.props.style.bottom, px(base.bottom * 1), '低于 1 倍的夹到 1 倍')

  const huge = renderToast('done', { settings: { lang: 'zh', toastScale: 99 } })
  assert.equal(huge.rendered.props.style.bottom, px(base.bottom * 10), '高于 10 倍的夹到 10 倍（别把屏幕吃光）')

  const junk = renderToast('done', { settings: { lang: 'zh', toastScale: 'abc' } })
  const fallback = renderToast('done').mod.__test.OWN_TOAST_SCALE
  assert.equal(junk.rendered.props.style.bottom, px(base.bottom * fallback), '非法值回默认倍数')

  assert.deepEqual([...renderToast('done').mod.__test.TOAST_SCALES], [1, 2, 3, 4, 5, 6, 8])
  assert.equal(two.rendered.props.style.background, '#16a34a', '调大小不该影响底色')
})

test('自研浮条：放大后限宽并允许换行，窄窗口不会溢出屏幕', () => {
  const { rendered } = renderToast('done')
  const style = rendered.props.style
  assert.match(String(style.maxWidth), /100vw/)
  assert.equal(style.wordBreak, 'break-word')
  assert.equal(style.boxSizing, 'border-box')
})

test('自研浮条：显示「类别 + 完成时刻 + 怎么收起」', () => {
  const { rendered } = renderToast('done')
  const joined = texts(rendered).join('')
  assert.ok(joined.includes('输出完成'), `要显示类别：${joined}`)
  assert.ok(joined.includes('14:32'), `要显示完成时刻：${joined}`)
  assert.ok(joined.includes('鼠标移动或点击收起'), `要提示怎么收起：${joined}`)
})

test('设置页：五类提醒都有静态预览，且与真身共用同一套样式（inline 模式）', () => {
  const { page, mod } = renderPage()
  const inlineElements = collect(page, (node) => node.props && node.props.inline === true)
  assert.equal(inlineElements.length, 5, `五类提醒各一条静态预览，实际 ${inlineElements.length}`)
  const kinds = inlineElements.map((element) => element.props.kind)
  assert.deepEqual(kinds, [...mod.__test.KINDS])

  for (const element of inlineElements) {
    const card = element.type(element.props)
    const style = card.props.style
    assert.equal(style.position, 'static', '预览要参与页面排版，不能 fixed 悬浮')
    assert.equal(style.width, '100%')
    assert.equal(style.background, mod.__test.TOAST_MAP[element.props.kind].bg, `${element.props.kind} 预览要用同一底色`)
    assert.equal(style.fontSize, undefined, '字号在子节点上，卡片本身不设')
    assert.equal(card.props.children[0].props.style.fontSize, '14px', '预览固定按 1 倍渲染')
    assert.equal(collect(card, (node) => node.type === 'button').length, 0, '预览里同样不该有 ×')
  }
})

test('设置页：每类的「预览」按钮真的会弹一条该类的浮条（同一个 store）', () => {
  const { page, getCurrent, mod } = renderPage()
  const buttons = collect(page, (node) => node.type === 'button' && node.props.children === '预览')
  assert.equal(buttons.length, mod.__test.KINDS.length, '每一类都该有一个「预览」按钮')
  buttons[0].props.onClick()
  assert.equal(getCurrent(), 'approval', '点第一类（审批）的预览就该弹 approval')
  buttons[2].props.onClick()
  assert.equal(getCurrent(), 'done', '点第三类（完成）的预览就该弹 done')
})

test('原方案（上游彩条）没有被动过：仍是 14px 白字彩底、无按钮、无放大', () => {
  const { which, rendered, mod } = renderToast('done', { settings: { lang: 'zh', toastStyle: 'original' } })
  assert.equal(which, 'OriginalToast')
  const style = rendered.props.style
  assert.equal(style.background, mod.__test.TOAST_MAP.done.bg)
  assert.equal(style.fontSize, 14)
  assert.equal(style.fontWeight, 600)
  assert.equal(style.pointerEvents, 'none')
  assert.equal(style.maxWidth, undefined, '原方案不该有放大后的限宽')
  assert.equal(typeof rendered.props.children, 'string', '原方案只有一个文本子节点')
  assert.equal(rendered.props.children, '输出完成')
})

test('关掉「悬浮提示」就完全不渲染', () => {
  const { element } = renderToast('done', { settings: { lang: 'zh', showToast: false } })
  assert.equal(element, null)
})

test('预览能穿透「悬浮提示」总开关：关掉总开关后点预览仍然看得到', () => {
  const { registered, mod } = makeMod({ lang: 'zh', showToast: false })
  const overlay = registered['shell.overlay'][0].component()
  const AlertToast = overlay.type

  const previewElement = AlertToast(Object.assign({}, overlay.props, {
    getCurrent: () => 'done',
    getCurrentAt: () => Date.parse('2026-10-06T14:32:00'),
    isPreview: () => true,
  }))
  assert.ok(previewElement, '预览时即使总开关关着也必须渲染（否则点预览像坏了）')
  assert.equal(previewElement.type(previewElement.props).props.style.background, mod.__test.TOAST_MAP.done.bg)

  const normalElement = AlertToast(Object.assign({}, overlay.props, {
    getCurrent: () => 'done',
    getCurrentAt: () => 0,
    isPreview: () => false,
  }))
  assert.equal(normalElement, null, '普通提醒在总开关关着时仍不该出现')
})

test('自动预览：改「提示大小」会立刻弹一条真身（直接看到新尺寸）', () => {
  const { page, getCurrent } = renderPage({ settings: { lang: 'zh' } })
  const scaleSelects = collect(page, (node) => node.type === 'select'
    && Array.isArray(node.props.children)
    && node.props.children.some((option) => option && option.props && option.props.children === '8×'))
  assert.equal(scaleSelects.length, 1, '应当只有一个「提示大小」下拉')
  scaleSelects[0].props.onChange({ target: { value: '8' } })
  assert.equal(getCurrent(), 'done', '改大小后应立刻弹一条真身')
})

test('浮条必须 portal 到 <body>：否则会被设置弹窗盖住（shell.overlay 容器只到 z-index 20）', () => {
  const fakeBody = { tag: 'body' }
  const shim = createReactShim()
  const { ctx, registered } = createFakeCtx({ services: {} })
  const loaded = loadBundle({
    require: () => shim,
    document: { body: fakeBody },
    localStorage: storageWith({ lang: 'zh' }),
  })
  loaded.mod.apply(ctx)
  const overlay = registered['shell.overlay'][0].component()
  const element = overlay.type(Object.assign({}, overlay.props, {
    getCurrent: () => 'done',
    getCurrentAt: () => Date.parse('2026-10-06T14:32:00'),
    isPreview: () => true,
  }))
  assert.ok(element, '应当渲染出浮条')
  assert.equal(shim.__portals.length, 1, '浮条必须 portal 一次')
  assert.equal(shim.__portals[0], fakeBody, 'portal 目标必须是 document.body')
  // element 是 <OwnToast/>（createPortal 替身原样返回），再往里一层才是 <div style=…>
  const card = element.type(element.props)
  assert.equal(card.props.style.zIndex, 2147483647, 'z-index 要拉到 int32 上限')
  assert.equal(card.props.style.position, 'fixed')
})

test('拿不到 react-dom 时退回槽内渲染：功能不丢（只是可能被弹窗压住）', () => {
  const { rendered } = renderToast('done') // 缺省 require 会抛错 → 没有 reactDom
  assert.ok(rendered && rendered.props && rendered.props.style, '没有 react-dom 也要正常渲染')
  assert.equal(rendered.props.style.zIndex, 2147483647)
})

test('设置页「弹一条看大小」按钮是两行三字（不被挤成难看的断行）', () => {
  const { page } = renderPage()
  const buttons = collect(page, (node) => node.type === 'button'
    && node.props.children && node.props.children[0]
    && node.props.children[0].props && node.props.children[0].props.children === '弹一条')
  assert.equal(buttons.length, 1, '应当只有一个「弹一条 / 看大小」按钮')
  const lines = buttons[0].props.children.map((span) => span.props.children)
  assert.deepEqual(lines, ['弹一条', '看大小'], '两行，各三个字')
  for (const span of buttons[0].props.children) {
    assert.equal(span.props.style.display, 'block', '两行要各自成行')
  }
  assert.equal(buttons[0].props.style.whiteSpace, 'nowrap', '不许被挤断行')
})
