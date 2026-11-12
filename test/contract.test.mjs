import test from 'node:test'
import assert from 'node:assert/strict'
import {
  entryProblems,
  evidencePaths,
  parseIndexText,
  parseStaleText,
  parseTopicText,
  rankEntries,
  renderEntryData,
  renderIndexLines,
  rewriteSection,
} from '../lib/contract.js'

const SAMPLE = `# 踩坑

## 2026-10-22 — 示例条目

- id: sample
- 类型: 踩坑
- 作用域: project
- 钩子: 改 foo.ts 时
- 触发: 改 foo.ts 时
- 证据: src/foo.ts:12
- 捕获于: 2026-10-22
- 失效条件: foo.ts 删除
- 内容: 第一行
  第二行

## 2026-10-23 — 第二条

- id: second
- 类型: 决策
- 作用域: user
- 触发: 改 bar 时
- 证据: 本轮对话
- 捕获于: 2026-10-23
- 失效条件: bar 改完
- 内容: 结论
`

test('parses fields, multi-line content, and both entries', () => {
  const entries = parseTopicText('pitfalls.md', SAMPLE)
  assert.equal(entries.length, 2)
  assert.equal(entries[0].id, 'sample')
  assert.equal(entries[0].type, '踩坑')
  assert.equal(entries[0].content, '第一行\n第二行')
  assert.equal(entries[0].hook, '改 foo.ts 时')
  assert.deepEqual(entryProblems(entries[0]), [])
  assert.equal(entries[1].id, 'second')
  assert.equal(entries[1].type, '决策')
  assert.equal(entries[1].hook, '')
})

test('renderEntryData round-trips content', () => {
  const [entry] = parseTopicText('pitfalls.md', SAMPLE)
  const rendered = renderEntryData({
    id: entry.id,
    title: entry.title,
    type: entry.type,
    scope: entry.scope,
    hook: entry.hook,
    trigger: entry.trigger,
    evidence: entry.evidence,
    captured: entry.captured,
    invalidation: entry.invalidation,
    content: entry.content,
  })
  const [again] = parseTopicText('pitfalls.md', rendered)
  assert.equal(again.content, entry.content)
  assert.equal(again.title, entry.title)
  assert.deepEqual(entryProblems(again), [])
})

test('generates the index line and parses it back', () => {
  const [entry] = parseTopicText('pitfalls.md', SAMPLE)
  const lines = renderIndexLines([entry])
  assert.deepEqual(lines, ['- [踩坑] 2026-10-22 改 foo.ts 时 → pitfalls.md#sample'])
  const parsed = parseIndexText(`# MEMORY\n<!-- memory-schema: 3 -->\n\n## 条目\n\n${lines[0]}\n\n## 待确认提案\n\n（无）\n`)
  assert.equal(parsed.marker, 3)
  assert.deepEqual(parsed.entryLines, lines)
  assert.deepEqual(parsed.proposalLines, [])
})

test('rewrites one section and preserves the next', () => {
  const text = '# MEMORY\n\n## 主题文件\n\n- a.md — A\n\n## 条目\n\n- old\n\n## 待确认提案\n\n（无）\n'
  const next = rewriteSection(text, '条目', ['- new'])
  assert.match(next, /## 条目\n\n- new\n/)
  assert.match(next, /## 待确认提案/)
  assert.doesNotMatch(next, /- old/)
})

test('recall favors file signals and rejects unrelated wording', () => {
  const entries = parseTopicText('pitfalls.md', SAMPLE)
  const hit = rankEntries(entries, '改 src/foo.ts 时遇到报错')
  assert.equal(hit.length, 1)
  assert.equal(hit[0].entry.id, 'sample')
  const miss = rankEntries(entries, '把首页配色改成蓝色')
  assert.equal(miss.length, 0)
})

test('extracts evidence references but skips URLs and bare names', () => {
  const found = evidencePaths('见 src/foo.ts:12；也见 src/package.json 第 7 行；https://x.test/a.ts:3；README')
  assert.deepEqual(found.map((item) => item.path), ['src/foo.ts', 'src/package.json'])
})

test('flags missing fields and reserved hooks', () => {
  const [entry] = parseTopicText('pitfalls.md', SAMPLE)
  const broken = { ...entry, hook: 'a → b', fields: { ...entry.fields, 证据: '' } }
  broken.id = entry.id
  const problems = entryProblems(broken)
  assert.ok(problems.some((problem) => problem.code === 'missing-field'))
  assert.ok(problems.some((problem) => problem.code === 'hook-reserved'))
})

test('parses stale lines and reports malformed ones', () => {
  const parsed = parseStaleText('# 待清理\n\n- 2026-10-22 pitfalls.md#sample — foo.ts 已删除\n- 自然语言行\n（无）\n')
  assert.equal(parsed.records.length, 1)
  assert.equal(parsed.records[0].id, 'sample')
  assert.equal(parsed.malformed.length, 1)
})
