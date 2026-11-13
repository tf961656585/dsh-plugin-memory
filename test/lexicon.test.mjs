import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { MemoryStore } from '../lib/store.js'
import { buildLexicon, canonText, parseLexiconText } from '../lib/contract.js'

function fakeContext() {
  return { logger: { warn() {}, info() {}, debug() {} }, get() { return undefined } }
}

function renderEntry({ id, title, trigger = '日常', content = '内容' }) {
  return [
    `## 2026-10-01 — ${title}`,
    '',
    `- id: ${id}`,
    '- 类型: 踩坑',
    '- 作用域: project',
    `- 触发: ${trigger}`,
    '- 证据: 本轮对话',
    '- 捕获于: 2026-10-01',
    '- 失效条件: 无',
    `- 内容: ${content}`,
    '',
    '',
  ].join('\n')
}

function workspace({ lexicon = '# 词表\n\n- 素材 = 贴图\n', entries = [] } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'dsh-memory-lexicon-'))
  const mem = path.join(root, 'memory')
  mkdirSync(mem, { recursive: true })
  writeFileSync(path.join(mem, 'MEMORY.md'), '# MEMORY\n<!-- memory-schema: 3 -->\n\n## 条目\n\n（无）\n')
  writeFileSync(path.join(mem, 'lexicon.md'), lexicon)
  writeFileSync(path.join(mem, 'pitfalls.md'), entries.map(renderEntry).join(''))
  return { root, mem, store: new MemoryStore(fakeContext()) }
}

const assetEntry = {
  id: 'asset-meta',
  title: '素材入库要写元信息',
  trigger: '写 meta.yaml 的 prompt 时',
  content: '图片必须与 meta 文件成对；素材入库后跑校验。',
}

test('add appends an alias to a group and keeps the provenance note', async () => {
  const { root, mem, store } = workspace({ entries: [assetEntry] })
  const result = await store.lexiconAdd(root, {
    canonical: '素材',
    aliases: ['美术图'],
    evidence: '美术图要不要成对',
  })
  assert.deepEqual(result.added, ['美术图'])
  assert.equal(result.created, false)
  const text = readFileSync(path.join(mem, 'lexicon.md'), 'utf8')
  assert.match(text, /- 素材 = 贴图, 美术图/)
  assert.match(text, /# \d{4}-\d{2}-\d{2} 新增：美术图（漏检：美术图要不要成对）/)
})

test('add refuses a canonical wording that never appears in the corpus', async () => {
  const { root, store } = workspace({ entries: [assetEntry] })
  await assert.rejects(
    store.lexiconAdd(root, { canonical: '存档', aliases: ['存盘'], evidence: '存档读一下' }),
    /一次也没出现/,
  )
})

test('add refuses an alias that would rewrite too many entries without the canonical word', async () => {
  const entries = [
    { id: 'gate', title: '门禁报红', content: '门禁规则' },
    ...Array.from({ length: 11 }, (_, index) => ({
      id: `lint-${index}`,
      title: `校验口径 ${index}`,
      content: `第 ${index} 条校验规则。`,
    })),
  ]
  const { root, mem, store } = workspace({ entries })
  const before = readFileSync(path.join(mem, 'lexicon.md'), 'utf8')
  await assert.rejects(
    store.lexiconAdd(root, { canonical: '门禁', aliases: ['校验'], evidence: '校验没过' }),
    /超过上限 10/,
  )
  assert.equal(readFileSync(path.join(mem, 'lexicon.md'), 'utf8'), before)
})

test('force with a reason is the documented reflect escape hatch', async () => {
  const { root, store } = workspace({
    entries: [
      { id: 'gate', title: '门禁', content: '门禁规则' },
      ...Array.from({ length: 11 }, (_, index) => ({
        id: `lint-${index}`,
        title: `校验口径 ${index}`,
        content: `第 ${index} 条校验规则。`,
      })),
    ],
  })
  const result = await store.lexiconAdd(root, {
    canonical: '门禁',
    aliases: ['校验'],
    evidence: '校验',
    force: true,
    reason: '宽口径是用户拍板的',
  })
  assert.equal(result.forced, true)
  assert.deepEqual(result.added, ['校验'])
})

test('add rejects a short alias and leaves an already mapped alias untouched', async () => {
  const { root, store } = workspace({ entries: [assetEntry] })
  await assert.rejects(
    store.lexiconAdd(root, { canonical: '素材', aliases: ['图'], evidence: '图' }),
    /太短/,
  )
  const same = await store.lexiconAdd(root, { canonical: '素材', aliases: ['贴图'], evidence: '贴图' })
  assert.deepEqual(same.added, [])
  assert.match(same.message, /已经在「素材」/)
})

test('remove narrows one alias and needs a reason', async () => {
  const { root, mem, store } = workspace({ entries: [assetEntry] })
  await assert.rejects(
    store.lexiconRemove(root, { canonical: '素材', alias: '贴图' }),
    /需要 reason/,
  )
  await store.lexiconAdd(root, { canonical: '素材', aliases: ['美术图'], evidence: '美术图' })
  const result = await store.lexiconRemove(root, {
    canonical: '素材',
    alias: '美术图',
    reason: '和「贴图」重叠，收窄',
  })
  assert.equal(result.droppedGroup, false)
  const text = readFileSync(path.join(mem, 'lexicon.md'), 'utf8')
  assert.match(text, /- 素材 = 贴图/)
  assert.ok(!text.includes('美术图'))
})

test('removing the last alias drops the group line and its provenance note', async () => {
  const { root, mem, store } = workspace({
    entries: [assetEntry],
    lexicon: '# 词表\n\n# 2026-10-01 新增：美术（漏检：美术图）\n- 美术 = 美术图\n',
  })
  const result = await store.lexiconRemove(root, {
    canonical: '美术',
    alias: '美术图',
    reason: '不是同义',
  })
  assert.equal(result.droppedGroup, true)
  const text = readFileSync(path.join(mem, 'lexicon.md'), 'utf8')
  assert.ok(!text.includes('- 美术 ='))
  assert.ok(!text.includes('漏检：美术图'))
})

test('check reports the normalized query and the hits', async () => {
  const { root, store } = workspace({ entries: [assetEntry] })
  const [row] = store.lexiconCheck(root, ['贴图 成对'])
  assert.match(row.normalized, /素材/)
  assert.deepEqual(row.hits.map((hit) => hit.ref), ['pitfalls.md#asset-meta'])
})

test('list exposes risk readings over the corpus', async () => {
  const { root, store } = workspace({
    entries: [
      { id: 'gate', title: '门禁报红', content: '门禁规则' },
      { id: 'lint', title: '校验器', content: '校验器用 existsSync' },
    ],
    lexicon: '# 词表\n\n- 门禁 = 校验\n',
  })
  const report = store.lexiconReport(root)
  assert.equal(report.groups.length, 1)
  assert.equal(report.groups[0].aliases[0].affected, 1)
  assert.equal(report.risky.length, 0)
})

test('canonicalization is single-pass: a produced canonical is never rewritten again', () => {
  const lexicon = buildLexicon(parseLexiconText('- 素材 = asset\n- asset-meta = asset_meta.py\n').groups)
  assert.equal(canonText('asset_meta.py 报错', lexicon), 'asset-meta 报错')
  assert.equal(canonText('asset-meta 报错', lexicon), 'asset-meta 报错')
})
