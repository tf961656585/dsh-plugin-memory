import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { apply } from '../host.js'
import { MemoryStore } from '../lib/store.js'

function setup(config = { autoRecall: false }) {
  const tools = []
  const handlers = new Map()
  const fakeCtx = {
    logger: { warn() {}, info() {}, debug() {} },
    get() { return undefined },
    on(event, handler) { handlers.set(event, handler) },
    effect(fn) { fn(); return () => {} },
    inject(_deps, callback) {
      callback({
        effect(fn) { fn(); return () => {} },
        tools: { register(definition) { tools.push(definition) } },
        systemPrompt: { section() { return () => {} } },
        webServer: { register() { return () => {} } },
        commands: { register() { return () => {} } },
      })
    },
  }
  apply(fakeCtx, config)
  return { tools, handlers }
}

function loadPlugin() {
  return setup().tools
}

function workspace() {
  const root = mkdtempSync(path.join(tmpdir(), 'dsh-memory-host-'))
  mkdirSync(path.join(root, 'src'), { recursive: true })
  writeFileSync(path.join(root, 'src', 'foo.ts'), 'export const foo = 1\n')
  return root
}

const execAt = (root) => ({ agent: { session: { header: { cwd: root } } } })

test('the host registers the entry tools in order', () => {
  const names = loadPlugin().map((tool) => tool.name)
  assert.deepEqual(names.slice(0, 8), [
    'memory_recall', 'memory_get', 'memory_write', 'memory_verify', 'memory_stale', 'memory_audit', 'memory_lexicon', 'memory_propose',
  ])
})

test('memory_lexicon lists a project lexicon through its own tool output', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'dsh-memory-host-'))
  const mem = path.join(root, 'memory')
  mkdirSync(mem, { recursive: true })
  writeFileSync(path.join(mem, 'MEMORY.md'), '# MEMORY\n<!-- memory-schema: 3 -->\n\n## 条目\n\n（无）\n')
  writeFileSync(path.join(mem, 'lexicon.md'), '# 词表\n\n- 素材 = 贴图\n')
  writeFileSync(path.join(mem, 'pitfalls.md'), [
    '## 2026-10-01 — 素材入库',
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
  const tool = loadPlugin().find((candidate) => candidate.name === 'memory_lexicon')
  const output = await tool.execute({ action: 'list' }, execAt(root))
  assert.match(output, /词表：1 组 \/ 1 个别名/)
  assert.match(output, /- 素材 → 贴图/)
})

test('memory_write update accepts file#id and only touches the given field', async () => {
  const root = workspace()
  const tools = loadPlugin()
  const write = tools.find((tool) => tool.name === 'memory_write')
  const get = tools.find((tool) => tool.name === 'memory_get')
  const added = await write.execute({
    action: 'add',
    title: '一条记忆',
    type: '踩坑',
    trigger: '改 src/foo.ts 时',
    evidence: 'src/foo.ts:1',
    invalidation: '不再改',
    content: '原文',
  }, execAt(root))
  const match = /^已写入 (\S+)#(\S+?)：/.exec(added)
  assert.ok(match, added)
  const [, file, id] = match

  const updated = await write.execute({ action: 'update', id: `${file}#${id}`, evidence: 'src/foo.ts:2' }, execAt(root))
  assert.match(updated, /已更新/)

  const text = await get.execute({ id: `${file}#${id}` }, execAt(root))
  assert.match(text, /证据：src\/foo\.ts:2/)
  assert.match(text, /内容：原文/)
  assert.match(text, /触发：改 src\/foo\.ts 时/)
})

test('memory_verify stamps the verification date without touching content', async () => {
  const root = workspace()
  const tools = loadPlugin()
  const write = tools.find((tool) => tool.name === 'memory_write')
  const verify = tools.find((tool) => tool.name === 'memory_verify')
  const get = tools.find((tool) => tool.name === 'memory_get')
  const added = await write.execute({
    action: 'add',
    title: '一条记忆',
    type: '踩坑',
    trigger: '改 src/foo.ts 时',
    evidence: 'src/foo.ts:1',
    invalidation: '不再改',
    content: '原文',
  }, execAt(root))
  const match = /^已写入 (\S+)#(\S+?)：/.exec(added)
  const [, file, id] = match

  const verified = await verify.execute({ id: `${file}#${id}` }, execAt(root))
  assert.match(verified, /已核验 .*（\d{4}-\d{2}-\d{2}）/)
  const text = await get.execute({ id: `${file}#${id}` }, execAt(root))
  assert.match(text, /核验于：\d{4}-\d{2}-\d{2}/)
  assert.match(text, /内容：原文/)
})

test('memory_propose writes one file per proposal and resolves it with approval evidence', async () => {
  const root = workspace()
  const tools = loadPlugin()
  const propose = tools.find((tool) => tool.name === 'memory_propose')
  const base = {
    target: 'AGENTS.md',
    change: '新增规则',
    rationale: '跨项目稳定偏好',
    evidence: '本轮依据',
  }
  const first = await propose.execute({ ...base, title: '第一条' }, execAt(root))
  const second = await propose.execute({ ...base, title: '第二条' }, execAt(root))
  const firstFile = /已写提案 (\S+?\.md)/.exec(first)?.[1]
  const secondFile = /已写提案 (\S+?\.md)/.exec(second)?.[1]
  assert.ok(firstFile)
  assert.ok(secondFile)
  assert.notEqual(firstFile, secondFile)
  assert.match(secondFile, /-2\.md$/)

  const closed = await propose.execute({
    action: 'resolve',
    proposal: secondFile,
    evidence: '用户说：提案通过',
  }, execAt(root))
  assert.match(closed, /已标记已应用/)

  const again = await propose.execute({
    action: 'resolve',
    proposal: secondFile,
    evidence: '用户说：提案通过',
  }, execAt(root))
  assert.match(again, /已经标记为已应用/)
})

test('automatic recall ignores plugin-generated prompts', async () => {
  const root = workspace()
  const store = new MemoryStore({ logger: { warn() {} }, get: () => undefined })
  await store.add(root, {
    title: '改 src/foo.ts 时先看这条',
    type: '踩坑',
    trigger: '改 src/foo.ts 时',
    evidence: 'src/foo.ts:1',
    invalidation: '不再改',
    content: '正文',
  })
  const { handlers } = setup({ autoRecall: true })
  const preStep = handlers.get('agent/pre-step')
  assert.ok(preStep, 'pre-step handler registered')

  const accept = async () => ({ kind: 'accept', messages: [] })
  const agent = { session: { header: { cwd: root } } }
  const reflect = await preStep({
    agent,
    turn: 1,
    signal: { aborted: false },
    messages: [{
      role: 'user',
      source: { kind: 'memory-reflect' },
      content: [{ type: 'text', text: '请对本次会话做一次完整反思沉淀：看 src/foo.ts 的改动。' }],
    }],
  }, accept)
  assert.equal(reflect.messages.length, 0)

  const task = await preStep({
    agent,
    turn: 2,
    signal: { aborted: false },
    messages: [{
      role: 'user',
      source: { kind: 'user' },
      content: [{ type: 'text', text: '改 src/foo.ts 时要注意什么？' }],
    }],
  }, accept)
  assert.equal(task.messages.length, 1)
  assert.match(task.messages[0].content[0].text, /记忆召回/)
})
