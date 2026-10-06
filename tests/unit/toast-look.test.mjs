/**
 * 自研浮条的外观测试。
 *
 * 依据 2026-10-06 用户要求：「提示条，不要用黑色，不明显，也用原来的绿色，
 * 大小先放大 5 倍……这东西要的就是一走一过，明显能看到才行」。
 * 这些是**用户可见的观感约定**，所以固化成断言：背景必须是类别原色（完成=绿色），
 * 不是深色黑卡片；尺寸必须真的放大（缩回单倍会红）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadBundle, createFakeCtx } from '../helpers/bundle.mjs'
import { createReactShim } from '../helpers/react-shim.mjs'

function storageWith(settings) {
  return { getItem: (key) => (key === 'dsh-alert-sounds.v1' ? JSON.stringify(settings) : null), setItem: () => {} }
}

/**
 * 渲染一条浮条。
 * 做法：先拿到注册进 shell.overlay 的 `<AlertToast …/>`，再用指定 kind 把它重新调用一次
 * （只替换 getCurrent / getCurrentAt），于是不需要驱动检测链路也能测到真实外观。
 */
function renderToast(kind, options = {}) {
  const { ctx, registered } = createFakeCtx({ services: {} })
  const { mod } = loadBundle({
    require: () => createReactShim(),
    localStorage: storageWith(options.settings ?? { lang: 'zh' }),
  })
  mod.apply(ctx)
  const overlay = registered['shell.overlay'][0].component()
  const element = overlay.type(Object.assign({}, overlay.props, {
    getCurrent: () => kind,
    getCurrentAt: () => Date.parse('2026-10-06T14:32:00'),
  }))
  if (element === null || element === undefined) return { element: null, mod }
  // element 是 <OwnToast/> 或 <OriginalToast/>，再往里一层才是真正的 <div style=…>
  return { element, which: element.type.name, rendered: element.type(element.props), mod }
}

/** 摊平元素树里的所有文本。 */
function texts(node, out = []) {
  if (node === null || node === undefined || node === false) return out
  if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out }
  if (Array.isArray(node)) { for (const child of node) texts(child, out); return out }
  if (node.props) texts(node.props.children, out)
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

test('自研浮条：尺寸按 OWN_TOAST_SCALE 整体放大（当前 5 倍）', () => {
  const { rendered, mod } = renderToast('done')
  const scale = mod.__test.OWN_TOAST_SCALE
  const base = mod.__test.OWN_TOAST_BASE
  assert.ok(scale >= 3, `放大倍数不该小于 3，否则「一走一过」看不见：${scale}`)
  const style = rendered.props.style
  assert.equal(style.padding, px(base.paddingY * scale) + ' ' + px(base.paddingX * scale))
  assert.equal(style.bottom, px(base.bottom * scale))
  assert.equal(style.borderRadius, px(base.radius * scale))
  // 标题与副文案
  const [titleNode, subNode] = rendered.props.children[1].props.children
  assert.equal(titleNode.props.style.fontSize, px(base.title * scale))
  assert.equal(subNode.props.style.fontSize, px(base.sub * scale))
  assert.ok(parseFloat(titleNode.props.style.fontSize) >= 42, '标题字号至少要 3 倍于原 14px')
})

test('自研浮条：放大后限宽并允许换行，窄窗口不会溢出屏幕', () => {
  const { rendered } = renderToast('done')
  const style = rendered.props.style
  assert.match(String(style.maxWidth), /100vw/)
  const [titleNode, subNode] = rendered.props.children[1].props.children
  assert.equal(titleNode.props.style.wordBreak, 'break-word')
  assert.equal(subNode.props.style.wordBreak, 'break-word')
  assert.equal(rendered.props.children[1].props.style.minWidth, 0)
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

test('自研浮条：显示「类别 + 完成时刻 + 怎么收起」，× 可点', () => {
  const { rendered } = renderToast('done')
  const joined = texts(rendered).join('')
  assert.ok(joined.includes('输出完成'), `要显示类别：${joined}`)
  assert.ok(joined.includes('14:32'), `要显示完成时刻：${joined}`)
  assert.ok(joined.includes('鼠标移动或点击收起'), `要提示怎么收起：${joined}`)
  const closeBtn = rendered.props.children[2]
  assert.equal(closeBtn.type, 'button')
  assert.equal(closeBtn.props.style.pointerEvents, 'auto', '× 必须可点（外框是 pointer-events:none）')
  assert.equal(closeBtn.props['aria-label'], '关闭提示')
})

test('原方案（上游彩条）没有被动过：仍是 14px 白字彩底、无 ×、无放大', () => {
  const { which, rendered, mod } = renderToast('done', { settings: { lang: 'zh', toastStyle: 'original' } })
  assert.equal(which, 'OriginalToast')
  const style = rendered.props.style
  assert.equal(style.background, mod.__test.TOAST_MAP.done.bg)
  assert.equal(style.fontSize, 14)
  assert.equal(style.fontWeight, 600)
  assert.equal(style.pointerEvents, 'none')
  assert.equal(style.maxWidth, undefined, '原方案不该有放大后的限宽')
  assert.equal(typeof rendered.props.children, 'string', '原方案只有一个文本子节点（没有 × 按钮）')
  assert.equal(rendered.props.children, '输出完成')
})

test('关掉「悬浮提示」就完全不渲染', () => {
  const { element } = renderToast('done', { settings: { lang: 'zh', showToast: false } })
  assert.equal(element, null)
})
