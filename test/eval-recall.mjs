/**
 * Recall quality report against one real memory library.
 *
 * Usage:
 *   node test/eval-recall.mjs <projectRoot> [fixture.json] [--no-lexicon] [--auto]
 *
 * The fixture shape is `{ positives: [{ q, ids }], negatives: [q], auto: [q] }`.
 * Prints hit@1 / hit@3 / noise counts plus every miss, so one scoring change
 * can be compared against the previous run on the same corpus.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { MemoryStore } from '../lib/store.js'
import { RECALL, buildLexicon, parseLexiconText, rankEntries } from '../lib/contract.js'

const RECALL_MANUAL = RECALL.manualThreshold
const RECALL_AUTO = RECALL.autoThreshold

const args = process.argv.slice(2)
const flags = new Set(args.filter((arg) => arg.startsWith('--')))
const positional = args.filter((arg) => !arg.startsWith('--'))
const [rootArg, fixtureArg] = positional

if (rootArg === undefined) {
  console.error('用法：node test/eval-recall.mjs <项目根> [fixture.json] [--no-lexicon] [--auto]')
  process.exit(1)
}

const store = new MemoryStore({ logger: { warn() {} }, get: () => undefined })
const loaded = store.load(path.resolve(rootArg))
if (!loaded.exists) {
  console.error(`没有找到 ${path.resolve(rootArg)}/memory`)
  process.exit(1)
}

const lexicon = flags.has('--no-lexicon')
  ? null
  : buildLexicon(parseLexiconText(readFileSync(path.join(loaded.mem, 'lexicon.md'), 'utf8')).groups)

const fixture = fixtureArg === undefined
  ? null
  : JSON.parse(readFileSync(fixtureArg, 'utf8'))

if (fixture === null) {
  console.log(`记忆库：${loaded.entries.length} 条`)
  process.exit(0)
}

const auto = flags.has('--auto')
const limit = auto ? 5 : 3
const threshold = auto ? RECALL_AUTO : RECALL_MANUAL

if (fixture !== null && auto && Array.isArray(fixture.auto)) {
  console.log(`自动召回自测：${loaded.entries.length} 条；阈值 ${threshold}`)
  console.log('')
  let fired = 0
  for (const q of fixture.auto) {
    const hits = rankEntries(loaded.entries, q, limit, true, lexicon)
    if (hits.length > 0) fired += 1
    console.log(`${hits.length > 0 ? '触发' : '不触发'} ${q.slice(0, 26)}  →  ${hits.map((hit) => `${hit.entry.id}:${Math.round(hit.score)}`).join(', ') || '—'}`)
  }
  console.log('')
  console.log(`自动召回：${fired}/${fixture.auto.length} 条任务消息触发`)
  const noise = fixture.autoNoise ?? []
  if (noise.length > 0) {
    let noiseHits = 0
    for (const q of noise) {
      const hits = rankEntries(loaded.entries, q, limit, true, lexicon)
      if (hits.length > 0) {
        noiseHits += 1
        console.log(`✗ 误触发 ${q.slice(0, 26)}  →  ${hits.map((hit) => `${hit.entry.id}:${Math.round(hit.score)}`).join(', ')}`)
      }
    }
    console.log(`自动召回误触发：${noiseHits}/${noise.length}`)
  }
  process.exit(0)
}

let hit1 = 0
let hit3 = 0
const misses = []

console.log(`记忆库：${loaded.entries.length} 条；词表：${lexicon === null ? '关（--no-lexicon）' : `${loaded.lexiconGroups.length} 组`}；${auto ? '自动召回' : '手动检索'}（阈值 ${threshold}）`)
console.log('')
for (const item of fixture.positives ?? []) {
  const hits = rankEntries(loaded.entries, item.q, limit, auto, lexicon)
  const ids = hits.map((hit) => hit.entry.id)
  const rank = ids.findIndex((id) => item.ids.includes(id))
  const pass = rank >= 0
  if (pass && rank === 0) hit1 += 1
  if (pass) hit3 += 1
  else misses.push({ q: item.q, expected: item.ids, got: ids })
  console.log(`${pass ? '✓' : '✗'} ${item.q}  →  ${ids.map((id, index) => (item.ids.includes(id) ? `[${id}]` : id)).join(', ') || '（无命中）'}`)
}

console.log('')
let noise = 0
for (const q of fixture.negatives ?? []) {
  const hits = rankEntries(loaded.entries, q, limit, auto, lexicon)
  if (hits.length > 0) {
    noise += 1
    console.log(`✗ 误命中 ${q}  →  ${hits.map((hit) => `${hit.entry.id}:${Math.round(hit.score)}`).join(', ')}`)
  }
}

const positives = (fixture.positives ?? []).length
console.log('')
console.log(`命中：前 1 ${hit1}/${positives}，前 3 ${hit3}/${positives}；误命中 ${noise}/${(fixture.negatives ?? []).length}`)
for (const miss of misses) console.log(`漏检：${miss.q} 期望 ${miss.expected.join('/')}，实际 ${miss.got.join('/') || '无'}`)
