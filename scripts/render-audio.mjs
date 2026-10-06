/**
 * dsh-alert-sounds — 内置提示音的离线渲染脚本（**只在换音色时手动跑**，构建/安装都不需要它）
 *
 * 为什么要「离线渲染成 mp3」而不是运行时合成：
 *   DSH 桌面端是通过 `__DSH_TRANSPORT__.loadBundle` 把客户端插件 **当源码文本** 取进页面的，
 *   插件包里的兄弟文件（assets/*.mp3）**没有可依赖的 URL**，所以运行时 fetch 音频不可靠；
 *   构建时把 mp3 内联成 base64 dataURL 才 100% 可用（见 scripts/build.mjs 的 __AUDIO__ 锚点）。
 *
 * 四个音色（id 沿用上游，换的只是"声音内容"）：
 *   ding  输出完成 —— 木质马林巴双音上行（C5→G5）+ 轻钟琴泛音，温暖不刺耳
 *   tap   需要回答 —— 木质轻点（木琴/木鱼）两声上行，短促
 *   alarm 需要审批 —— 电子 FM pluck 三音上行 + 乒乓延迟，清亮有存在感
 *   fault 发生错误 —— 重低音双打击（厚锯齿 + 软饱和 + 噪声瞬态），压低、有压迫感
 *   （卡住 stall 没有独立音型，播放时借用 fault 的合成音型兜底。）
 *
 * ⚠️ 2026-10-06 起，**内置音色用的是用户提供的素材**（`scripts/import-audio.mjs` 导入，
 * 见 assets/audio/ 与 README「音色」）。本脚本保留为"手上没有素材时"的备用合成方案：
 * 它默认**不会覆盖**已存在的 assets/audio/*.mp3（要覆盖得显式加 --force），
 * 也可以用 `--out <目录>` 输出到别处再看。
 *
 * 依赖：Node ≥ 20（合成）+ ffmpeg（编码 mp3）。生成物 `assets/audio/*.mp3` **要入库**：
 * build 与 CI 全靠它们复现同一份 lib/client.js（CI 会重跑 build 并 diff lib/）。
 *
 * 用法：
 *   node scripts/render-audio.mjs             # 渲染并编码到 assets/audio/（已有文件则拒绝）
 *   node scripts/render-audio.mjs --force     # 覆盖现有 assets/audio/*.mp3
 *   node scripts/render-audio.mjs --out /tmp/x # 输出到别的目录
 *   node scripts/render-audio.mjs --keep-wav  # 同时保留中间 WAV（调试用）
 */
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SR = 44100
const KEEP_WAV = process.argv.includes('--keep-wav')
const FORCE = process.argv.includes('--force')
const outIndex = process.argv.indexOf('--out')
/** 输出目录：默认 assets/audio/（内置音色所在处），可用 --out 换地方。 */
const OUT_DIR = outIndex >= 0 && process.argv[outIndex + 1] ? process.argv[outIndex + 1] : join(ROOT, 'assets', 'audio')

/* 安全闸：assets/audio/ 里的 mp3 现在可能是**导入的素材**（scripts/import-audio.mjs），
 * 本脚本一跑就会把它们覆盖成合成音色。所以已有文件时默认拒绝，必须显式 --force。 */
if (!FORCE) {
  const existing = Object.keys({ ding: 1, tap: 1, alarm: 1, fault: 1 }).filter((id) => existsSync(join(OUT_DIR, `${id}.mp3`)))
  if (existing.length > 0) {
    console.error(`拒绝覆盖：${OUT_DIR} 里已有 ${existing.join('、')}.mp3（可能是导入的素材）。`)
    console.error('确实要用合成音色覆盖，加 --force；只想看看效果，用 --out <目录>。')
    process.exit(1)
  }
}

/* ============================ 基础工具 ============================ */

const sec = (t) => Math.round(t * SR)
const empty = (seconds) => new Float32Array(sec(seconds))

/** 确定性噪声（同一次渲染必须逐字节可复现，所以不用 Math.random）。 */
function makeNoise(seed) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2147483648 - 1
  }
}

/** 包络：attack 秒线性起音，之后按 tau 指数衰减（tau 是时间常数，越小越短）。 */
function env(t, attack, tau) {
  if (t < 0) return 0
  if (t < attack) return t / attack
  return Math.exp(-(t - attack) / tau)
}

