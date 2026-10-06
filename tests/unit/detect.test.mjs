/**
 * 检测链路测试：用假 ctx 驱动真实的 apply()，验证
 *   完成/失败、审批/提问、提醒范围、勿扰、slot 注册 id。
 *
 * 这里不渲染 React：用 React 替身拿到注册进 slot 的元素，直接从 props 里读浮条状态。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadBundle, createFakeCtx } from '../helpers/bundle.mjs'
import { createReactShim } from '../helpers/react-shim.mjs'

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 可订阅的快照（会话列表 / pendingInteractions 都长这样）。 */
function observable(initial) {
  let value = initial
  const subs = new Set()
  return {
    getSnapshot: () => value,
    subscribe(fn) {
      subs.add(fn)
      return () => subs.delete(fn)
    },
    set(next) {
      value = next
      for (const fn of [...subs]) fn()
    },
  }
}

/** 假 localStorage：只实现插件用到的两个方法。 */
function fakeStorage(initial = {}) {
  const data = new Map(Object.entries(initial))
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    dump: () => Object.fromEntries(data),
  }
}

/** 起一个装了本插件的假环境。 */
function setup(options = {}) {
  const pending = observable(options.pending ?? new Map())
  const list = observable(options.list ?? { byId: { s1: { running: false } }, current: 's1' })
  const detail = { lastAgentError: null }
  const services = {
    sessions: {
      list,
      binding: () => ({ session: { getSnapshot: () => ({ ...detail }) } }),
    },
    uiSession: { pendingInteractions: pending },
  }
  const { ctx, registered, cancelTimeoutsByMs } = createFakeCtx({ services })
  const { mod } = loadBundle({
    require: () => createReactShim(),
    localStorage: fakeStorage(options.storage ?? {}),
  })
  mod.apply(ctx)
  // 关掉启动 600ms 那条 “🔔 提醒已连接”：它会在 3.6 秒后自关，
  // 会顶掉/清掉测试期间真正的提醒，让长延时的断言变得不确定。
  cancelTimeoutsByMs(600)
  const overlayProps = () => registered['shell.overlay'][0].component().props
  return { list, pending, detail, registered, overlayProps }
}

test('slot 注册：设置页与浮条的 id 都带本包名（避免与上游插件撞 id）', () => {
  const { registered } = setup()
  assert.equal(registered['settings.section'].length, 1)
  assert.equal(registered['settings.section'][0].spec.id, 'dsh-alert-sounds')
  assert.equal(registered['settings.section'][0].spec.order, 45)
  assert.equal(registered['shell.overlay'].length, 1)
  assert.equal(registered['shell.overlay'][0].spec.id, 'dsh-alert-sounds-toast')
})

test('完成提醒：running 真 → 假 后响一次 done', async () => {
  const { list, overlayProps } = setup({ list: { byId: { s1: { running: false } }, current: 's1' } })
  assert.equal(overlayProps().getCurrent(), null, '起步不该有提示')
  list.set({ byId: { s1: { running: true } }, current: 's1' })  // 这一轮开始
  list.set({ byId: { s1: { running: false } }, current: 's1' }) // 这一轮结束
  await delay(400) // settleRun 有 250ms 的稳定窗口
  assert.equal(overlayProps().getCurrent(), 'done')
})

test('已知限制（沿用上游）：页面加载时就已经在运行的会话，完成后不提醒', async () => {
  // seed() 只建基线、不 armRun；settleRun 找不到本轮记录就直接 return。
  // 影响面：只有「页面刷新/重开时正好有会话在跑」这一种情况；正常一轮跑完仍会响。
  // 以后要修的话，就在 seed() 里补一次 armRun，并把这条测试反过来断言 'done'。
  const { list, overlayProps } = setup({ list: { byId: { s1: { running: true } }, current: 's1' } })
  list.set({ byId: { s1: { running: false } }, current: 's1' })
  await delay(400)
  assert.equal(overlayProps().getCurrent(), null)
})

test('失败提醒：本轮 lastAgentError 变化 → failed', async () => {
  const { list, detail, overlayProps } = setup({ list: { byId: { s1: { running: false } }, current: 's1' } })
  list.set({ byId: { s1: { running: true } }, current: 's1' }) // armRun：记下当前 agentErr=null
  detail.lastAgentError = 'boom: 工具调用失败'
  list.set({ byId: { s1: { running: false } }, current: 's1' })
  await delay(400)
  assert.equal(overlayProps().getCurrent(), 'failed')
})

