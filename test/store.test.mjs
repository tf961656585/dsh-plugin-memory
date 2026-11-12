import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
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
