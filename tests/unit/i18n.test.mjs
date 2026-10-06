/**
 * i18n 测试：中英词典必须成对齐全（漏一个键在英文界面就会露出中文或键名）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadBundle } from '../helpers/bundle.mjs'

const { __test } = loadBundle().mod
const { I18N, KINDS, SOUND_IDS, pickLang } = __test

test('pickLang：显式偏好优先，auto 跟随浏览器语言，无语言时回落到 en', () => {
  assert.equal(pickLang('zh', 'en-US'), 'zh')
  assert.equal(pickLang('en', 'zh-CN'), 'en')
  assert.equal(pickLang('auto', 'zh-CN'), 'zh')
  assert.equal(pickLang('auto', 'zh-Hans'), 'zh')
  assert.equal(pickLang('auto', 'en-GB'), 'en')
  assert.equal(pickLang('auto', ''), 'en')
  assert.equal(pickLang(undefined, 'zh-TW'), 'zh')
})

test('中英词典键集合完全一致', () => {
  const zh = Object.keys(I18N.zh).sort()
  const en = Object.keys(I18N.en).sort()
  const missingInEn = zh.filter((key) => !en.includes(key))
  const missingInZh = en.filter((key) => !zh.includes(key))
  assert.deepEqual(missingInEn, [], `英文词典缺：${missingInEn.join(', ')}`)
  assert.deepEqual(missingInZh, [], `中文词典缺：${missingInZh.join(', ')}`)
})

test('五类提醒在两种语言里都有名字', () => {
  for (const kind of KINDS) {
    assert.ok(I18N.zh[kind], `中文缺 ${kind}`)
    assert.ok(I18N.en[kind], `英文缺 ${kind}`)
  }
})

test('每种音色在两种语言里都有名字', () => {
  for (const sound of SOUND_IDS) {
    assert.ok(I18N.zh['sound.' + sound], `中文缺 sound.${sound}`)
    assert.ok(I18N.en['sound.' + sound], `英文缺 sound.${sound}`)
  }
})

test('浮条两种实现的文案都在（原方案 / 自研）', () => {
  for (const lang of ['zh', 'en']) {
    assert.ok(I18N[lang]['toastStyle'], `${lang} 缺 toastStyle`)
    assert.ok(I18N[lang]['toastStyle.own'], `${lang} 缺 toastStyle.own`)
    assert.ok(I18N[lang]['toastStyle.original'], `${lang} 缺 toastStyle.original`)
    assert.ok(I18N[lang]['toast.close'], `${lang} 缺 toast.close`)
  }
})

test('上一版的 toastMode 文案已经清干净（避免设置页出现死键）', () => {
  for (const lang of ['zh', 'en']) {
    const stale = Object.keys(I18N[lang]).filter((key) => key.startsWith('toastMode'))
    assert.deepEqual(stale, [], `${lang} 还留着：${stale.join(', ')}`)
  }
})
