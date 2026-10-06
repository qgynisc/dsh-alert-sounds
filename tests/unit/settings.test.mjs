/**
 * 设置合并语义测试：老版本存下来的设置必须能被新版本安全读入（不能丢项、不能变形）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadBundle } from '../helpers/bundle.mjs'

const { __test } = loadBundle().mod
const { DEFAULTS, DEFAULT_TYPES, deepMerge } = __test

test('deepMerge 逐项填默认值，嵌套对象递归合并', () => {
  const merged = deepMerge(DEFAULTS, { volume: 1.2, types: { done: { sound: 'none' } } })
  assert.equal(merged.volume, 1.2)
  assert.equal(merged.showToast, true, '没存过的项要拿默认值')
  assert.equal(merged.types.done.sound, 'none')
  assert.equal(merged.types.done.enabled, true, '嵌套对象只覆盖给出的字段')
  assert.equal(merged.types.approval.sound, 'alarm', '其它类别保持默认')
})

test('deepMerge 不修改传入的默认对象（无副作用）', () => {
  const before = JSON.stringify(DEFAULTS)
  deepMerge(DEFAULTS, { types: { done: { sound: 'voice' } } })
  assert.equal(JSON.stringify(DEFAULTS), before)
})

test('上游老格式的真实设置能被安全读入（未知键丢弃、缺失键补默认）', () => {
  // 上游 0.3.14 存过的形状：有 toastMode / 没有 toastStyle
  const stored = {
    volume: 0.5,
    scope: 'current',
    repeatMs: 0,
    notifyEnabled: true,
    readOutput: true,
    stallMs: 60000,
    showToast: false,
    toastMode: 'sticky',
    voiceRate: 1.3,
    dndEnabled: true,
    dndStart: 23,
    dndEnd: 7,
    lang: 'en',
    types: { approval: { enabled: false, sound: 'none' } },
    legacyUnknownKey: 'ignored',
  }
  const merged = deepMerge(DEFAULTS, stored)
  assert.equal(merged.volume, 0.5)
  assert.equal(merged.scope, 'current')
  assert.equal(merged.showToast, false)
  assert.equal(merged.toastStyle, 'own', '上游的 toastMode 不再有意义，应回到本版默认（自研常驻条）')
  assert.equal(merged.toastMode, undefined, '不该把未知键带进活设置对象')
  assert.equal(merged.legacyUnknownKey, undefined)
  assert.equal(merged.types.approval.enabled, false)
  assert.equal(merged.types.approval.sound, 'none')
  assert.equal(merged.types.failed.sound, 'fault', '没给出的类别走默认')
})

test('DEFAULTS 里的每类提醒都有 enabled + sound', () => {
  for (const kind of __test.KINDS) {
    assert.ok(DEFAULTS.types[kind], `DEFAULTS.types.${kind} 缺失`)
    assert.equal(typeof DEFAULTS.types[kind].enabled, 'boolean')
    assert.ok(__test.SOUND_IDS.includes(DEFAULTS.types[kind].sound), `默认音色 ${DEFAULTS.types[kind].sound} 不在 SOUND_IDS 里`)
  }
})

test('DEFAULT_TYPES 与 DEFAULTS.types 是同一份默认（不会两处漂移）', () => {
  assert.deepEqual(DEFAULTS.types, DEFAULT_TYPES)
})

test('音量 / 语速 / 重复间隔的默认值是有意选的', () => {
  assert.equal(DEFAULTS.volume, 0.7)
  assert.equal(DEFAULTS.repeatMs, 20000)
  assert.equal(DEFAULTS.voiceRate, 1)
  assert.equal(DEFAULTS.stallMs, 0, '卡住检测默认关（实验性）')
})
