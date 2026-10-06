/**
 * dsh-alert-sounds — 宿主半边（占位）。
 *
 * 本插件的全部能力都在浏览器半边（src/client.js + src/panel.js）：
 *   - 监听会话列表的 running 边沿（完成 / 出错）；
 *   - 监听 uiSession.pendingInteractions（审批 / 提问）；
 *   - 播提示音 / 语音 / 自定义音色；
 *   - 设置页（settings.section）与悬浮提示条（shell.overlay）。
 *
 * 宿主侧只需要存在一个可加载的 loader 条目：dsh-client-modules 靠「loader 条目的
 * 包名 → package.json 的 dsh.client 声明 → exports["./client"]」这条链把浏览器
 * bundle 接进 __DSH_BOOT__，所以本文件不能缺，但也不需要做任何事。
 *
 * @module @qgynisc/dsh-alert-sounds
 */

/** 名字（loader 条目的 name 是包名；这里保留一份便于调试输出）。 */
export const name = 'dsh-alert-sounds'

/** 宿主侧无操作：能力全在客户端。 */
export function apply() {}
