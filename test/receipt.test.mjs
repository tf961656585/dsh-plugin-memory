import assert from 'node:assert/strict'
import test from 'node:test'

/**
 * Turn-end receipt smoke test without a browser or React install.
 *
 * The bundle only needs `React.createElement` and the hook surface it uses, so a
 * minimal stub can prove the fold and the row mount path; it is not a visual check.
 */
const React = {
  createElement(type, props, ...children) {
    return { type, props: props ?? {}, children: children.flat(Infinity) }
  },
  useState(initial) {
    return [typeof initial === 'function' ? initial() : initial, () => {}]
  },
  useEffect() {},
  useCallback(fn) { return fn },
  useRef(value) { return { current: value } },
  Component: class {
    constructor(props) { this.props = props ?? {}; this.state = {} }
    setState(next) { this.state = { ...this.state, ...next } }
  },
  Fragment: 'Fragment',
}

let captured = null
globalThis.window = {
  __ModuleLoader__: { load(definition) { captured = definition } },
  localStorage: { getItem() { return null }, setItem() {} },
}
globalThis.document = { visibilityState: 'visible' }
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) })

await import('../client.js')

const registrations = []
const ctx = {
  effect: (fn) => fn(),
  locale: { register: () => () => {}, bind: () => (key) => key },
  slots: {
    inject: (_name, callback) => callback(),
    register: (options, component) => { registrations.push({ options, component }); return () => {} },
  },
  uiConversation: { events: { register: () => () => {} } },
  layout: { selectPanel: () => {} },
}

const bundle = captured.factory((name) => (name === 'react' ? React : {}))
bundle.apply(ctx)

const receipt = bundle.__test.receipt

test('the turn-tail receipt is registered beside the shipped entries', () => {
  const entry = registrations.find((candidate) => candidate.options.name === 'conversation.chat.turnTail')
  assert.ok(entry, 'turn-tail registration')
  assert.equal(entry.options.id, 'memory-turn')
  assert.equal(typeof entry.options.inject().openMemory, 'function')
})

test('the panel and sidebar registrations survive the receipt', () => {
  const main = registrations.find((candidate) => candidate.options.name === 'main')
  const sidebar = registrations.find((candidate) => candidate.options.name === 'sidebar.panellist')
  assert.ok(main)
  assert.ok(sidebar)
  assert.equal(main.options.key, sidebar.options.id)
})

function turnStarted(turn = 1) {
  return { type: 'turn/start', seq: 1, time: 0, data: { turn } }
}

function memoryCall(callId, name, args) {
  return {
    type: 'tool/call',
    seq: 2,
    time: 0,
    data: { turn: 1, step: 1, callId, name, arguments: JSON.stringify(args) },
  }
}

function settledResult(callId, isError = false, text) {
  return {
    type: 'tool/result',
    seq: 3,
    time: 0,
    data: {
      turn: 1,
      step: 1,
      message: {
        isError,
        source: { callId },
        content: text === undefined ? [] : [{ type: 'text', text }],
      },
    },
  }
}

function folded(events) {
  let state = receipt.definition.start({}, { event: turnStarted() })
  for (const event of events) state = receipt.definition.update({ state }, { event })
  return state
}

test('a settled write shows the entry it recorded', () => {
  const state = folded([
    memoryCall('c1', 'memory_write', { action: 'add', title: '先 seed 再跑集成测试', type: '踩坑' }),
    settledResult('c1'),
  ])
  assert.deepEqual(state.wrote, [{ title: '先 seed 再跑集成测试', type: '踩坑' }])
})

