import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { MemoryStore } from '../lib/store.js'
import {
  buildLexicon,
  canonText,
  parseLexiconText,
  rankEntries,
  tokensOf,
} from '../lib/contract.js'

const ENTRY = (overrides) => ({
  file: 'pitfalls.md',
  type: '踩坑',
  scope: 'project',
  date: '2026-10-01',
  hook: '',
  trigger: '',
  evidence: '本轮对话',
  captured: '2026-10-01',
  invalidation: '场景改变',
  stale: false,
  problems: [],
  ...overrides,
})

const ENTRIES = [
  ENTRY({ id: 'hit', title: '技能打不中敌人时先查命中链路', hook: '技能打不中敌人', content: '攻击源命中判定要跑碰撞冒烟，实机目视容易假阴性。' }),
  ENTRY({ id: 'asset', title: '素材入库要写元信息', hook: '素材入库', content: '素材必须与 meta 文件成对。' }),
  ENTRY({ id: 'map', title: '地图看起来像贴纸', content: '地图形状载体比贴图材质更重要。' }),
  ENTRY({ id: 'pack', title: '背包容量上限', content: '背包上限来自局外成长。' }),
]

test('recall matches entry content, not only the title', () => {
  const hits = rankEntries(ENTRIES, '技能打不中')
  assert.deepEqual(hits.map((hit) => hit.entry.id), ['hit'])
  assert.ok(hits[0].matched.length > 0)
})

test('recall rejects unrelated chatter', () => {
  for (const query of ['今天天气怎么样', '帮我写一份周报', '中午吃什么']) {
    assert.deepEqual(rankEntries(ENTRIES, query), [], query)
  }
})

test('short queries fall back to a low threshold and a small limit', () => {
  const hits = rankEntries(ENTRIES, '素材')
  assert.equal(hits.length, 1)
  assert.equal(hits[0].entry.id, 'asset')
  assert.equal(hits[0].short, true)
})

test('a file path is decisive on its own', () => {
  const withPath = ENTRIES.map((entry) => (entry.id === 'hit' ? { ...entry, evidence: 'src/combat/attack-source.ts:12' } : entry))
  const hits = rankEntries(withPath, '看下 src/combat/attack-source.ts')
  assert.equal(hits[0].entry.id, 'hit')
  assert.ok(hits[0].strongHits > 0)
})

test('lexicon maps user wording onto the stored wording', () => {
  const parsed = parseLexiconText('# 词表\n\n- 素材 = 图片, 贴图\n')
  assert.equal(parsed.groups.length, 1)
  const lexicon = buildLexicon(parsed.groups)
  assert.equal(canonText('这些图片要换', lexicon), '这些素材要换')
  assert.deepEqual(rankEntries(ENTRIES, '图片'), [])
  const hits = rankEntries(ENTRIES, '图片', 8, false, lexicon)
  assert.equal(hits[0].entry.id, 'asset')
})

test('lexicon parser reports unusable lines and duplicates', () => {
  const parsed = parseLexiconText([
    '# 词表',
    '- 素材 = 图片, 贴图',
    '- 素材 = 资源',
    '- 地图 = 图片',
    '- 这不是一行词表',
    '- 背包 =',
  ].join('\n'))
  assert.equal(parsed.groups.length, 2)
  assert.ok(parsed.issues.some((issue) => issue.code === 'lexicon-duplicate-canonical'))
  assert.ok(parsed.issues.some((issue) => issue.code === 'lexicon-duplicate-term'))
  assert.ok(parsed.issues.some((issue) => issue.code === 'lexicon-line'))
  assert.ok(parsed.issues.some((issue) => issue.code === 'lexicon-empty'))
})

