/**
 * 极简 React 替身：只满足 src/panel.js 用到的那几个 API。
 *
 * createElement 返回 `{ type, props }`（而不是真的 DOM），这样单测可以：
 *   - 直接拿到注册进 slot 的组件返回的元素；
 *   - 从 `element.props` 里取出 getCurrent / subscribe / close 这些回调，
 *     于是**不用真的渲染**就能验证浮条与设置页的接线。
 */
export function createReactShim() {
  const stateHooks = []
  return {
    createElement(type, props, ...children) {
      const merged = Object.assign({}, props ?? {})
      if (children.length === 1) merged.children = children[0]
      else if (children.length > 1) merged.children = children
      return { type, props: merged, __reactShim: true }
    },
    useState(initial) {
      const value = typeof initial === 'function' ? initial() : initial
      const pair = [value, () => {}]
      stateHooks.push(pair)
      return pair
    },
    useEffect(effect) {
      // 单测里不跑副作用（订阅由测试自己调用 subscribe）
      if (typeof effect === 'function') effect()
    },
    __stateHooks: stateHooks,
  }
}