test('a proposal waits for approval and a same-turn approval clears it', () => {
  const proposed = folded([
    memoryCall('c1', 'memory_propose', { action: 'propose', title: '把回执写进 spec', target: 'spec/x.md' }),
    settledResult('c1', false, '已写提案 proposals/2026-11-14.md（目标：spec/x.md）。请在记忆面板「提案」里审阅；'),
  ])
  assert.deepEqual(proposed.proposals, [{ title: '把回执写进 spec', file: 'proposals/2026-11-14.md' }])

  const resolved = folded([
    memoryCall('c1', 'memory_propose', { action: 'propose', title: '把回执写进 spec', target: 'spec/x.md' }),
    settledResult('c1', false, '已写提案 proposals/2026-11-14.md（目标：spec/x.md）。'),
    memoryCall('c2', 'memory_propose', { action: 'resolve', proposal: '2026-11-14.md', evidence: '他说可以' }),
    settledResult('c2'),
  ])
  assert.deepEqual(resolved.proposals, [])
  assert.equal(resolved.applied, 1)
})

test('reads and failures leave no receipt', () => {
  const read = folded([
    memoryCall('c1', 'memory_recall', { query: '回执' }),
    settledResult('c1'),
  ])
  assert.equal(receipt.definition.buildLocationData({ state: read }, 'turn', null), null)

  const failed = folded([
    memoryCall('c1', 'memory_write', { action: 'add', title: '不该出现', type: '决策' }),
    settledResult('c1', true),
  ])
  assert.equal(receipt.definition.buildLocationData({ state: failed }, 'turn', null), null)
})

test('verification and stale marks count without a title', () => {
  const state = folded([
    memoryCall('c1', 'memory_verify', { id: 'a#b' }),
    settledResult('c1'),
    memoryCall('c2', 'memory_stale', { action: 'mark', id: 'a#c', reason: '文件没了' }),
    settledResult('c2'),
  ])
  assert.equal(state.verified, 1)
  assert.equal(state.staled, 1)
})

test('the receipt reuses its published value while nothing changes', () => {
  const state = folded([
    memoryCall('c1', 'memory_write', { action: 'add', title: '一条', type: '决策' }),
    settledResult('c1'),
  ])
  const first = receipt.definition.buildLocationData({ state }, 'turn', null)
  assert.equal(first.key, 'memory-turn')
  assert.equal(receipt.definition.buildLocationData({ state }, 'turn', first), first)
  assert.equal(receipt.definition.buildLocationData({ state }, 'step', first), null)
})

test('the summary names a single proposal and otherwise counts', () => {
  const t = (key) => key
  const proposal = { wrote: [], proposals: [{ title: '一份提案', file: '' }], updated: 0, deleted: 0, verified: 0, staled: 0, resolved: 0, applied: 0 }
  assert.equal(receipt.summary(t, proposal), '一份提案')
  const writes = { wrote: [{ title: 'a', type: '决策' }, { title: 'b', type: '踩坑' }], proposals: [], updated: 0, deleted: 0, verified: 1, staled: 0, resolved: 0, applied: 0 }
  assert.match(receipt.summary(t, writes), /^receiptWrote · receiptVerified$/)
})

test('the receipt row renders written entries and opens memory', () => {
  const opens = []
  const row = receipt.component({
    t: (key) => key,
    openMemory: () => opens.push('memory'),
    turn: {
      data: new Map([['memory-turn', {
        wrote: [{ title: '先 seed 再跑集成测试', type: '踩坑' }],
        proposals: [],
        updated: 0,
        deleted: 0,
        verified: 1,
        staled: 0,
        resolved: 0,
        applied: 0,
      }]]),
    },
  })
  const head = row.children[1].children[0]
  assert.equal(head.type, 'button')
  // Downgraded to an activity line: no expandable list, one click opens memory.
  assert.equal(head.props['aria-expanded'], undefined)
  head.props.onClick()
  assert.deepEqual(opens, ['memory'])
  const summary = head.children[1]
  assert.match(summary.children.join(''), /receiptWrote/)
})

test('a turn without memory activity renders no receipt row', () => {
  assert.equal(receipt.component({ t: (key) => key, openMemory() {}, turn: { data: new Map() } }), null)
})

// ---------------------------------------------------------------------------
// Stale queue and proposal list render: these paths only run once a real queue
// exists, so they must be exercised here — a scope error used to blank the panel.
// ---------------------------------------------------------------------------
const lists = bundle.__test.list