test('the lexicon file stays out of the entry scan and feeds recall', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'dsh-memory-lexicon-'))
  const mem = path.join(root, 'memory')
  mkdirSync(mem, { recursive: true })
  writeFileSync(path.join(mem, 'lexicon.md'), '# 词表\n\n- 素材 = 图片\n')
  writeFileSync(path.join(mem, 'pitfalls.md'), [
    '## 2026-10-01 — 素材入库要写元信息',
    '',
    '- id: asset',
    '- 类型: 踩坑',
    '- 作用域: project',
    '- 触发: 素材入库时',
    '- 证据: 本轮对话',
    '- 捕获于: 2026-10-01',
    '- 失效条件: 流程改变',
    '- 内容: 素材与 meta 成对',
    '',
  ].join('\n'))
  const store = new MemoryStore({ logger: { warn() {} }, get: () => undefined })
  const loaded = store.load(root)
  assert.deepEqual(loaded.topicFiles, ['pitfalls.md'])
  assert.equal(loaded.entries.length, 1)
  assert.equal(loaded.lexiconGroups.length, 1)
  assert.deepEqual(loaded.lexiconIssues, [])
  const hits = store.recall(root, '图片')
  assert.deepEqual(hits.map((hit) => hit.entry.id), ['asset'])
})

test('tokens keep both raw and canonical spellings', () => {
  const lexicon = buildLexicon(parseLexiconText('- 素材 = 图片\n').groups)
  const tokens = tokensOf('图片入库', lexicon)
  assert.ok(tokens.grams.has('图片') === false)
  assert.ok(tokens.grams.has('素材'))
})

test('short queries keep the lenient threshold when the lexicon expands them', () => {
  const lexicon = buildLexicon(parseLexiconText('- 素材 = 图片, 贴图\n- 升级 = 三选一\n').groups)
  const entries = [
    ENTRY({ id: 'asset', title: '素材入库要写元信息', content: '素材必须与 meta 文件成对。' }),
    ENTRY({ id: 'levelup', title: '升级面板读技能文案', content: '升级面板的文案来自配置表。' }),
  ]
  const canonical = rankEntries(entries, '素材 升级', 8, false, lexicon)
  const colloquial = rankEntries(entries, '贴图 三选一', 8, false, lexicon)
  assert.ok(canonical.length > 0)
  assert.deepEqual(colloquial.map((hit) => hit.entry.id), canonical.map((hit) => hit.entry.id))
  assert.ok(colloquial.every((hit) => hit.short))
})

test('automatic recall ignores generic phrases and keeps trigger matches', () => {
  const filler = Array.from({ length: 200 }, (_, index) => ENTRY({
    id: `filler-${index}`,
    title: `无关条目 ${index}`,
    content: `无关内容 ${index}。`,
  }))
  const entries = [
    ...filler,
    ENTRY({ id: 'vite', title: '改 vite.config 时重启', hook: '改 vite.config 时', content: '保存后要重启。' }),
    ENTRY({ id: 'editor', title: '碰撞编辑器改高度不生效', hook: '碰撞编辑器改高度不生效时', content: '要先改资产条目。' }),
    ENTRY({ id: 'noise', title: '改资源目录时别动缓存', hook: '改资源目录时', content: '改完一切正常也要清理缓存，不要做任何编辑之外的改动。' }),
  ]
  // A generic phrase sitting in one entry's body is not a trigger.
  for (const query of ['一切正常', '不做任何编辑', '不要做任何修改']) {
    assert.deepEqual(rankEntries(entries, query, 6, true), [], query)
  }
  // Manual search still finds the body match; only injection is gated.
  assert.deepEqual(rankEntries(entries, '一切正常', 6, false).map((hit) => hit.entry.id), ['noise'])
  // A real trigger match still injects.
  assert.deepEqual(rankEntries(entries, '碰撞编辑器改高度不生效', 6, true).map((hit) => hit.entry.id), ['editor'])
  assert.deepEqual(rankEntries(entries, '改 vite.config 时重启', 6, true).map((hit) => hit.entry.id), ['vite'])
})

test('list markers and bare numbers never become recall tokens', () => {
  const tokens = tokensOf('1. 打开编辑器 3. 保存 v24.13.0')
  assert.ok(!tokens.words.has('3.'))
  assert.ok(!tokens.words.has('1.'))
  assert.ok(tokens.grams.has('编辑'))
  assert.ok(tokens.words.has('v24.13.0'))
})
