/**
 * 内置音色测试（2026-10-06：用户反馈「这几个声音太单薄了」→ 四个内置音色换成离线渲染的 mp3）。
 *
 * 守住三件事：
 *   1. 四段 mp3 **真的内联进了 bundle**，且与仓库里 assets/audio/*.mp3 **逐字节一致**
 *      （不一致 = 换了音色却忘了重新构建/提交，用户在 npm 上听到的和仓库里不是一回事）；
 *   2. 播放内置音色走 **AudioBuffer**（decodeAudioData + createBufferSource），不是老的现场合成；
 *   3. 拿不到解码能力时**退回现场合成**——宁可音色薄一点，也绝不能不响。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadBundle } from '../helpers/bundle.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const { mod: baseMod } = loadBundle()
const { AUDIO_IDS, BUILTIN_AUDIO, PATTERNS, PATTERN_ALIAS, SOUND_IDS, DEFAULT_TYPES, KINDS, getSettings, dataUrlToArrayBuffer } = baseMod.__test

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 假 AudioContext：够 scheduleBufferNow / schedulePatternNow 跑完，并把「用了哪条路径」记下来。
 * @param calls 记录器 {buffers, oscillators}
 * @param options.failDecode 让 decodeAudioData 走失败回调（测合成兜底）
 * @param options.duration 假解码出来的音频时长（秒）
 */
function fakeAudioContext(calls, options = {}) {
  const gain = () => ({
    value: 0,
    gain: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} },
    connect() {},
  })
  class FakeAudioContext {
    constructor() {
      this.state = 'running'
      this.currentTime = 0
      this.destination = {}
    }
    resume() { return Promise.resolve() }
    createGain() { return gain() }
    createOscillator() {
      calls.oscillators += 1
      return { type: '', frequency: { value: 0 }, connect() {}, start() {}, stop() {} }
    }
    createBufferSource() {
      calls.buffers += 1
      return { buffer: null, onended: null, connect() {}, start() {}, stop() {} }
    }
    decodeAudioData(bytes, ok, bad) {
      calls.decodedBytes = (calls.decodedBytes ?? 0) + (bytes?.byteLength ?? 0)
      if (options.failDecode) { if (bad) bad(new Error('decode failed')); return undefined }
      if (ok) ok({ duration: options.duration ?? 1.1 })
      return undefined
    }
  }
  return FakeAudioContext
}

test('五个内置音色都内联成了 mp3 dataURL', () => {
  assert.deepEqual([...AUDIO_IDS].sort(), ['alarm', 'ding', 'fault', 'stall', 'tap'])
  for (const id of AUDIO_IDS) {
    const url = BUILTIN_AUDIO[id]
    assert.ok(typeof url === 'string', `${id} 没有内联音频`)
    assert.ok(url.startsWith('data:audio/mpeg;base64,'), `${id} 不是 mp3 dataURL：${String(url).slice(0, 40)}`)
    assert.ok(url.length > 4000, `${id} 的内联音频只有 ${url.length} 字符，像是空文件`)
  }
})

test('内联音频与 assets/audio/*.mp3 逐字节一致（换了音色必须重新构建）', () => {
  for (const id of AUDIO_IDS) {
    const file = readFileSync(join(ROOT, 'assets', 'audio', `${id}.mp3`))
    const inlined = Buffer.from(dataUrlToArrayBuffer(BUILTIN_AUDIO[id]))
    assert.equal(inlined.length, file.length, `${id}：内联字节数与 assets/audio/${id}.mp3 不同`)
    assert.ok(inlined.equals(file), `${id}：内联内容与 assets/audio/${id}.mp3 不同，跑 npm run build`)
  }
})

test('内联音频是合法 MP3（ID3 头或 MPEG 帧同步）', () => {
  for (const id of AUDIO_IDS) {
    const bytes = new Uint8Array(dataUrlToArrayBuffer(BUILTIN_AUDIO[id]))
    const isId3 = bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33
    const isMpeg = bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0
    assert.ok(isId3 || isMpeg, `${id} 的头字节不是 MP3：${[...bytes.slice(0, 4)].map((b) => b.toString(16)).join(' ')}`)
  }
})

test('合成音型仍在（解码不可用时的兜底音色）', () => {
  for (const id of AUDIO_IDS) {
    const pattern = PATTERNS[PATTERN_ALIAS[id] || id]
    assert.ok(pattern && pattern.notes.length > 0, `兜底音型缺 ${id}`)
  }
})

