/**
 * 单测公共设施：在 Node 的 vm 里以「浏览器 bundle 的真实形态」加载 lib/client.js。
 *
 * bundle 是 `window.__ModuleLoader__.load({ id, factory })` 形态，所以这里提供一个假的
 * window.__ModuleLoader__，再把 factory 拿到的 module.exports 交出去——测的就是
 * **构建产物本身**，不是源码的另一份拷贝。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * 加载构建产物。
 * @param options.windowExtra - 额外挂到假 window 上的属性（如 addEventListener 记录器）
 * @param options.localStorage - 假 localStorage（用来测「读设置后的行为」，如 scope / 浮条样式）
 * @param options.require - 注入给 factory 的 require。缺省是「什么都不解析」的实现
 *   （用来验证拿不到平台模块时插件照常工作）；测设置页时把 React 替身传进来。
 * @returns {id, mod, sandbox}
 */
export function loadBundle(options = {}) {
  const code = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8')
  let loaded
  const windowStub = Object.assign({
    __ModuleLoader__: {
      load(mod) {
        loaded = mod
      },
    },
  }, options.windowExtra ?? {})
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
    atob,
    navigator: options.navigator,
    localStorage: options.localStorage,
    document: options.document,
    window: windowStub,
  }
  vm.createContext(sandbox)
  vm.runInContext(code, sandbox, { filename: 'lib/client.js' })
  if (loaded === undefined) throw new Error('bundle 没有调用 window.__ModuleLoader__.load')
  const mod = loaded.factory(
    options.require ??
      ((id) => {
        throw new Error(`本插件只应解析 react，实际解析了 ${id}`)
      }),
  )
  return { id: loaded.id, mod, sandbox }
}

/**
 * 建一个假的 cordis ctx，够 apply() 跑起来用。
 * 返回的 `overlay` / `settingsSection` 是注册进 slots 的组件工厂，测试可以直接调用它们。
 */
export function createFakeCtx(options = {}) {
  const disposers = []
  const intervals = []
  const timeouts = []
  const registered = { 'settings.section': [], 'shell.overlay': [] }
  /** 取消所有指定毫秒数的待触发定时器（测试用来屏蔽启动时那条 connected 提示）。 */
  const cancelTimeoutsByMs = (ms) => {
    let cancelled = 0
    for (const record of timeouts) {
      if (record.ms === ms && !record.cancelled) {
        record.cancelled = true
        cancelled += 1
      }
    }
    return cancelled
  }
  const services = Object.assign({}, options.services)
  const slots = {
    inject(name, fn) {
      fn()
    },
    register(spec, component) {
      const bucket = registered[spec.name] ?? (registered[spec.name] = [])
      bucket.push({ spec, component })
      return () => {
        const index = bucket.findIndex((item) => item.spec === spec)
        if (index >= 0) bucket.splice(index, 1)
      }
    },
  }
  const ctx = {
    get(name) {
      if (name === 'slots') return slots
      return services[name]
    },
    inject(names, fn) {
      fn({
        get: ctx.get,
        effect(effect) {
          const dispose = effect()
          if (typeof dispose === 'function') disposers.push(dispose)
          return dispose
        },
      })
    },
    effect(effect) {
      const dispose = effect()
      if (typeof dispose === 'function') disposers.push(dispose)
      return dispose
    },
    timeout(fn, ms) {
      const record = { fn, ms, cancelled: false }
      timeouts.push(record)
      const id = setTimeout(() => {
        if (!record.cancelled) fn()
      }, ms)
      return () => {
        record.cancelled = true
        clearTimeout(id)
      }
    },
    /**
     * 定时轮询（插件用它做卡住检测，5 秒一次）。
     * **刻意不真的起 setInterval**：那会让 Node 测试进程永远不退出。
     * 需要的测试自己从 `intervals` 里取出回调手动跑。
     */
    interval(fn, ms) {
      intervals.push({ fn, ms, cancelled: false })
      return () => {
        const record = intervals.find((item) => item.fn === fn)
        if (record) record.cancelled = true
      }
    },
  }
  return { ctx, registered, services, disposers, intervals, timeouts, cancelTimeoutsByMs }
}
