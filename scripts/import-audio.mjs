/**
 * dsh-alert-sounds — 把外部音频素材导入成内置音色（`assets/audio/<id>.mp3`）
 *
 * 背景：内置音色现在是**离线渲染/导入的真实音频**（见 README「音色」一节）。素材换新时用本脚本：
 *   1. 按文件名里的关键字认出它属于哪一类（需要审批 → alarm，需要回答 → tap，输出完成 → ding，
 *      发生错误 → fault，卡住 → stall），**前后缀随你写**（`01-`、`-提示音`、空格都会被忽略）；
 *   2. 裁掉首尾静音（素材常带 0.1~0.4s 空白，留着会让人觉得"提醒慢半拍"）；
 *   3. 统一响度：五段测同一个指标，拉到同一档，避免"某一类特别吵 / 特别轻"；
 *   4. 编码成 mp3 96kbps 立体声 → `assets/audio/<id>.mp3`（**要入库**，构建与 CI 靠它复现 lib/）。
 *
 * 响度指标为什么不用 ffmpeg 的 EBU R128 积分值：**太短的素材（比如 0.33s 的那条）会被
 * 400ms 门限整段滤掉，测出 -70 LUFS 这种没意义的值**。这里改用「高通后 + 门限 RMS」：
 * 对任意长度都稳定，五段之间可比。目标值 DEFAULT_TARGET 是拿旧的 −17.5 LUFS 那套音色标定过的。
 *
 * 依赖：ffmpeg。用法：
 *   node scripts/import-audio.mjs "/path/to/素材目录"        # 导入（关键字匹配，缺哪个会报错）
 *   node scripts/import-audio.mjs --measure a.mp3 b.wav      # 只测响度指标（校准/排查用）
 *   node scripts/import-audio.mjs --target 0.09 <目录>        # 手动指定目标（缺省见 DEFAULT_TARGET）
 */
import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(ROOT, 'assets', 'audio')
const SR = 44100

/** 关键字 → 音色 id。素材文件名里带上中文类别即可（前后缀随便）。 */
const MATCHERS = [
  { id: 'alarm', words: ['审批', 'approval'] },
  { id: 'tap', words: ['回答', '提问', 'question', 'answer'] },
  { id: 'ding', words: ['完成', '输出完成', 'done', 'complete'] },
  { id: 'fault', words: ['错误', '出错', 'error', 'failed'] },
  { id: 'stall', words: ['卡住', '停滞', 'stall', 'stalled'] },
]
const ALL_IDS = MATCHERS.map((m) => m.id)

/**
 * 目标响度（门限 RMS，线性）。这个数是拿**旧的、已按 −17.5 LUFS 对齐**的那套内置音色标定出来的
 * ——换素材时保持同一档，用户听起来才不会有"怎么突然变响了"的感觉。
 */
const DEFAULT_TARGET = 0.087

/** 第二遍校正用的目标积分响度：与上一套内置音色一致（−17.5 LUFS），换素材不该让人"觉得突然变响"。 */
const TARGET_LUFS = -17.5

const args = process.argv.slice(2)
const measureMode = args.includes('--measure')
const targetIndex = args.indexOf('--target')
const TARGET = targetIndex >= 0 ? Number(args[targetIndex + 1]) : DEFAULT_TARGET

/* ============================ 响度指标 ============================ */

function ffmpegF32(input, extraArgs = []) {
  const out = spawnSync('ffmpeg', ['-v', 'error', '-i', input, ...extraArgs, '-f', 'f32le', '-ac', '2', '-ar', String(SR), '-'], { maxBuffer: 1 << 30 })
  if (out.error || out.status !== 0) {
    throw new Error(`ffmpeg 解码失败（${input}）：${out.error ? out.error.message : String(out.stderr).slice(-400)}`)
  }
  const buf = out.stdout
  return new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4))
}

/**
 * 「高通 + 门限 RMS」：对短素材也稳。
 *  - 一阶高通（~120Hz）抹掉低频轰鸣，大致贴近人耳对响度的加权；
 *  - 50ms 帧、25ms 跳步，只统计高于门限的帧（门限 = max(-45dBFS, 峰值帧 - 35dB)），
 *    这样首尾残留的底噪/混响尾巴不会把结果拉低。
 */
