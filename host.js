/**
 * Repository memory — Host half.
 *
 * Registers the memory tools, the always-present behavior contract, the
 * `/reflect` command, automatic recall at the start of a turn, and the Web
 * routes used by the sidebar panel. Every write goes through `MemoryStore`, so
 * the agent, the panel, and the index generator share one contract.
 */
import { randomUUID } from 'node:crypto'
import { MemoryStore, publicEntry } from './lib/store.js'
import { SCHEMA_VERSION, SCOPES, TYPES, oneLine, rankEntries } from './lib/contract.js'

export const name = 'memory'

const ROUTE_STATE = '/plugin/memory/state'
const ROUTE_MUTATE = '/plugin/memory/mutate'
const MAX_BODY_BYTES = 512 * 1024
const RECALL_LIMIT = 8

const PROMPT = [
  '## 记忆（memory）',
  '项目根目录的 `memory/` 是可探索的经验记忆，不是权威 spec。用下面的工具读写，不要直接编辑 `memory/` 下的文件。',
  '- 开工、排查异常、改不熟悉模块、用户提到「之前 / 以前」时：先用 `memory_recall`，查询用文件路径、符号、报错串、模块名或用户措辞。',
  '- 命中后先 `memory_get` 读全文，按「失效条件」核验现状再据此行动；记忆与代码 / spec 冲突时以代码和 spec 为准。',
  '- 发现记忆与现状矛盾：用 `memory_stale` action=mark 记下失效证据；不要继续把它当依据，也不要直接删。',
  '- 本轮得到可复用教训（用户纠正、隐藏依赖、拍板决策）：用 `memory_write` action=add，必须带触发、证据、失效条件；已写进 AGENTS.md / spec / skill 的不重复存。',
  '- 用户说「反思 / 沉淀 / 复盘」或执行 `/reflect`：做完整一轮——`memory_audit` → 逐条核验 → `memory_stale` 处理队列 → 补写本轮洞察 → 对 AGENTS / spec 的改动只用 `memory_propose` 出提案。',
  '- 自动召回会以「〔记忆召回〕」出现在你的输入里；它只是线索，同样要按失效条件核验。',
  '- 删条目只在核验失效后做，并在 `memory_write` action=delete 里写清 reason。',
].join('\n')

function fail(message) {
  const error = new Error(message)
  error.statusCode = 400
  return error
}

function sendJson(res, status, payload) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(payload))
}

