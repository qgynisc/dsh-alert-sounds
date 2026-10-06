/**
 * 极简 React 替身：只满足 src/panel.js 用到的那几个 API。
 *
 * createElement 返回 `{ type, props }`（而不是真的 DOM），这样单测可以：
 *   - 直接拿到注册进 slot 的组件返回的元素；
 *   - 从 `element.props` 里取出 getCurrent / subscribe / close 这些回调，
 *     于是**不用真的渲染**就能验证浮条与设置页的接线。
 *
 * createPortal（react-dom 的替身）只记录容器并原样返回节点：单测关心「有没有 portal
 * 到 body」，不关心真实挂载。
 */
export function createReactShim() {
  const stateHooks = []
  const portals = []
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
    createPortal(node, container) {
      portals.push(container)
      return node
    },
    __stateHooks: stateHooks,
    __portals: portals,
  }
}