test('每一类提醒的默认音色都对应一段真实音频（除了语音/自定义/静音）', () => {
  for (const kind of KINDS) {
    const sound = DEFAULT_TYPES[kind].sound
    assert.ok(SOUND_IDS.includes(sound), `${kind} 的默认音色 ${sound} 不在 SOUND_IDS 里`)
    if (sound !== 'voice' && sound !== 'custom' && sound !== 'none') {
      assert.ok(BUILTIN_AUDIO[sound], `${kind} 默认用 ${sound}，但 bundle 里没有这段音频`)
    }
  }
  assert.equal(DEFAULT_TYPES.stalled.sound, 'stall', '「卡住」应该有自己的音色，不再蹭出错的')
})

test('迁移：老设置里 stalled 用旧默认值 fault 时，自动换成新的 stall（只动一次）', () => {
  const stored = {
    volume: 0.9,
    types: {
      approval: { enabled: true, sound: 'alarm' },
      question: { enabled: true, sound: 'tap' },
      done: { enabled: true, sound: 'ding' },
      failed: { enabled: true, sound: 'fault' },
      stalled: { enabled: true, sound: 'fault' },
    },
  }
  const written = []
  const { mod } = loadBundle({
    localStorage: {
      getItem: (key) => (key === 'dsh-alert-sounds.v1' ? JSON.stringify(stored) : null),
      setItem: (key, value) => written.push([key, value]),
    },
  })
  assert.equal(mod.__test.getSettings().types.stalled.sound, 'stall')
  assert.equal(mod.__test.getSettings().types.failed.sound, 'fault', '不该连带改掉出错那一类')
  assert.equal(written.length, 1, '迁移结果应该写回一次 localStorage')
})

test('迁移不碰用户自己选过的音色', () => {
  const stored = { types: { stalled: { enabled: true, sound: 'ding' } } }
  const { mod } = loadBundle({
    localStorage: { getItem: (k) => (k === 'dsh-alert-sounds.v1' ? JSON.stringify(stored) : null), setItem: () => { throw new Error('不该写回') } },
  })
  assert.equal(mod.__test.getSettings().types.stalled.sound, 'ding')
})

test('stall 在解码失败时借用 fault 的合成音型（不会哑掉）', async () => {
  const calls = { buffers: 0, oscillators: 0 }
  const { mod } = loadBundle({ windowExtra: { AudioContext: fakeAudioContext(calls, { failDecode: true }) } })
  mod.__test.playPattern('stall')
  await delay(80)
  assert.equal(calls.buffers, 0)
  assert.ok(calls.oscillators >= 1 + PATTERNS.fault.notes.length, `stall 兜底没响（振荡器 ${calls.oscillators} 个）`)
})

test('播放内置音色走 AudioBuffer，而不是现场合成', async () => {
  const calls = { buffers: 0, oscillators: 0 }
  const { mod } = loadBundle({ windowExtra: { AudioContext: fakeAudioContext(calls) } })
  mod.__test.playPattern('ding')
  await delay(50)
  assert.equal(calls.buffers, 1, '没有走 createBufferSource（音频播放）路径')
  assert.equal(calls.oscillators, 1, '振荡器只该有 200ms 静音预热那一个（多的说明退回了合成）')
  assert.ok(calls.decodedBytes > 4000, 'decodeAudioData 没拿到真实音频字节')
})

test('解码失败时退回现场合成（绝不静音）', async () => {
  const calls = { buffers: 0, oscillators: 0 }
  const { mod } = loadBundle({ windowExtra: { AudioContext: fakeAudioContext(calls, { failDecode: true }) } })
  mod.__test.playPattern('ding')
  await delay(80)
  assert.equal(calls.buffers, 0, '解码失败却仍走了 buffer 路径')
  // 预热 1 个 + ding 的 2 个音符
  assert.ok(calls.oscillators >= 1 + PATTERNS.ding.notes.length, `兜底合成没跑起来（振荡器 ${calls.oscillators} 个）`)
})

test('完全没有 AudioContext 时不抛错（静默降级，不炸整个插件）', async () => {
  const { mod } = loadBundle({ windowExtra: {} })
  assert.doesNotThrow(() => mod.__test.playPattern('ding'))
  await delay(20)
})

test('decodeBuiltin 有缓存：同一音色只解码一次', async () => {
  const calls = { buffers: 0, oscillators: 0 }
  const { mod } = loadBundle({ windowExtra: { AudioContext: fakeAudioContext(calls) } })
  const ac = new (fakeAudioContext(calls))()
  const first = await mod.__test.decodeBuiltin('ding', ac)
  const second = await mod.__test.decodeBuiltin('ding', ac)
  assert.ok(first, '第一次没解出 buffer')
  assert.equal(first, second, '第二次没有命中缓存（换了新对象）')
  const fileSize = readFileSync(join(ROOT, 'assets', 'audio', 'ding.mp3')).length
  assert.equal(calls.decodedBytes, fileSize, '解码拿到的字节数应该正好是 ding.mp3 的大小')
})