function sendMethodNotAllowed(res, allow) {
  res.statusCode = 405
  res.setHeader('allow', allow)
  res.end()
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(fail('内容太长了'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** A model-visible user message; the source label keeps derived history readable. */
function visibleMessage(text, source = { kind: 'user' }) {
  return {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source,
  }
}

/** Concatenate the text blocks of the messages entering one step. */
function textOfMessages(messages) {
  const parts = []
  for (const message of Array.isArray(messages) ? messages : []) {
    if (message?.role !== 'user') continue
    for (const block of Array.isArray(message.content) ? message.content : []) {
      if (block?.type === 'text' && typeof block.text === 'string') parts.push(block.text)
    }
  }
  return parts.join('\n').trim()
}

function truncate(value, max) {
  const text = String(value ?? '')
  return text.length <= max ? text : `${text.slice(0, max)}…（+${text.length - max} 字）`
}

function formatEntry(entry, full = false) {
  const lines = [
    `[${entry.type}] ${entry.title}`,
    `地址：${entry.file}#${entry.id}`,
    `作用域：${entry.scope}  捕获于：${entry.date}${entry.stale ? '  [待核验]' : ''}`,
  ]
  if (entry.hook !== '') lines.push(`钩子：${entry.hook}`)
  if (entry.trigger !== '') lines.push(`触发：${entry.trigger}`)
  lines.push(`证据：${entry.evidence}`)
  lines.push(`失效条件：${entry.invalidation}`)
  lines.push(`内容：${full ? entry.content : truncate(entry.content, 600)}`)
  if (entry.problems.length > 0) {
    lines.push(`问题：${entry.problems.map((problem) => problem.message).join('；')}`)
  }
  return lines.join('\n')
}

function formatRecall(hits) {
  if (hits.length === 0) {
    return '没有命中记忆。可以换一个文件路径、报错串或模块名重试；查询为空时返回最近的条目。'
  }
  const lines = [`命中 ${hits.length} 条记忆（先按失效条件核验，再据此行动）：`]
  for (const hit of hits) {
    lines.push(`- [${hit.entry.type}] ${hit.entry.hook || hit.entry.trigger} → ${hit.entry.file}#${hit.entry.id}（相关度 ${hit.score}）${hit.entry.stale ? ' [待核验]' : ''}`)
    lines.push(`  内容：${truncate(hit.entry.content, 300)}`)
    lines.push(`  失效条件：${truncate(hit.entry.invalidation, 160)}`)
  }
  return lines.join('\n')
}

function formatAudit(audit) {
  const lines = [
    `记忆体检：${audit.counts.entries} 条（user ${audit.counts.user}），待清理 ${audit.counts.stale}，待补 ${audit.counts.inbox}，提案 ${audit.counts.proposals}。`,
    audit.certified ? '格式标记：已认证。' : `格式标记：${audit.schema === null ? '缺失' : `版本 ${audit.schema}，当前 ${SCHEMA_VERSION}`}。`,
    audit.indexSync ? '索引：与条目一致。' : '索引：与条目不一致，需要重建。',
  ]
  if (audit.issues.length === 0) {
    lines.push('没有发现形状或索引问题。语义失效仍需逐条读代码核验。')
    return lines.join('\n')
  }
  lines.push(`发现 ${audit.issues.length} 个问题：`)
  for (const issue of audit.issues.slice(0, 40)) {
    lines.push(`- [${issue.level}] ${issue.message}`)
  }
  if (audit.issues.length > 40) lines.push(`…还有 ${audit.issues.length - 40} 条，请在记忆面板「体检」里查看。`)
  return lines.join('\n')
}

function toolRoot(store, exec) {
  return store.resolve(store.cwdOf(exec?.agent))
}

function noMemory(root) {
  return `当前项目（${root}）还没有 memory/。第一次用 memory_write action=add 写入时会自动创建；也可以先用 memory_recall 查看其他项目。`
}

function buildTools(store) {
  const stringOutput = {
    schema: { type: 'string' },
    render: (_args, value) => [{ type: 'text', text: value }],
  }

  return [
    {
      name: 'memory_recall',
      description: '按文件路径、符号、报错串、模块名或用户措辞检索当前项目的经验记忆；查询为空时浏览最近条目。返回摘要与 file#id，读全文用 memory_get。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          query: { type: 'string', description: '检索词：文件路径、报错串、模块名、用户措辞；留空表示浏览最近条目。' },
          type: { type: 'string', enum: TYPES, description: '只看某一类条目。' },
          status: { type: 'string', enum: ['all', 'stale'], description: 'all 全部；stale 只看待清理队列。' },
          limit: { type: 'integer', description: '最多返回几条，默认 8。' },
        },
        required: [],
      },
      output: stringOutput,
      execute: (args, exec) => {
        const root = toolRoot(store, exec)
        const loaded = store.load(root)
        if (!loaded.exists) return noMemory(root)
        let entries = loaded.entries
        if (args.status === 'stale') entries = entries.filter((entry) => entry.stale)
        if (typeof args.type === 'string' && TYPES.includes(args.type)) entries = entries.filter((entry) => entry.type === args.type)
        const rawLimit = Number.isInteger(args.limit) ? args.limit : RECALL_LIMIT
        const limit = Math.max(1, Math.min(20, rawLimit))
        const query = typeof args.query === 'string' ? args.query : ''
        if (query.trim() === '') {
          const recent = rankEntries(entries, '', limit).map((result) => ({ ...result, entry: publicEntry(result.entry) }))
          return formatRecall(recent)
        }
        const hits = rankEntries(entries, query, limit).map((result) => ({ ...result, entry: publicEntry(result.entry) }))
        return formatRecall(hits)
      },
    },
    {
      name: 'memory_get',
      description: '按 id 或 file#id 读取一条记忆的全文（触发、证据、失效条件、内容）。读取后按失效条件核验现状。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', description: '条目 id，或 file#id。' },
        },
        required: ['id'],
      },
      output: stringOutput,
      execute: (args, exec) => {
        const root = toolRoot(store, exec)
        if (!store.load(root).exists) return noMemory(root)
        const entry = store.find(root, args.id)
        return formatEntry(publicEntry(entry), true)
      },
    },
    {
      name: 'memory_write',
      description: '写入一条记忆：add 新增，update 修改，delete 删除。写入前由插件校验字段并自动重建索引；已写进 AGENTS.md / spec / skill 的内容不要再存。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: { type: 'string', enum: ['add', 'update', 'delete'], description: 'add 新增；update 修改；delete 删除（需 reason）。' },
          id: { type: 'string', description: 'update / delete 必填：条目 id 或 file#id。' },
          title: { type: 'string', description: '一句话主题；add 必填。' },
          type: { type: 'string', enum: TYPES, description: '条目类型；add 必填。' },
          scope: { type: 'string', enum: SCOPES, description: 'user 表示需要晋升到用户级规则，project 表示仓库事实；默认 project。' },
          hook: { type: 'string', description: '索引行用的短钩子，含 1–3 个读侧会持有的表面信号；不能含 →。' },
          trigger: { type: 'string', description: '下次什么情境该读；add 必填。' },
          evidence: { type: 'string', description: '文件:行 或本轮对话依据；add 必填。' },
          invalidation: { type: 'string', description: '什么情况发生时本条失效；add 必填。' },
          content: { type: 'string', description: '可复用洞察（what 与 why）；add 必填。' },
          topic: { type: 'string', description: '可选：自定义主题文件名，如 testing.md；默认按类型落标准文件。' },
          reason: { type: 'string', description: 'delete 必填：为什么删（失效证据）。' },
        },
        required: ['action'],
      },
      output: stringOutput,
      execute: async (args, exec) => {
        const root = toolRoot(store, exec)
        if (args.action === 'add') {
          const entry = await store.add(root, args)
          return `已写入 ${entry.file}#${entry.id}：${entry.title}\n索引已重建。`
        }
        if (args.action === 'update') {
          if (typeof args.id !== 'string' || args.id.trim() === '') return 'update 需要 id（或 file#id）。'
          const entry = await store.update(root, args.id, args)
          return `已更新 ${entry.file}#${entry.id}：${entry.title}\n索引已重建。`
        }
        if (args.action === 'delete') {
          if (typeof args.id !== 'string' || args.id.trim() === '') return 'delete 需要 id（或 file#id）。'
          if (typeof args.reason !== 'string' || oneLine(args.reason) === '') return 'delete 需要 reason：写清核验到的失效证据。'
          const removed = await store.remove(root, args.id)
          return `已删除 ${removed.file}#${removed.id}：${removed.title}；索引已重建。`
        }
        return '未知操作，只支持 add / update / delete。'
      },
    },
    {
      name: 'memory_stale',
      description: '处理失效记忆：mark 把一条记忆加入待清理队列（记下失效证据，不删除）；resolve 处理队列，delete 删除条目，keep 只移除提醒。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: { type: 'string', enum: ['mark', 'resolve'], description: 'mark 标记失效；resolve 处理队列。' },
          id: { type: 'string', description: '条目 id 或 file#id；resolve 使用 file#id。' },
          reason: { type: 'string', description: 'mark 必填：读到的现状 / 与记忆矛盾之处。' },
          decision: { type: 'string', enum: ['delete', 'keep'], description: 'resolve 必填：delete 删除条目；keep 保留条目、只移除提醒。' },
        },
        required: ['action', 'id'],
      },
      output: stringOutput,
      execute: async (args, exec) => {
        const root = toolRoot(store, exec)
        if (args.action === 'mark') {
          const result = await store.markStale(root, args.id, args.reason)
          return `已加入待清理：${result.file}#${result.id}（${result.title}）。完整反思时用 memory_stale action=resolve 处理。`
        }
        if (args.action === 'resolve') {
          const result = await store.resolveStale(root, args.id, args.decision)
          return result.decision === 'delete'
            ? `已删除 ${result.key} 并清空对应待清理提醒。`
            : `已保留 ${result.key}，只移除了待清理提醒。`
        }
        return '未知操作，只支持 mark / resolve。'
      },
    },
    {
      name: 'memory_audit',
      description: '体检当前项目的记忆库：缺字段、重复 id、索引漂移、待清理队列、提案、证据文件是否还在。只读；语义失效仍需逐条读代码核验。',
      parameters: { type: 'object', additionalProperties: false, properties: {}, required: [] },
      output: stringOutput,
      execute: (_args, exec) => {
        const root = toolRoot(store, exec)
        if (!store.load(root).exists) return noMemory(root)
        return formatAudit(store.audit(root))
      },
    },
    {
      name: 'memory_propose',
      description: '对 AGENTS.md、spec 或 skill 的改写出提案，不直接修改目标文件；提案写入 memory/proposals/，在记忆面板「提案」里审阅。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string', description: '提案一句话。' },
          target: { type: 'string', description: '目标文件。' },
          change: { type: 'string', description: '新增规则 / 修正矛盾 / 删除旧口径。' },
          rationale: { type: 'string', description: '为什么该进必读层，而不是记忆层。' },
          evidence: { type: 'string', description: '本轮证据。' },
          diff: { type: 'string', description: '建议 diff 内容。' },
        },
        required: ['title', 'target', 'change', 'rationale'],
      },
      output: stringOutput,
      execute: async (args, exec) => {
        const root = toolRoot(store, exec)
        const result = await store.propose(root, args)
        return `已写提案 ${result.file}（目标：${result.target}）。请在记忆面板「提案」里审阅；确认后再改目标文件。`
      },
    },
  ]
}