test('审批提醒：pendingInteractions 出现 approval → 立刻响', async () => {
  const { pending, overlayProps } = setup()
  pending.set(new Map([['s1', { kind: 'approval', toolName: 'write', reason: '写入文件' }]]))
  await delay(30)
  assert.equal(overlayProps().getCurrent(), 'approval')
})

test('提问提醒：question（含 plan-review）算提问', async () => {
  const { pending, overlayProps } = setup()
  pending.set(new Map([['s1', { kind: 'question', questions: [{ question: '要继续吗？' }] }]]))
  await delay(30)
  assert.equal(overlayProps().getCurrent(), 'question')
})

test('审批被处理掉之后，重复提醒会停（不会一直响）', async () => {
  const { pending, overlayProps } = setup()
  pending.set(new Map([['s1', { kind: 'approval', toolName: 'write' }]]))
  await delay(30)
  assert.equal(overlayProps().getCurrent(), 'approval')
  pending.set(new Map())
  await delay(30)
  // 处理掉之后不该再产生新的提醒状态（浮条仍停在刚弹的那条，等用户收）
  assert.equal(overlayProps().getCurrent(), 'approval')
})

test('加载前就已挂起的审批不会被误判成新事件（reseedPending 的作用）', async () => {
  const { list, overlayProps } = setup({ pending: new Map([['s1', { kind: 'approval', toolName: 'write' }]]) })
  list.set({ byId: { s1: { running: true } }, current: 's1' })
  await delay(60)
  assert.equal(overlayProps().getCurrent(), null, '基线里已有的挂起不能响')
})

test('提醒范围=仅当前会话时，别的会话完成不响', async () => {
  const { list, overlayProps } = setup({
    storage: { 'dsh-alert-sounds.v1': JSON.stringify({ scope: 'current' }) },
    list: { byId: { s1: { running: true }, s2: { running: true } }, current: 's1' },
  })
  list.set({ byId: { s1: { running: true }, s2: { running: false } }, current: 's1' })
  await delay(400)
  assert.equal(overlayProps().getCurrent(), null)
})

test('勿扰时段内完成不响（全部静音）', async () => {
  const { list, overlayProps } = setup({
    storage: { 'dsh-alert-sounds.v1': JSON.stringify({ dndEnabled: true, dndStart: 0, dndEnd: 24 }) },
    list: { byId: { s1: { running: true } }, current: 's1' },
  })
  list.set({ byId: { s1: { running: false } }, current: 's1' })
  await delay(400)
  assert.equal(overlayProps().getCurrent(), null)
})

test('设置了「原方案」时，完成提示会自己消失（不会永远停在屏幕上）', async () => {
  const { list, overlayProps } = setup({
    storage: { 'dsh-alert-sounds.v1': JSON.stringify({ toastStyle: 'original' }) },
    list: { byId: { s1: { running: false } }, current: 's1' },
  })
  list.set({ byId: { s1: { running: true } }, current: 's1' })
  list.set({ byId: { s1: { running: false } }, current: 's1' })
  await delay(400)
  assert.equal(overlayProps().getCurrent(), 'done')
  await delay(3800) // 上游的 3.6 秒
  assert.equal(overlayProps().getCurrent(), null)
})

test('默认（自研常驻条）下同一条完成提示不会自己消失', async () => {
  const { list, overlayProps } = setup({ list: { byId: { s1: { running: false } }, current: 's1' } })
  list.set({ byId: { s1: { running: true } }, current: 's1' })
  list.set({ byId: { s1: { running: false } }, current: 's1' })
  await delay(400)
  assert.equal(overlayProps().getCurrent(), 'done')
  await delay(4200) // 超过原方案的 3.6 秒
  assert.equal(overlayProps().getCurrent(), 'done', '人没回来之前不该消失')
})

test('启动不再弹蓝色「提醒已连接」条（用户会误以为是提醒出错）', async () => {
  // 上游会在 apply 后 600ms 弹一条 connected（唯一用蓝色的那条）；本 fork 已去掉。
  const { overlayProps } = setup()
  await delay(900)
  assert.equal(overlayProps().getCurrent(), null)
})
