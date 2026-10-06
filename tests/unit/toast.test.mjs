/**
 * 浮条停留策略测试（本 fork 的核心改动）。
 *
 * 测的是 lib/client.js 里真实的 createToastStore：不渲染 React，只驱动
 * 「假定时器 + 假事件」把决策路径跑一遍。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadBundle } from '../helpers/bundle.mjs'

const { __test } = loadBundle().mod
const { createToastStore, toastModeFor, movedEnough, TOAST_SHORT_MS, TOAST_ARM_DELAY_MS, TOAST_MOVE_PX } = __test

/** 假的事件环境：记录监听器，可以手动 fire。 */
function fakeEnv() {
  const listeners = new Map()
  const api = {
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type).add(fn)
    },
    removeEventListener(type, fn) {
      const set = listeners.get(type)
      if (set) set.delete(fn)
    },
    count(type) {
      return listeners.get(type)?.size ?? 0
    },
    fire(type, event) {
      for (const fn of [...(listeners.get(type) ?? [])]) fn(event)
    },
  }
  return api
}

/** 假定时器：按毫秒数精确触发（store 只用这两种时长）。 */
function fakeTimers() {
  let seq = 0
  const pending = new Map()
  return {
    timeout(fn, ms) {
      const id = ++seq
      pending.set(id, { fn, ms })
      return () => pending.delete(id)
    },
    run(ms) {
      const due = [...pending.entries()].filter(([, item]) => item.ms === ms)
      for (const [id, item] of due) {
        pending.delete(id)
        item.fn()
      }
      return due.length
    },
    size() {
      return pending.size
    },
  }
}

function makeStore(mode) {
  const env = fakeEnv()
  const timers = fakeTimers()
  const store = createToastStore({ env, getMode: () => mode, timeout: (fn, ms) => timers.timeout(fn, ms) })
  return { env, timers, store }
}

/* ---------------- 纯函数 ---------------- */

test('toastModeFor：原方案=短时自关，自研=常驻到鼠标动，启动提示永远短时', () => {
  assert.equal(toastModeFor('done', { toastStyle: 'original' }), 'short')
  assert.equal(toastModeFor('done', { toastStyle: 'own' }), 'untilMove')
  assert.equal(toastModeFor('done', {}), 'untilMove', '缺设置时按自研（本版默认）')
  assert.equal(toastModeFor('done', undefined), 'untilMove')
  assert.equal(toastModeFor('connected', { toastStyle: 'own' }), 'short', '启动提示不能赖着不走')
  assert.equal(toastModeFor('connected', { toastStyle: 'original' }), 'short')
})

test('movedEnough：位移按横+纵合计，达到阈值才算“人回来了”', () => {
  assert.equal(movedEnough(0, 0), false)
  assert.equal(movedEnough(3, 4), false, '7px 不算')
  assert.equal(movedEnough(TOAST_MOVE_PX, 0), true)
  assert.equal(movedEnough(-TOAST_MOVE_PX, 0), true, '反方向同样算')
  assert.equal(movedEnough(0, -TOAST_MOVE_PX), true)
  assert.equal(movedEnough(3, 3), false, '6px 仍不算（避免手抖误关）')
})

/* ---------------- 原方案：3.6 秒自动消失 ---------------- */

test('原方案：到点自动消失，且全程不挂输入监听', () => {
  const { env, timers, store } = makeStore('short')
  store.emit('done')
  assert.equal(store.getCurrent(), 'done')
  assert.equal(env.count('pointermove'), 0, '原方案不该监听鼠标')
  assert.equal(env.count('pointerdown'), 0)
  assert.equal(timers.run(TOAST_SHORT_MS), 1)
  assert.equal(store.getCurrent(), null)
})

/* ---------------- 自研：常驻直到鼠标明显移动或点击 ---------------- */