function loudnessMetric(samples) {
  const hp = new Float32Array(samples.length)
  const dt = 1 / SR
  const rc = 1 / (2 * Math.PI * 120)
  const a = rc / (rc + dt)
  let prevIn = 0
  let prevOut = 0
  for (let i = 0; i < samples.length; i++) {
    // 交错立体声：只取左声道参与测量（五段素材声道结构一致，可比性够了）
    if (i % 2 === 1) continue
    const x = samples[i]
    const y = a * (prevOut + x - prevIn)
    prevIn = x
    prevOut = y
    hp[i] = y
  }
  const frame = Math.round(0.05 * SR) * 2
  const hop = Math.round(0.025 * SR) * 2
  const frames = []
  let peakFrame = 0
  for (let start = 0; start + frame <= hp.length; start += hop) {
    let sum = 0
    let n = 0
    for (let i = start; i < start + frame; i += 2) { sum += hp[i] * hp[i]; n += 1 }
    const rms = Math.sqrt(sum / Math.max(1, n))
    frames.push(rms)
    if (rms > peakFrame) peakFrame = rms
  }
  if (frames.length === 0) {
    // 比一帧还短：整段直接算
    let sum = 0
    let n = 0
    for (let i = 0; i < hp.length; i += 2) { sum += hp[i] * hp[i]; n += 1 }
    return Math.sqrt(sum / Math.max(1, n))
  }
  const gate = Math.max(10 ** (-45 / 20), peakFrame * 10 ** (-35 / 20))
  let sum = 0
  let kept = 0
  for (const rms of frames) {
    if (rms >= gate) { sum += rms * rms; kept += 1 }
  }
  if (kept === 0) return peakFrame
  return Math.sqrt(sum / kept)
}

function peakOf(samples) {
  let peak = 0
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]))
  return peak
}

function durationOf(file) {
  const out = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], { encoding: 'utf8' })
  return Number(String(out.stdout).trim())
}

/** EBU R128 积分响度（LUFS）；素材太短时会被 400ms 门限整段滤掉 → 返回 null。 */
function measureLufs(file) {
  const out = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128', '-f', 'null', '-'], { encoding: 'utf8' })
  const text = `${out.stderr ?? ''}${out.stdout ?? ''}`
  const matches = [...text.matchAll(/I:\s*(-?\d+(?:\.\d+)?)\s*LUFS/g)]
  if (matches.length === 0) return null
  const value = Number(matches[matches.length - 1][1])
  return value <= -60 ? null : value
}

/* ============================ 两档模式 ============================ */

if (measureMode) {
  const files = args.filter((a) => !a.startsWith('--') && a !== String(TARGET))
  console.log(`目标指标 ${TARGET}（模式 RMS，线性）\n`)
  for (const file of files) {
    const metric = loudnessMetric(ffmpegF32(file))
    const peak = peakOf(ffmpegF32(file))
    console.log(`  ${file.padEnd(58)} ${durationOf(file).toFixed(2)}s  指标 ${metric.toFixed(4)}  峰值 ${peak.toFixed(3)}`)
  }
  process.exit(0)
}

const srcDir = args.find((a) => !a.startsWith('--') && a !== String(TARGET))
if (!srcDir) {
  console.error('用法：node scripts/import-audio.mjs <素材目录>   （或 --measure <文件...>）')
  process.exit(1)
}

const AUDIO_EXT = /\.(wav|mp3|m4a|aac|flac|ogg|aiff?)$/i
const matched = {}
for (const name of readdirSync(srcDir).filter((n) => AUDIO_EXT.test(n)).sort()) {
  const hit = MATCHERS.find((m) => m.words.some((w) => name.includes(w)))
  if (!hit) { console.warn(`  · 跳过（认不出类别）：${name}`); continue }
  if (matched[hit.id]) throw new Error(`类别 ${hit.id} 匹配到多个文件：${matched[hit.id].name} 与 ${name}`)
  matched[hit.id] = { name, path: join(srcDir, name) }
}
const missing = ALL_IDS.filter((id) => !matched[id])
if (missing.length > 0) throw new Error(`这些类别没找到素材：${missing.join(', ')}（文件名里带上 审批/回答/完成/错误/卡住 即可）`)

const tmp = join(tmpdir(), 'dsh-alert-sounds-import')
rmSync(tmp, { recursive: true, force: true })
mkdirSync(tmp, { recursive: true })
mkdirSync(OUT_DIR, { recursive: true })

// 裁掉首尾静音：素材常带 0.1~0.4s 空白，留着会让人觉得"提醒慢半拍"
const TRIM = 'silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.015:detection=peak,areverse,silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.04:detection=peak,areverse'