/** 往 out 里叠加一个正弦（带包络）。 */
function addSine(out, start, freq, amp, attack, tau, phase = 0) {
  const from = Math.max(0, sec(start))
  const to = Math.min(out.length, sec(start + attack + tau * 12))
  for (let i = from; i < to; i++) {
    const t = (i - sec(start)) / SR
    out[i] += amp * env(t, attack, tau) * Math.sin(2 * Math.PI * freq * t + phase)
  }
}

/** 木质打击乐：基频 + 非谐泛音（马林巴那个 ~4 倍泛音就是"木头味"）+ 槌击瞬态。 */
function addMarimba(out, start, freq, amp, tau, { click = 0.1, seed = 1 } = {}) {
  const partials = [
    [1.0, 1.0, tau],
    [3.93, 0.32, tau * 0.42],
    [9.2, 0.1, tau * 0.2],
  ]
  for (const [ratio, pamp, ptau] of partials) addSine(out, start, freq * ratio, amp * pamp, 0.0025, ptau)
  if (click > 0) {
    const noise = makeNoise(seed * 7919 + 13)
    const from = Math.max(0, sec(start))
    const to = Math.min(out.length, sec(start + 0.012))
    for (let i = from; i < to; i++) {
      const t = (i - sec(start)) / SR
      out[i] += amp * click * Math.exp(-t / 0.0022) * noise()
    }
  }
}

/** FM 钟琴：载波 + 1.4 倍非谐调制（经典 bell），调制指数快速衰减 → 亮起音 + 长余韵。 */
function addBell(out, start, freq, amp, tau, { index = 2.2, indexTau = 0.06 } = {}) {
  const from = Math.max(0, sec(start))
  const to = Math.min(out.length, sec(start + tau * 12))
  for (let i = from; i < to; i++) {
    const t = (i - sec(start)) / SR
    const e = env(t, 0.003, tau)
    const mod = index * Math.exp(-t / indexTau) * Math.sin(2 * Math.PI * freq * 1.4 * t)
    out[i] += amp * e * Math.sin(2 * Math.PI * freq * t + mod)
  }
}

/** FM pluck（电子）：调制比可调 + 调制量指数衰减 → 明亮起音、干净尾巴。 */
function addFmPluck(out, start, freq, amp, tau, { ratio = 2, index = 4.5, indexTau = 0.055 } = {}) {
  const from = Math.max(0, sec(start))
  const to = Math.min(out.length, sec(start + tau * 12))
  for (let i = from; i < to; i++) {
    const t = (i - sec(start)) / SR
    const e = env(t, 0.004, tau)
    const mod = index * Math.exp(-t / indexTau) * Math.sin(2 * Math.PI * freq * ratio * t)
    out[i] += amp * e * Math.sin(2 * Math.PI * freq * t + mod)
  }
}

/** 厚锯齿（加法近似）+ 微失谐双声部 + 低八度 → "重、凶"的低音。 */
function addThickSaw(out, start, freq, amp, tau, { harmonics = 14, detune = 0.004, sub = 0.4 } = {}) {
  const from = Math.max(0, sec(start))
  const to = Math.min(out.length, sec(start + tau * 6))
  for (let i = from; i < to; i++) {
    const t = (i - sec(start)) / SR
    const e = env(t, 0.006, tau)
    let v = 0
    for (let h = 1; h <= harmonics; h++) {
      const roll = 1 / h
      v += roll * Math.sin(2 * Math.PI * freq * h * t)
      v += roll * 0.8 * Math.sin(2 * Math.PI * freq * (1 + detune) * h * t + 0.7)
    }
    v *= 0.5 / harmonics ** 0.35
    v += sub * Math.sin(2 * Math.PI * (freq / 2) * t)
    out[i] += amp * e * v
  }
}

/** 噪声瞬态（打击/气声感），一阶低通避免纯白噪的"嘶"。 */
function addNoiseHit(out, start, amp, tau, { smooth = 0.35, seed = 7 } = {}) {
  const noise = makeNoise(seed)
  const from = Math.max(0, sec(start))
  const to = Math.min(out.length, sec(start + tau * 6))
  let last = 0
  for (let i = from; i < to; i++) {
    const t = (i - sec(start)) / SR
    last = last * smooth + noise() * (1 - smooth)
    out[i] += amp * Math.exp(-t / tau) * last
  }
}