test('a stale row renders for a live entry and for an orphaned record', () => {
  const live = lists.staleRow({
    t: (key) => key,
    record: { date: '2026-11-17', file: 'decisions.md', id: 'dec-x', reason: '实现变了', entry: { title: '旧决策', type: '决策' } },
    busy: '',
    onResolve() {},
  })
  assert.ok(live, 'row rendered')
  const orphan = lists.staleRow({
    t: (key) => key,
    record: { date: '2026-11-17', file: 'decisions.md', id: 'dec-y', reason: '条目已删', entry: null },
    busy: '',
    onResolve() {},
  })
  assert.ok(orphan, 'orphan row rendered')
})

test('a stale row keeps its own busy token', () => {
  let resolved = null
  const row = lists.staleRow({
    t: (key) => key,
    record: { date: '2026-11-17', file: 'decisions.md', id: 'dec-z', reason: '理由', entry: { title: '条目', type: '决策' } },
    busy: 'decisions.md#dec-z',
    onResolve: (record, decision) => { resolved = { record, decision } },
  })
  const button = findNode(row, (node) => node.type === 'button' && node.children.includes('resolveDelete'))
  assert.equal(button.props.disabled, true, 'the busy row disables its own action')
  // The keep action still resolves even while another token is busy.
  const keep = findNode(row, (node) => node.type === 'button' && node.children.includes('resolveKeep'))
  assert.equal(keep.props.disabled, true)
  keep.props.onClick()
  assert.equal(resolved.decision, 'keep')
  assert.equal(resolved.record.id, 'dec-z')
})

test('the stale list renders every record and an empty state', () => {
  const records = [
    { date: '2026-11-17', file: 'decisions.md', id: 'a', reason: 'r1', entry: null },
    { date: '2026-11-16', file: 'pitfalls.md', id: 'b', reason: 'r2', entry: null },
  ]
  const list = lists.stale({ t: (key) => key, records, busy: '', onResolve() {} })
  assert.equal(list.children.length, 3, 'hint plus one row per record')
  const empty = lists.stale({ t: (key) => key, records: [], busy: '', onResolve() {} })
  assert.deepEqual(empty.children, ['staleEmpty'])
})

test('a proposal row renders with its status and full text', () => {
  const row = lists.proposalRow({
    t: (key) => key,
    proposal: { file: '2026-11-17.md', title: '提案标题', status: '待确认', date: '2026-11-17', content: '正文', sections: 1 },
    busy: '',
    onDelete() {},
  })
  assert.ok(findNode(row, (node) => node.children?.includes('提案标题')))
  assert.deepEqual(
    findNode(row, (node) => node.props?.className === 'mem-badge').children,
    ['proposalPending'],
  )
})

/** Depth-first search through the stub element tree. */
function findNode(node, predicate) {
  if (node === null || node === undefined || typeof node !== 'object') return null
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findNode(child, predicate)
      if (hit !== null) return hit
    }
    return null
  }
  if (predicate(node)) return node
  return findNode(node.children ?? [], predicate)
}

test('the panel is wrapped in a boundary, so one failing row cannot blank it', () => {
  const main = registrations.find((candidate) => candidate.options.name === 'main')
  assert.ok(main, 'main panel registration')
  const tree = main.component({ t: (key) => key })
  // The registered entry renders the boundary around the page.
  assert.equal(typeof tree.type, 'function')
  assert.equal(tree.props.message, 'panelFailed')
  // A failed render shows the actionable message instead of throwing further.
  const boundary = new tree.type({ message: 'panelFailed' })
  assert.deepEqual(boundary.state, { failed: false })
  boundary.componentDidCatch(new Error('boom'))
  boundary.state = tree.type.getDerivedStateFromError()
  assert.equal(boundary.state.failed, true)
  const failed = boundary.render()
  assert.equal(failed.type, 'div')
  assert.deepEqual(failed.children[0].children, ['panelFailed'])
})