console.log(`导入素材 → ${OUT_DIR}（目标指标 ${TARGET}，目标响度 ${TARGET_LUFS} LUFS）`)

/* 第一遍：裁剪 → 按指标给初增益 → 试编码 → 量 EBU R128 积分响度（太短的会测不出来） */
const plan = []
for (const id of ALL_IDS) {
  const { name, path } = matched[id]
  const trimmed = join(tmp, `${id}.wav`)
  const trim = spawnSync('ffmpeg', ['-y', '-v', 'error', '-i', path, '-ar', String(SR), '-ac', '2', '-af', TRIM, trimmed])
  if (trim.error || trim.status !== 0) throw new Error(`裁剪失败（${name}）：${trim.error ? trim.error.message : String(trim.stderr).slice(-300)}`)

  const samples = ffmpegF32(trimmed)
  const metric = loudnessMetric(samples)
  const peak = peakOf(samples)
  let gain = metric > 0 ? TARGET / metric : 1
  gain = Math.min(Math.max(gain, 10 ** (-15 / 20)), 10 ** (15 / 20)) // 最多 ±15dB，防素材本身有问题
  if (peak * gain > 0.98) gain = 0.98 / peak // 峰值不许削顶
  const gainDb = 20 * Math.log10(gain)

  const probe = join(tmp, `${id}.probe.mp3`)
  const enc = spawnSync('ffmpeg', ['-y', '-v', 'error', '-i', trimmed, '-af', `volume=${gainDb.toFixed(2)}dB`, '-codec:a', 'libmp3lame', '-b:a', '96k', '-ar', String(SR), '-ac', '2', probe])
  if (enc.error || enc.status !== 0) throw new Error(`试编码失败（${id}）：${enc.error ? enc.error.message : String(enc.stderr).slice(-300)}`)

  plan.push({ id, name, trimmed, metric, peak, gainDb, lufs: measureLufs(probe), seconds: durationOf(trimmed) })
}

/* 第二遍：按积分响度再校正一次——指标与 LUFS 在频谱差异大时会有出入（比如"审批"偏长音、
 * "卡住"偏打击），这一步把感知响度拉齐。太短测不出来的那条，套用其它几条的中位修正量。 */
const corrections = plan.filter((p) => p.lufs !== null).map((p) => TARGET_LUFS - p.lufs)
corrections.sort((a, b) => a - b)
const fallbackCorrection = corrections.length > 0 ? corrections[Math.floor(corrections.length / 2)] : 0

const report = []
for (const item of plan) {
  const correction = item.lufs === null ? fallbackCorrection : TARGET_LUFS - item.lufs
  let gainDb = item.gainDb + correction
  let gain = 10 ** (gainDb / 20)
  if (item.peak * gain > 0.98) { // 第二遍可能把峰值推过顶，回退到刚好不削顶
    gain = 0.98 / item.peak
    gainDb = 20 * Math.log10(gain)
  }
  const mp3 = join(OUT_DIR, `${item.id}.mp3`)
  const enc = spawnSync('ffmpeg', ['-y', '-v', 'error', '-i', item.trimmed, '-af', `volume=${gainDb.toFixed(2)}dB`, '-codec:a', 'libmp3lame', '-b:a', '96k', '-ar', String(SR), '-ac', '2', '-map_metadata', '-1', mp3])
  if (enc.error || enc.status !== 0) throw new Error(`编码失败（${item.id}）：${enc.error ? enc.error.message : String(enc.stderr).slice(-300)}`)
  report.push({
    id: item.id,
    name: item.name,
    seconds: item.seconds.toFixed(2),
    metric: item.metric.toFixed(4),
    gainDb,
    peak: (item.peak * gain).toFixed(3),
    lufs: measureLufs(mp3),
    kb: (statSync(mp3).size / 1024).toFixed(1),
  })
}

for (const row of report) {
  console.log(`  ${row.id.padEnd(6)} ← ${row.name}`)
  console.log(`        ${row.seconds}s  指标 ${row.metric}  增益 ${row.gainDb >= 0 ? '+' : ''}${row.gainDb.toFixed(1)}dB  峰值 ${row.peak}  响度 ${row.lufs === null ? '太短测不出' : `${row.lufs.toFixed(1)} LUFS`}  ${row.kb} KB`)
}
console.log('\n完成。接着跑：npm run build && npm test（lib/ 必须一起提交）')