/** 软饱和：把低频厚音"推"出谐波但不过载。 */
function saturate(samples, drive = 1.8) {
  const norm = Math.tanh(drive)
  for (let i = 0; i < samples.length; i++) samples[i] = Math.tanh(samples[i] * drive) / norm
  return samples
}

/** 淡入淡出（首尾各几毫秒），防止 click。 */
function fadeEdges(samples, inSec = 0.003, outSec = 0.02) {
  const a = sec(inSec)
  const b = samples.length - sec(outSec)
  for (let i = 0; i < a && i < samples.length; i++) samples[i] *= i / a
  for (let i = Math.max(0, b); i < samples.length; i++) samples[i] *= Math.max(0, (samples.length - i) / sec(outSec))
  return samples
}

/** Schroeder 混响（4 梳状 + 2 全通），左右延迟略不同 → 自然宽度。 */
function reverb(mono, { mix = 0.26, rt60 = 0.55, spread = 1 } = {}) {
  const combDelays = [1557, 1617, 1491, 1422].map((d) => Math.round(d * spread))
  const allpassDelays = [225, 556].map((d) => Math.round(d * spread))
  const g = Math.pow(10, -3 / ((rt60 * SR) / combDelays[0]))
  const render = (delays, gv) => {
    const out = new Float32Array(mono.length)
    for (let c = 0; c < delays.length; c++) {
      const d = delays[c]
      const fb = gv * (0.98 + 0.005 * c)
      const line = new Float32Array(d)
      let idx = 0
      for (let i = 0; i < mono.length; i++) {
        const delayed = line[idx]
        out[i] += delayed / delays.length
        line[idx] = mono[i] + delayed * fb
        idx = (idx + 1) % d
      }
    }
    for (const d of allpassDelays) {
      const line = new Float32Array(d)
      let idx = 0
      for (let i = 0; i < mono.length; i++) {
        const delayed = line[idx]
        const v = out[i] + delayed * -0.5
        line[idx] = v
        out[i] = delayed + v * 0.5
        idx = (idx + 1) % d
      }
    }
    return out
  }
  const wetL = render(combDelays, g)
  const wetR = render(combDelays.map((d) => Math.round(d * 1.021)), g * 0.99)
  const left = new Float32Array(mono.length)
  const right = new Float32Array(mono.length)
  for (let i = 0; i < mono.length; i++) {
    left[i] = mono[i] + wetL[i] * mix
    right[i] = mono[i] + wetR[i] * mix
  }
  return [left, right]
}

/** 乒乓延迟（电子音色用），左右交替回声。 */
function pingPong(mono, { time = 0.16, feedback = 0.34, mix = 0.3 } = {}) {
  const d = sec(time)
  const left = new Float32Array(mono.length)
  const right = new Float32Array(mono.length)
  let amp = mix
  for (let tap = 1; tap <= 4; tap++) {
    const offset = d * tap
    const target = tap % 2 === 1 ? right : left
    for (let i = 0; i + offset < mono.length; i++) target[i + offset] += mono[i] * amp
    amp *= feedback
  }
  return [left, right]
}

/** 响度统一：按 RMS 拉到同一档，再限幅在 0.98 以内（避免某一类明显更响/更轻）。 */
function normalizePair(left, right, targetRms) {
  let sum = 0
  for (let i = 0; i < left.length; i++) sum += left[i] * left[i] + right[i] * right[i]
  const rms = Math.sqrt(sum / (left.length * 2)) || 1e-9
  const gain = targetRms / rms
  let peak = 0
  for (let i = 0; i < left.length; i++) {
    left[i] *= gain
    right[i] *= gain
    peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]))
  }
  const limiter = peak > 0.98 ? 0.98 / peak : 1
  for (let i = 0; i < left.length; i++) {
    left[i] *= limiter
    right[i] *= limiter
  }
  return { peak: peak * limiter, rms: rms * gain * limiter }
}

/**
 * 收尾：响度统一 → 限幅 → 首尾淡入淡出 → 按两声道较长的尾巴裁掉静音。
 * 四类音色的"响度感"靠这一步对齐，否则某一类会明显更吵。
 */