test('自研：先常驻，武装延迟后才挂监听；微小位移不关，明显位移才关', () => {
  const { env, timers, store } = makeStore('untilMove')
  store.emit('done')
  assert.equal(store.getCurrent(), 'done')
  assert.equal(env.count('pointermove'), 0, '武装延迟内不该有监听（否则弹出瞬间就被自己的抖动关掉）')

  assert.equal(timers.run(TOAST_ARM_DELAY_MS), 1)
  assert.equal(env.count('pointermove'), 1)
  assert.equal(env.count('pointerdown'), 1)
  assert.equal(store.getCurrent(), 'done', '挂了监听也不该自己消失')

  env.fire('pointermove', { clientX: 100, clientY: 200 })
  assert.equal(store.getCurrent(), 'done', '第一次移动只记基准点')

  env.fire('pointermove', { clientX: 103, clientY: 202 })
  assert.equal(store.getCurrent(), 'done', '5px 位移不算“回来了”')

  env.fire('pointermove', { clientX: 100 + TOAST_MOVE_PX, clientY: 200 })
  assert.equal(store.getCurrent(), null, '达到阈值才收')
  assert.equal(env.count('pointermove'), 0, '收掉之后要解绑监听')
  assert.equal(env.count('pointerdown'), 0)
})

test('自研：任意点击也收（触屏 / 不想动鼠标的情况）', () => {
  const { env, timers, store } = makeStore('untilMove')
  store.emit('failed')
  timers.run(TOAST_ARM_DELAY_MS)
  env.fire('pointerdown', { clientX: 5, clientY: 5 })
  assert.equal(store.getCurrent(), null)
  assert.equal(env.count('pointermove'), 0)
})

test('自研：× 按钮（手动 close）随时能收', () => {
  const { store } = makeStore('untilMove')
  store.emit('question')
  store.close()
  assert.equal(store.getCurrent(), null)
})

test('自研：收掉之后再响一条，会重新挂上监听（不是一次性的）', () => {
  const { env, timers, store } = makeStore('untilMove')
  store.emit('done')
  timers.run(TOAST_ARM_DELAY_MS)
  env.fire('pointermove', { clientX: 0, clientY: 0 })
  env.fire('pointermove', { clientX: 50, clientY: 0 })
  assert.equal(store.getCurrent(), null)

  store.emit('done')
  assert.equal(store.getCurrent(), 'done')
  timers.run(TOAST_ARM_DELAY_MS)
  assert.equal(env.count('pointermove'), 1, '第二次也要重新武装')
})

/* ---------------- 通用语义 ---------------- */

test('sticky：谁都不自动关，只能手动 close', () => {
  const { env, timers, store } = makeStore('sticky')
  store.emit('approval')
  assert.equal(timers.size(), 0, 'sticky 不该排任何定时器')
  assert.equal(env.count('pointermove'), 0)
  assert.equal(store.getCurrent(), 'approval')
  store.close('approval')
  assert.equal(store.getCurrent(), null)
})

test('close(kind) 只关“还是这一条”的时候（防止上一条的定时器误关后一条）', () => {
  const { store } = makeStore('untilMove')
  store.emit('done')
  store.close('failed')
  assert.equal(store.getCurrent(), 'done', '类型不匹配时不能关')
  store.close('done')
  assert.equal(store.getCurrent(), null)
})

test('emit(null) 清空；订阅者在 emit / close 时都被通知', () => {
  const { store } = makeStore('untilMove')
  let notifications = 0
  const unsubscribe = store.subscribe(() => { notifications += 1 })
  assert.equal(notifications, 1, 'subscribe 立刻回调一次（面板首帧要拿到当前值）')
  store.emit('done')
  assert.equal(notifications, 2)
  store.close()
  assert.equal(notifications, 3)
  store.emit(null)
  assert.equal(store.getCurrent(), null)
  unsubscribe()
})

test('重复响同一类会刷新时刻并再次通知（自研浮条上的 HH:MM 要跟着变）', async () => {
  const { store } = makeStore('untilMove')
  let notifications = 0
  store.subscribe(() => { notifications += 1 })
  store.emit('failed')
  const first = store.getCurrentAt()
  assert.ok(first > 0)
  await new Promise((resolve) => setTimeout(resolve, 15))
  store.emit('failed')
  assert.ok(store.getCurrentAt() >= first)
  assert.equal(store.getCurrent(), 'failed')
  assert.equal(notifications, 3, '首帧 + 两次 emit')
})

test('getCurrentAt 在没有任何提示时为 0', () => {
  const { store } = makeStore('untilMove')
  assert.equal(store.getCurrentAt(), 0)
})

test('没有可用的 window（env 为 null）时不会抛错，只是不会自动收', () => {
  const timers = fakeTimers()
  const store = createToastStore({ env: null, getMode: () => 'untilMove', timeout: (fn, ms) => timers.timeout(fn, ms) })
  store.emit('done')
  assert.equal(store.getCurrent(), 'done')
  store.close()
  assert.equal(store.getCurrent(), null)
})