export function apply(ctx, config = {}) {
  const store = new MemoryStore(ctx)
  const autoRecall = config?.autoRecall !== false
  const autoRecallLimit = Number.isInteger(config?.autoRecallLimit)
    ? Math.max(1, Math.min(6, config.autoRecallLimit))
    : 3

  ctx.inject(['tools'], (scope) => {
    for (const definition of buildTools(store)) {
      scope.effect(() => scope.tools.register(definition), `memory: tool ${definition.name}`)
    }
  })

  ctx.inject(['systemPrompt'], (scope) => {
    scope.effect(() => scope.systemPrompt.section({
      name: 'memory',
      order: 9100,
      text: PROMPT,
    }), 'memory: prompt section')
  })

  ctx.inject(['webServer'], (web) => {
    web.effect(() => {
      const rejectionOf = (req, res) => {
        const connection = ctx.get('connection')
        if (connection === undefined || typeof connection.requestRejection !== 'function') return false
        const rejection = connection.requestRejection(req)
        if (rejection === undefined) return false
        res.statusCode = rejection
        res.end()
        return true
      }

      const state = web.webServer.register({
        kind: 'exact',
        path: ROUTE_STATE,
        handler: (req, res) => {
          if (rejectionOf(req, res)) return
          if (req.method !== 'GET') {
            sendMethodNotAllowed(res, 'GET')
            return
          }
          try {
            const url = new URL(String(req.url ?? '/'), 'http://localhost')
            const requested = url.searchParams.get('project') ?? ''
            const projects = store.projects()
            const project = projects.some((row) => row.path === requested)
              ? requested
              : store.defaultProject()
            if (project === '') {
              sendJson(res, 200, {
                project: '',
                title: '',
                exists: false,
                certified: false,
                schema: null,
                entries: [],
                stale: [],
                inbox: [],
                proposals: [],
                counts: { entries: 0, stale: 0, inbox: 0, proposals: 0, user: 0, byType: {} },
                index: { sync: true },
                projects,
              })
              return
            }
            sendJson(res, 200, store.snapshot(project))
          } catch (error) {
            ctx.logger.warn(`memory: state read failed: ${String(error)}`)
            sendJson(res, 500, { error: '记忆库没读出来' })
          }
        },
      })

      const mutate = web.webServer.register({
        kind: 'exact',
        path: ROUTE_MUTATE,
        handler: async (req, res) => {
          if (rejectionOf(req, res)) return
          if (req.method !== 'POST') {
            sendMethodNotAllowed(res, 'POST')
            return
          }
          let body
          try {
            body = JSON.parse(await readBody(req))
          } catch (error) {
            sendJson(res, 400, { error: error?.statusCode === 400 ? error.message : '内容格式不对' })
            return
          }
          try {
            const projects = store.projects()
            const requested = typeof body?.project === 'string' ? body.project : ''
            const project = projects.some((row) => row.path === requested) ? requested : store.defaultProject()
            if (project === '') throw fail('还没有可管理的项目记忆库')
            const action = body?.action
            if (action === 'add') {
              await store.add(project, body)
            } else if (action === 'update') {
              const reference = body.ref ?? body.id
              if (typeof reference !== 'string' || reference === '') throw fail('update 需要 ref')
              await store.update(project, reference, body)
            } else if (action === 'delete') {
              const reference = body.ref ?? body.id
              if (typeof reference !== 'string' || reference === '') throw fail('delete 需要 ref')
              await store.remove(project, reference)
            } else if (action === 'stale') {
              const reference = body.ref ?? body.id
              if (typeof reference !== 'string' || reference === '') throw fail('stale 需要 ref')
              await store.markStale(project, reference, body.reason)
            } else if (action === 'resolve') {
              const reference = body.ref ?? body.id
              if (typeof reference !== 'string' || reference === '') throw fail('resolve 需要 ref')
              await store.resolveStale(project, reference, body.decision)
            } else if (action === 'certify') {
              const snapshot = await store.certify(project)
              sendJson(res, 200, { snapshot, audit: store.audit(project) })
              return
            } else if (action === 'propose') {
              await store.propose(project, body)
            } else if (action === 'proposal-delete') {
              await store.removeProposal(project, body.file)
            } else if (action === 'audit') {
              sendJson(res, 200, { snapshot: store.snapshot(project), audit: store.audit(project) })
              return
            } else {
              throw fail('未知操作')
            }
            sendJson(res, 200, { snapshot: store.snapshot(project) })
          } catch (error) {
            const status = error?.statusCode === 400 ? 400 : 500
            if (status === 500) ctx.logger.warn(`memory: mutation failed: ${String(error)}`)
            sendJson(res, status, { error: status === 400 ? error.message : '没保存成功' })
          }
        },
      })

      return () => {
        state?.()
        mutate?.()
      }
    }, 'memory: routes')
  })

  ctx.inject(['commands'], (scope) => {
    scope.effect(() => scope.commands.register({
      name: 'reflect',
      description: '反思并沉淀本次会话的记忆',
      input: { hint: '[focus]' },
      handler: (invocation) => {
        const focus = oneLine(invocation.rawInput)
        const lines = [
          '请对本次会话做一次完整反思沉淀（/reflect）。',
          '1. 用 memory_audit 查看当前项目记忆库状态；',
          '2. 逐条核验可能失效的条目，用 memory_stale 标记或处理；',
          '3. 补写本轮值得跨会话保留的洞察（memory_write action=add，带触发、证据、失效条件）；',
          '4. 只对 AGENTS.md、spec 或 skill 的改动用 memory_propose 出提案，不要直接改。',
          '最后用一句话汇报：新增、更新、删除、提案各几条。',
        ]
        if (focus !== '') lines.push(`本轮重点：${focus}`)
        try {
          invocation.agent.followup(visibleMessage(lines.join('\n'), {
            kind: 'memory-reflect',
            form: 'notice',
            summary: '完整反思本次会话',
          }))
        } catch (error) {
          ctx.logger.warn(`memory: /reflect could not wake the agent: ${String(error)}`)
          return { kind: 'error', text: '没能启动反思，当前会话可能已经结束。' }
        }
        return { kind: 'success', text: '已开始反思：我会先体检记忆库，再补写本轮洞察。' }
      },
    }), 'memory: reflect command')
  })

  if (autoRecall) {
    const lastTurn = new WeakMap()
    ctx.on('agent/pre-step', async (payload, next) => {
      const decision = await next()
      if (decision.kind === 'reject' || payload.signal.aborted) return decision
      const agent = payload.agent
      if (agent === undefined) return decision
      if (lastTurn.get(agent) === payload.turn) return decision
      lastTurn.set(agent, payload.turn)
      try {
        const query = textOfMessages(payload.messages)
        if (query === '') return decision
        const root = store.resolve(store.cwdOf(agent))
        const hits = store.recall(root, query, autoRecallLimit, true)
        if (hits.length === 0) return decision
        const lines = [
          '〔记忆召回〕下面几条旧记忆可能与当前任务有关；只是线索，先按失效条件核验，需要全文用 memory_get。',
          ...hits.map((hit) => `- [${hit.entry.type}] ${hit.entry.hook || hit.entry.trigger} → ${hit.entry.file}#${hit.entry.id}`),
        ]
        const notice = visibleMessage(lines.join('\n'), {
          kind: 'memory-recall',
          form: 'notice',
          summary: `自动召回 ${hits.length} 条记忆`,
        })
        return { ...decision, messages: [...decision.messages, notice] }
      } catch (error) {
        ctx.logger.warn(`memory: automatic recall failed: ${String(error)}`)
        return decision
      }
    })
  }
}