function finalize(left, right, targetRms) {
  const { peak, rms } = normalizePair(left, right, targetRms)
  fadeEdges(left)
  fadeEdges(right)
  let end = left.length - 1
  const quiet = (i) => Math.abs(left[i]) < 0.0012 && Math.abs(right[i]) < 0.0012
  while (end > 0 && quiet(end)) end--
  const keep = Math.min(left.length, end + sec(0.02))
  return { left: left.slice(0, keep), right: right.slice(0, keep), peak, rms }
}

/* ============================ 四个音色 ============================ */

function renderDing() {
  // 木质马林巴双音上行 C5 → G5（音程与原来一致，换成"木头 + 钟琴"的厚度）
  const mono = empty(1.1)
  addMarimba(mono, 0.0, 523.25, 0.9, 0.34, { click: 0.13, seed: 3 })
  addMarimba(mono, 0.145, 783.99, 0.85, 0.42, { click: 0.12, seed: 5 })
  // 轻钟琴泛音层：只在上方叠一点亮色，不抢木质主体
  addBell(mono, 0.0, 1046.5, 0.1, 0.5, { index: 1.6, indexTau: 0.05 })
  addBell(mono, 0.145, 1567.98, 0.11, 0.6, { index: 1.5, indexTau: 0.05 })
  // 低八度垫底，避免单薄
  addSine(mono, 0.0, 261.63, 0.16, 0.004, 0.3)
  addSine(mono, 0.145, 392.0, 0.14, 0.004, 0.34)
  const [l, r] = reverb(mono, { mix: 0.3, rt60: 0.6, spread: 1 })
  return finalize(l, r, 0.105)
}

function renderTap() {
  // 木质轻点：两声短促上行（B5 → E6），像"问一句"
  const mono = empty(0.6)
  addMarimba(mono, 0.0, 987.77, 0.85, 0.075, { click: 0.22, seed: 11 })
  addMarimba(mono, 0.115, 1318.51, 0.8, 0.085, { click: 0.2, seed: 13 })
  addSine(mono, 0.0, 493.88, 0.1, 0.002, 0.06)
  addSine(mono, 0.115, 659.25, 0.1, 0.002, 0.07)
  const [l, r] = reverb(mono, { mix: 0.2, rt60: 0.35, spread: 1 })
  return finalize(l, r, 0.1)
}

function renderAlarm() {
  // 电子 FM pluck 三音上行（审批是阻断事件，要清亮、有存在感）+ 乒乓延迟
  const mono = empty(1.2)
  const notes = [
    [0.0, 880.0, 0.85, 0.2],
    [0.14, 1174.66, 0.85, 0.2],
    [0.3, 1567.98, 0.9, 0.34],
  ]
  for (const [at, f, amp, tau] of notes) {
    addFmPluck(mono, at, f, amp, tau, { ratio: 2, index: 4.6, indexTau: 0.05 })
    addSine(mono, at, f / 2, amp * 0.3, 0.004, tau * 1.1) // 低八度垫底，防止"尖而薄"
  }
  const [dl, dr] = pingPong(mono, { time: 0.15, feedback: 0.32, mix: 0.26 })
  const [l, r] = reverb(mono, { mix: 0.22, rt60: 0.4, spread: 1 })
  for (let i = 0; i < l.length; i++) {
    l[i] += dl[i]
    r[i] += dr[i]
  }
  return finalize(l, r, 0.1)
}

function renderFault() {
  // 重低音双打击：厚锯齿 + 低八度 + 软饱和 + 噪声瞬态，向下走（G3 → C3）
  const mono = empty(1.3)
  const hits = [
    [0.0, 196.0, 1.0, 0.26, 21],
    [0.2, 130.81, 1.05, 0.5, 23],
  ]
  for (const [at, f, amp, tau, seed] of hits) {
    addThickSaw(mono, at, f, amp, tau, { harmonics: 14, detune: 0.005, sub: 0.45 })
    addNoiseHit(mono, at, amp * 0.22, 0.035, { smooth: 0.5, seed })
    addSine(mono, at, f / 2, amp * 0.5, 0.005, tau * 1.2) // 真正的"胸口"低频
  }
  saturate(mono, 1.7)
  const [l, r] = reverb(mono, { mix: 0.16, rt60: 0.5, spread: 1 })
  return finalize(l, r, 0.125)
}

const CUES = { ding: renderDing, tap: renderTap, alarm: renderAlarm, fault: renderFault }

/* ============================ WAV 写出 + mp3 编码 ============================ */

