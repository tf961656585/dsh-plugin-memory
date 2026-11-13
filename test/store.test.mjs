import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { MemoryStore } from '../lib/store.js'

function fakeContext() {
  return {
    logger: { warn() {}, info() {}, debug() {} },
    get() { return undefined },
  }
}

function workspace() {
  const root = mkdtempSync(path.join(tmpdir(), 'dsh-memory-test-'))
  mkdirSync(path.join(root, 'src'), { recursive: true })
  writeFileSync(path.join(root, 'src', 'foo.ts'), 'export const foo = 1\n')
  return root
}

test('adds, indexes, updates, marks stale, resolves, and deletes', async () => {
  const root = workspace()
  const store = new MemoryStore(fakeContext())
  const entry = await store.add(root, {
    title: '跑 foo 前要准备',
    type: '踩坑',
    scope: 'project',
    hook: '改 src/foo.ts 时',
    trigger: '改 src/foo.ts 时；测试缺 fixture 失败时',
    evidence: 'src/foo.ts:12',
    invalidation: 'fixture 自动化后',
    content: '第一行\n第二行',
  })
  assert.equal(entry.id.startsWith('pit-'), true)
  assert.equal(existsSync(path.join(root, 'memory', 'pitfalls.md')), true)
  const index = readFileSync(path.join(root, 'memory', 'MEMORY.md'), 'utf8')
  assert.match(index, /pitfalls\.md#pit-\d{8}-[0-9a-f]+/)
  assert.match(index, /## 条目/)
  assert.match(index, /pitfalls\.md#/)

  let snapshot = store.snapshot(root)
  assert.equal(snapshot.counts.entries, 1)
  assert.equal(snapshot.certified, true)
  assert.equal(snapshot.index.sync, true)
  assert.equal(snapshot.entries[0].content, '第一行\n第二行')

  await store.update(root, `${entry.file}#${entry.id}`, { content: '已更新' })
  snapshot = store.snapshot(root)
  assert.equal(snapshot.entries[0].content, '已更新')

  await store.markStale(root, `${entry.file}#${entry.id}`, '证据文件已删除')
  snapshot = store.snapshot(root)
  assert.equal(snapshot.counts.stale, 1)
  assert.equal(snapshot.entries[0].stale, true)

  await store.resolveStale(root, `${entry.file}#${entry.id}`, 'keep')
  snapshot = store.snapshot(root)
  assert.equal(snapshot.counts.stale, 0)
  assert.equal(snapshot.entries[0].stale, false)

  await store.remove(root, `${entry.file}#${entry.id}`)
  snapshot = store.snapshot(root)
  assert.equal(snapshot.counts.entries, 0)
})

test('moves an entry when its type changes', async () => {
  const root = workspace()
  const store = new MemoryStore(fakeContext())
  const entry = await store.add(root, {
    title: '一条决策',
    type: '踩坑',
    scope: 'project',
    trigger: '改 src/foo.ts 时',
    evidence: 'src/foo.ts:1',
    invalidation: '不再改',
    content: '内容',
  })
  const moved = await store.update(root, `${entry.file}#${entry.id}`, { type: '决策' })
  assert.equal(moved.file, 'decisions.md')
  assert.equal(store.snapshot(root).entries[0].type, '决策')
})

test('proposals are written, indexed, and removable', async () => {
  const root = workspace()
  const store = new MemoryStore(fakeContext())
  const result = await store.propose(root, {
    title: '把 pnpm 写成全局规则',
    target: '~/.agents/AGENTS.md',
    change: '新增规则',
    rationale: '这是跨项目的稳定偏好',
    evidence: '本轮用户纠正',
    diff: '+ 本仓库一律 pnpm',
  })
  assert.match(result.file, /^proposals\/\d{4}-\d{2}-\d{2}\.md$/)
  let snapshot = store.snapshot(root)
  assert.equal(snapshot.counts.proposals, 1)

  await store.removeProposal(root, result.file)
  snapshot = store.snapshot(root)
  assert.equal(snapshot.counts.proposals, 0)
})

test('audit reports a missing evidence file but passes the shape', async () => {
  const root = workspace()
  const store = new MemoryStore(fakeContext())
  await store.add(root, {
    title: '引用了不存在的文件',
    type: '隐藏依赖',
    scope: 'project',
    trigger: '改 src/missing.ts 时',
    evidence: 'src/missing.ts:3',
    invalidation: '文件出现后',
    content: '内容',
  })
  const audit = store.audit(root)
  assert.equal(audit.exists, true)
  assert.equal(audit.counts.entries, 1)
  assert.ok(audit.issues.some((issue) => issue.code === 'evidence-missing'))
})

test('certify rebuilds a drifted index', async () => {
  const root = workspace()
  const store = new MemoryStore(fakeContext())
  await store.add(root, {
    title: '一条记忆',
    type: '情境事实',
    scope: 'project',
    trigger: '需要时',
    evidence: 'src/foo.ts:1',
    invalidation: '不需要时',
    content: '内容',
  })
  const file = path.join(root, 'memory', 'MEMORY.md')
  writeFileSync(file, readFileSync(file, 'utf8').replace(/- \[情境事实\].*\n/, ''))
  assert.equal(store.snapshot(root).index.sync, false)
  await store.certify(root)
  assert.equal(store.snapshot(root).index.sync, true)
})

test('verify stamps a date and the index shows its age', async () => {
  const root = workspace()
  const store = new MemoryStore(fakeContext())
  const entry = await store.add(root, {
    title: '一条记忆',
    type: '踩坑',
    trigger: '改 src/foo.ts 时',
    evidence: 'src/foo.ts:1',
    invalidation: '不再改',
    content: '内容',
  })
  const result = await store.verify(root, `${entry.file}#${entry.id}`)
  assert.match(result.verified, /^\d{4}-\d{2}-\d{2}$/)
  const snapshot = store.snapshot(root)
  assert.equal(snapshot.entries[0].verified, result.verified)
  assert.equal(snapshot.index.sync, true)
  const index = readFileSync(path.join(root, 'memory', 'MEMORY.md'), 'utf8')
  assert.match(index, new RegExp(`｜核验 ${result.verified}`))
})

test('keeping a stale entry records that it was re-verified', async () => {
  const root = workspace()
  const store = new MemoryStore(fakeContext())
  const entry = await store.add(root, {
    title: '一条记忆',
    type: '踩坑',
    trigger: '改 src/foo.ts 时',
    evidence: 'src/foo.ts:1',
    invalidation: '不再改',
    content: '内容',
  })
  await store.markStale(root, `${entry.file}#${entry.id}`, '疑似失效')
  await store.resolveStale(root, `${entry.file}#${entry.id}`, 'keep')
  const snapshot = store.snapshot(root)
  assert.match(snapshot.entries[0].verified, /^\d{4}-\d{2}-\d{2}$/)
  assert.equal(snapshot.counts.stale, 0)
})

test('proposals are one file each and resolve with approval evidence', async () => {
  const root = workspace()
  const store = new MemoryStore(fakeContext())
  const base = {
    target: 'AGENTS.md',
    change: '新增规则',
    rationale: '跨项目稳定偏好',
    evidence: '本轮依据',
  }
  const first = await store.propose(root, { ...base, title: '第一条' })
  const second = await store.propose(root, { ...base, title: '第二条' })
  assert.match(first.file, /^proposals\/\d{4}-\d{2}-\d{2}\.md$/)
  assert.match(second.file, /-2\.md$/)
  assert.equal(store.snapshot(root).counts.proposals, 2)

  const closed = await store.resolveProposal(root, second.file, '用户说：提案通过')
  assert.match(closed.approvedAt, /^\d{4}-\d{2}-\d{2}$/)
  const snapshot = store.snapshot(root)
  assert.equal(snapshot.counts.proposals, 1)
  assert.equal(snapshot.proposals.find((item) => `proposals/${item.file}` === second.file).status, '已应用')
  assert.equal(snapshot.proposals.find((item) => `proposals/${item.file}` === second.file).approval, '用户说：提案通过')
  assert.equal(store.audit(root).issues.filter((issue) => issue.code === 'proposal-orphan').length, 0)
  await assert.rejects(() => store.resolveProposal(root, second.file, '再一次'))

  await store.removeProposal(root, first.file)
  assert.equal(store.snapshot(root).counts.proposals, 0)
})

test('legacy multi-section proposal files are reported for splitting', async () => {
  const root = workspace()
  const store = new MemoryStore(fakeContext())
  await store.propose(root, {
    title: '第一条',
    target: 'AGENTS.md',
    change: '新增规则',
    rationale: '理由',
    evidence: '依据',
  })
  const file = path.join(root, 'memory', 'proposals', readdirSync(path.join(root, 'memory', 'proposals'))[0])
  const legacy = `${readFileSync(file, 'utf8').trimEnd()}\n\n## 提案 2 — 第二条\n- 目标文件: AGENTS.md\n- 改动类型: 新增规则\n- 依据: 依据\n- 理由: 理由\n- 状态: 待确认\n`
  writeFileSync(file, legacy)
  const audit = store.audit(root)
  assert.ok(audit.issues.some((issue) => issue.code === 'proposal-legacy'))
})

test('evidence short paths are completed when unique and refused when ambiguous', async () => {
  const root = workspace()
  mkdirSync(path.join(root, 'src', 'deep'), { recursive: true })
  writeFileSync(path.join(root, 'src', 'deep', 'bar.ts'), 'export const bar = 2\n')
  mkdirSync(path.join(root, 'a', 'pkg'), { recursive: true })
  mkdirSync(path.join(root, 'b', 'pkg'), { recursive: true })
  writeFileSync(path.join(root, 'a', 'pkg', 'x.ts'), 'export const a = 1\n')
  writeFileSync(path.join(root, 'b', 'pkg', 'x.ts'), 'export const b = 1\n')
  const store = new MemoryStore(fakeContext())

  const entry = await store.add(root, {
    title: '唯一后缀',
    type: '隐藏依赖',
    trigger: '改 bar.ts 时',
    evidence: 'deep/bar.ts:3',
    invalidation: '改结构',
    content: '内容',
  })
  assert.equal(store.find(root, `${entry.file}#${entry.id}`).evidence, 'src/deep/bar.ts:3')

  await assert.rejects(() => store.add(root, {
    title: '歧义后缀',
    type: '隐藏依赖',
    trigger: '改 x.ts 时',
    evidence: 'pkg/x.ts:1',
    invalidation: '改结构',
    content: '内容',
  }), /证据路径不唯一/)

  const missing = await store.add(root, {
    title: '找不到的路径',
    type: '隐藏依赖',
    trigger: '改 missing 时',
    evidence: 'missing/thing.ts:1',
    invalidation: '路径出现后',
    content: '内容',
  })
  assert.equal(store.find(root, `${missing.file}#${missing.id}`).evidence, 'missing/thing.ts:1')
  assert.ok(store.audit(root).issues.some((issue) => issue.code === 'evidence-missing'))
})