/** 写 16-bit PCM WAV（交错立体声）。 */
function writeWav(path, left, right) {
  const frames = left.length
  const dataBytes = frames * 2 * 2
  const buf = Buffer.alloc(44 + dataBytes)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + dataBytes, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20) // PCM
  buf.writeUInt16LE(2, 22) // 立体声
  buf.writeUInt32LE(SR, 24)
  buf.writeUInt32LE(SR * 2 * 2, 28)
  buf.writeUInt16LE(4, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(dataBytes, 40)
  let o = 44
  for (let i = 0; i < frames; i++) {
    for (const ch of [left, right]) {
      const v = Math.max(-1, Math.min(1, ch[i]))
      buf.writeInt16LE(Math.round(v * 32767), o)
      o += 2
    }
  }
  writeFileSync(path, buf)
}

/**
 * 用 ffmpeg 的 EBU R128 测「整体响度」（LUFS）。
 * 四类音色频段差异大（fault 全是低频、alarm 全是中高频），只按 RMS 对齐会让人耳觉得
 * 「低频那条明显更轻」，所以最终按 LUFS 拉齐——这是能客观对齐感知响度的最省事做法。
 */
function measureLufs(wavPath) {
  const out = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', wavPath, '-af', 'ebur128', '-f', 'null', '-'], { encoding: 'utf8' })
  if (out.error || out.status !== 0) throw new Error(`ffmpeg 测响度失败：${out.error ? out.error.message : `exit ${out.status}`}`)
  const text = `${out.stderr ?? ''}${out.stdout ?? ''}`
  const matches = [...text.matchAll(/I:\s*(-?\d+(?:\.\d+)?)\s*LUFS/g)]
  if (matches.length === 0) return null
  return Number(matches[matches.length - 1][1])
}

/** 保持峰值上限的前提下整体缩放一对声道。 */
function applyGain(left, right, gain) {
  let peak = 0
  for (let i = 0; i < left.length; i++) {
    left[i] *= gain
    right[i] *= gain
    peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]))
  }
  return peak
}

const wavDir = join(tmpdir(), 'dsh-alert-sounds-audio')
rmSync(wavDir, { recursive: true, force: true })
mkdirSync(wavDir, { recursive: true })
mkdirSync(OUT_DIR, { recursive: true })

const TARGET_LUFS = -17

const report = []
for (const [id, render] of Object.entries(CUES)) {
  const { left, right, peak } = render()
  const wavPath = join(wavDir, `${id}.wav`)
  writeWav(wavPath, left, right)

  /* ---- 按 LUFS 对齐响度：低频那条不会被 RMS 口径冤枉成"更轻" ---- */
  const measured = measureLufs(wavPath)
  let finalPeak = peak
  if (measured !== null) {
    let gain = Math.pow(10, (TARGET_LUFS - measured) / 20)
    const headroom = 0.98 / (peak || 1) // 峰值不许超过 0.98
    gain = Math.min(gain, headroom)
    finalPeak = applyGain(left, right, gain)
    writeWav(wavPath, left, right)
  }

  const mp3Path = join(OUT_DIR, `${id}.mp3`)
  const enc = spawnSync('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-i', wavPath,
    '-codec:a', 'libmp3lame', '-b:a', '96k', '-ar', String(SR), '-ac', '2',
    '-map_metadata', '-1',
    mp3Path,
  ], { stdio: 'inherit' })
  if (enc.error || enc.status !== 0) {
    throw new Error(`ffmpeg 编码失败（${id}）：${enc.error ? enc.error.message : `exit ${enc.status}`}。请先安装 ffmpeg。`)
  }
  if (KEEP_WAV) writeFileSync(join(OUT_DIR, `${id}.wav`), readFileSync(wavPath))
  const lufs = measureLufs(mp3Path)
  report.push({
    id,
    seconds: (left.length / SR).toFixed(2),
    peak: finalPeak.toFixed(3),
    lufs: lufs === null ? '—' : lufs.toFixed(1),
    mp3KB: (statSync(mp3Path).size / 1024).toFixed(1),
  })
}

console.log('渲染完成 → assets/audio/')
for (const row of report) {
  console.log(`  ${row.id.padEnd(6)} ${row.seconds}s  峰值 ${row.peak}  响度 ${row.lufs} LUFS  → ${row.mp3KB} KB`)
}
if (!KEEP_WAV) console.log('（中间 WAV 已清理；加 --keep-wav 可保留）')
