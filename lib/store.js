/**
 * Repository memory store: the only writer of `memory/`.
 *
 * All writes are validated by `contract.js`, serialized per project, written
 * atomically, and followed by a generated index update. The Host tools, the Web
 * routes, and the sidebar panel call the same methods.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  ID_RE,
  LEXICON_FILE,
  MEMORY_DIR,
  PROPOSAL_APPLIED,
  PROPOSAL_PENDING,
  REQUIRED_FIELDS,
  SCHEMA_VERSION,
  SCOPES,
  SPECIAL_FILES,
  STALE_LINE_RE,
  TOPIC_FILES,
  TOPIC_FILE_RE,
  TYPE_FILE,
  TYPES,
  buildLexicon,
  canonText,
  entryText,
  evidencePaths,
  entryProblems,
  isDate,
  lexiconWithoutTerm,
  lexiconWithTerms,
  newId,
  oneLine,
  parseIndexLine,
  parseIndexText,
  parseLexiconText,
  parseProposalText,
  parseStaleText,
  parseTopicText,
  rankEntries,
  renderEntryData,
  renderIndexLines,
  renderProposalApplied,
  renderStaleLine,
  rewriteSection,
  schemaVersionOf,
  termHitsIn,
  today,
} from './contract.js'

/**
 * An alias that would rewrite more entries than this is refused unless the
 * caller explicitly forces it with a reason: those words carry their own
 * meaning in the corpus and merging them erases a distinction.
 */
const LEXICON_RISK_LIMIT = 10

function lexiconSkeleton() {
  return [
    '# 词表',
    '',
    '检索用的同义词表：左列是库里的写法，右列是口语/别的叫法。由 agent 通过记忆插件维护，不要手改。',
    '格式：一行一组，`- 规范词 = 别名, 别名`；`#` 开头是注释。',
    '',
  ].join('\n')
}

function fail(message) {
  const error = new Error(message)
  error.statusCode = 400
  return error
}

/** Proposals stay pending until a human approves and the change lands. */
const isPendingProposal = (proposal) => proposal.status !== PROPOSAL_APPLIED

function readTextSafe(file) {
  try {
    return readFileSync(file, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

async function atomicWrite(file, text) {
  await mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`
  await writeFile(temporary, text, 'utf8')
  await rename(temporary, file)
}

function memorySkeleton() {
  return [
    '# MEMORY — 可探索记忆索引',
    `<!-- memory-schema: ${SCHEMA_VERSION} -->`,
    '',
    '经验性记忆，非权威 spec。按需读取，使用前按条目的失效条件核验仍成立。',
    '索引行写触发钩子（下次什么情境下该读），并用 `file#id` 定位条目；结论留在主题文件条目里。',
    '',
    '## 主题文件',
    '',
    ...Object.entries(TOPIC_FILES).map(([file, title]) => `- ${file} — ${title}`),
    '',
    '## 条目',
    '',
    '（无）',
    '',
    '## 待确认提案',
    '',
    '（无）',
    '',
  ].join('\n')
}

const STALE_SKELETON = '# 待清理\n\n（无）\n'
const INBOX_SKELETON = '# 待补\n\n（无）\n'

function normalizeProject(value) {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (trimmed === '') return ''
  const normalized = path.normalize(trimmed)
  return normalized.length > 1 && normalized.endsWith(path.sep) ? normalized.slice(0, -1) : normalized
}

function projectTitle(value) {
  if (value === '') return '未归属项目'
  return path.basename(value) || value
}

/** Map one parsed entry to the JSON-safe shape the panel and tools consume. */
export function publicEntry(entry) {
  return {
    file: entry.file,
    id: entry.id,
    title: entry.title,
    date: entry.date,
    type: entry.type,
    scope: entry.scope,
    hook: entry.hook,
    trigger: entry.trigger,
    evidence: entry.evidence,
    captured: entry.captured,
    verified: entry.verified ?? '',
    invalidation: entry.invalidation,
    content: entry.content,
    problems: entry.problems ?? [],
    stale: Boolean(entry.stale),
  }
}

export class MemoryStore {
  constructor(ctx) {
    this.ctx = ctx
    this.cache = new Map()
    this.locks = new Map()
  }

  /** The directory that owns one session's memory. */
  resolve(cwd) {
    const start = path.resolve(cwd === undefined || cwd === '' ? process.cwd() : cwd)
    let directory = start
    try {
      if (!statSync(directory).isDirectory()) directory = path.dirname(directory)
    } catch {
      // A missing cwd still walks from the stated spelling.
    }
    let gitRoot = ''
    for (;;) {
      if (existsSync(path.join(directory, MEMORY_DIR))) return directory
      if (gitRoot === '' && existsSync(path.join(directory, '.git'))) gitRoot = directory
      const parent = path.dirname(directory)
      if (parent === directory) break
      directory = parent
    }
    return gitRoot === '' ? start : gitRoot
  }

  /** Effective cwd for a live agent, or the service default. */
  cwdOf(agent) {
    const working = this.ctx.get('workingDirectory')
    try {
      if (agent?.session !== undefined && working !== undefined) return working.get(agent.session)
    } catch {
      // Fall through to the session header.
    }
    const header = agent?.session?.header
    if (typeof header?.cwd === 'string' && header.cwd !== '') return header.cwd
    if (typeof working?.defaultDirectory === 'string') return working.defaultDirectory
    return process.cwd()
  }

  /** Registered workspaces, the default directory, and live session directories. */
  workspaceRows() {
    const rows = new Map()
    const add = (value, title) => {
      const project = normalizeProject(value)
      if (project === '') return
      if (!rows.has(project)) rows.set(project, { path: project, title: typeof title === 'string' && title !== '' ? title : projectTitle(project) })
    }
    try {
      const registry = this.ctx.get('workspaceRegistry')
      if (registry !== undefined) {
        for (const workspace of registry.list()) add(workspace.path, workspace.title)
      }
    } catch (error) {
      this.ctx.logger.warn(`memory: cannot list workspaces: ${String(error)}`)
    }
    try {
      const working = this.ctx.get('workingDirectory')
      if (typeof working?.defaultDirectory === 'string') add(working.defaultDirectory)
    } catch {
      // Optional service.
    }
    try {
      const agents = this.ctx.get('agents')
      if (agents !== undefined) {
        for (const agent of agents.list()) add(this.cwdOf(agent))
      }
    } catch {
      // Optional service.
    }
    return [...rows.values()]
  }

  /** Every project that already owns a `memory/` directory. */
  projects() {
    const rows = []
    for (const row of this.workspaceRows()) {
      if (!existsSync(path.join(row.path, MEMORY_DIR))) continue
      const loaded = this.load(row.path)
      rows.push({
        path: row.path,
        title: row.title,
        count: loaded.entries.length,
        stale: loaded.stale.length,
        proposals: loaded.proposals.filter(isPendingProposal).length,
      })
    }
    rows.sort((left, right) => (
      right.count - left.count || left.title.localeCompare(right.title)
    ))
    return rows
  }

  /** The current session's project when possible, otherwise the largest one. */
  defaultProject() {
    const projects = this.projects()
    if (projects.length === 0) return ''
    let candidate = ''
    try {
      const agents = this.ctx.get('agents')
      const list = agents?.list?.() ?? []
      const last = list[list.length - 1]
      candidate = this.resolve(last === undefined ? this.cwdOf(undefined) : this.cwdOf(last))
    } catch {
      candidate = ''
    }
    if (candidate !== '' && projects.some((row) => row.path === candidate)) return candidate
    return projects[0].path
  }

  titleOf(root) {
    const project = normalizeProject(root)
    const found = this.workspaceRows().find((row) => row.path === project)
    return found?.title ?? projectTitle(project)
  }

  /** Cache key: every relevant file's name, size, and mtime. */
  signature(mem) {
    try {
      const parts = []
      for (const entry of readdirSync(mem, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (entry.name !== 'proposals') continue
          for (const proposal of readdirSync(path.join(mem, entry.name), { withFileTypes: true })) {
            if (!proposal.isFile()) continue
            const file = path.join(mem, entry.name, proposal.name)
            const stat = statSync(file)
            parts.push(`proposals/${proposal.name}:${stat.size}:${stat.mtimeMs}`)
          }
          continue
        }
        if (!entry.name.endsWith('.md')) continue
        const file = path.join(mem, entry.name)
        const stat = statSync(file)
        parts.push(`${entry.name}:${stat.size}:${stat.mtimeMs}`)
      }
      return parts.sort().join('|')
    } catch {
      return ''
    }
  }

  /** Parse one project's memory directory, with a small mtime-keyed cache. */
  load(root) {
    const project = normalizeProject(path.resolve(root))
    const mem = path.join(project, MEMORY_DIR)
    const empty = {
      root: project,
      mem,
      exists: false,
      topicFiles: [],
      entries: [],
      stale: [],
      staleMalformed: [],
      inbox: [],
      proposals: [],
      index: { marker: null, entryLines: [], proposalLines: [], hasEntrySection: false, hasProposalSection: false },
      marker: null,
      indexSync: true,
      lexicon: null,
      lexiconGroups: [],
      lexiconIssues: [],
    }
    if (!existsSync(mem)) return empty
    const signature = this.signature(mem)
    const cached = this.cache.get(project)
    if (cached !== undefined && cached.signature === signature) return cached.value

    const present = readdirSync(mem).filter((name) => name.endsWith('.md') && !SPECIAL_FILES.has(name))
    const topicFiles = [
      ...Object.keys(TOPIC_FILES).filter((name) => present.includes(name)),
      ...present.filter((name) => !(name in TOPIC_FILES)).sort(),
    ]
    const entries = []
    for (const file of topicFiles) {
      const text = readTextSafe(path.join(mem, file))
      if (text === null) continue
      for (const entry of parseTopicText(file, text)) {
        entry.problems = entryProblems(entry)
        entries.push(entry)
      }
    }
    // Duplicate ids are a file-local contract violation.
    const idCounts = new Map()
    for (const entry of entries) {
      const key = `${entry.file}#${entry.id}`
      idCounts.set(key, (idCounts.get(key) ?? 0) + 1)
    }
    for (const entry of entries) {
      const count = idCounts.get(`${entry.file}#${entry.id}`) ?? 0
      if (entry.id !== '' && count > 1) {
        entry.problems.push({ level: 'error', code: 'duplicate-id', message: `id 在 ${entry.file} 中重复：${entry.id}` })
      }
    }

    const staleText = readTextSafe(path.join(mem, 'stale.md')) ?? ''
    const stale = parseStaleText(staleText)
    const staleKeys = new Set(stale.records.map((record) => `${record.file}#${record.id}`))
    for (const entry of entries) entry.stale = staleKeys.has(`${entry.file}#${entry.id}`)

    const proposals = []
    const proposalsDir = path.join(mem, 'proposals')
    if (existsSync(proposalsDir)) {
      for (const file of readdirSync(proposalsDir).filter((name) => name.endsWith('.md')).sort()) {
        const text = readTextSafe(path.join(proposalsDir, file)) ?? ''
        const dateMatch = /^(\d{4}-\d{2}-\d{2})/.exec(file)
        const parsed = parseProposalText(text)
        proposals.push({
          file,
          date: dateMatch?.[1] ?? '',
          title: parsed.title || file,
          status: parsed.status,
          approvedAt: parsed.approvedAt,
          approval: parsed.approval,
          sections: parsed.sections,
          content: text,
        })
      }
    }

    const inbox = []
    for (const raw of (readTextSafe(path.join(mem, 'inbox.md')) ?? '').split(/\r?\n/)) {
      const line = raw.trim()
      if (line === '' || line === '（无）' || line.startsWith('#')) continue
      // Prose and the format template are not pending rows; only a dashed row
      // is a real inbox item.
      if (!line.startsWith('-')) continue
      if (line.includes('<') || line.includes('YYYY')) continue
      inbox.push({ line })
    }

    const lexiconParsed = parseLexiconText(readTextSafe(path.join(mem, LEXICON_FILE)) ?? '')
    const lexicon = buildLexicon(lexiconParsed.groups)

    const index = parseIndexText(readTextSafe(path.join(mem, 'MEMORY.md')) ?? '')
    const rendered = renderIndexLines(entries)
    const indexSync = rendered.length === index.entryLines.length
      && rendered.every((line, position) => line === index.entryLines[position])

    const value = {
      root: project,
      mem,
      exists: true,
      topicFiles,
      entries,
      stale: stale.records,
      staleMalformed: stale.malformed,
      inbox,
      proposals,
      index,
      marker: index.marker,
      indexSync,
      lexicon,
      lexiconGroups: lexiconParsed.groups,
      lexiconIssues: lexiconParsed.issues,
    }
    this.cache.set(project, { signature, value })
    return value
  }

  /** Serialize writes per project. */
  serialize(root, operation) {
    const key = normalizeProject(path.resolve(root))
    const previous = this.locks.get(key) ?? Promise.resolve()
    const next = previous.then(operation, operation)
    this.locks.set(key, next.catch(() => {}))
    return next
  }

  /** Create the standard layout without touching existing content. */
  async ensureLayout(root, type = '') {
    const mem = path.join(root, MEMORY_DIR)
    await mkdir(mem, { recursive: true })
    await mkdir(path.join(mem, 'proposals'), { recursive: true })
    if (!existsSync(path.join(mem, 'MEMORY.md'))) await atomicWrite(path.join(mem, 'MEMORY.md'), memorySkeleton())
    if (!existsSync(path.join(mem, 'stale.md'))) await atomicWrite(path.join(mem, 'stale.md'), STALE_SKELETON)
    if (!existsSync(path.join(mem, 'inbox.md'))) await atomicWrite(path.join(mem, 'inbox.md'), INBOX_SKELETON)
    for (const [file, title] of Object.entries(TOPIC_FILES)) {
      if (!existsSync(path.join(mem, file))) await atomicWrite(path.join(mem, file), `# ${title}\n`)
    }
    const target = TYPE_FILE[type]
    if (target !== undefined && !existsSync(path.join(mem, target))) await atomicWrite(path.join(mem, target), `# ${type}\n`)
    this.cache.delete(normalizeProject(root))
    return mem
  }

  /** Normalize one write payload and enforce the field contract. */
  normalize(input, current = undefined, options = undefined) {
    const source = input ?? {}
    const verified = options?.verified !== undefined ? options.verified : (current?.verified ?? '')
    const type = oneLine(source.type ?? current?.type ?? '')
    const fileSource = oneLine(source.file ?? source.topic ?? current?.file ?? '')
    let file = fileSource
    if (file === '' && type !== '') file = TYPE_FILE[type] ?? ''
    if (file !== '' && !file.endsWith('.md')) file = `${file}.md`
    if (type === '' && file !== '') {
      const mapped = TOPIC_FILES[file]
      if (mapped !== undefined) {
        // `决策及原因` is the file heading; entries store the short type.
        return this.normalize({ ...source, type: mapped === '决策及原因' ? '决策' : mapped }, current)
      }
    }
    const data = {
      id: oneLine(source.id ?? current?.id ?? ''),
      title: oneLine(source.title ?? current?.title ?? ''),
      type,
      scope: oneLine(source.scope ?? current?.scope ?? 'project'),
      hook: oneLine(source.hook ?? current?.hook ?? ''),
      trigger: String(source.trigger ?? current?.trigger ?? '').trim(),
      evidence: oneLine(source.evidence ?? current?.evidence ?? ''),
      captured: oneLine(source.captured ?? current?.captured ?? today()),
      verified: oneLine(verified),
      invalidation: oneLine(source.invalidation ?? current?.invalidation ?? ''),
      content: String(source.content ?? current?.content ?? '').replace(/\s+$/, ''),
      file,
    }
    if (data.id === '') data.id = newId(data.type)
    if (data.title === '') throw fail('标题不能为空')
    if (!TYPES.includes(data.type)) throw fail(`类型只能是：${TYPES.join('、')}`)
    if (!SCOPES.includes(data.scope)) throw fail(`作用域只能是：${SCOPES.join('、')}`)
    if (!ID_RE.test(data.id)) throw fail('id 只能使用小写字母、数字、点、下划线、连字符')
    if (data.file === '') data.file = TYPE_FILE[data.type]
    if (!TOPIC_FILE_RE.test(data.file) || SPECIAL_FILES.has(data.file)) throw fail(`主题文件名不合法：${data.file}`)
    if (data.hook.includes('→')) throw fail('钩子不能包含 →')
    if (!isDate(data.captured)) throw fail(`捕获日期不合法：${data.captured}`)
    if (data.verified !== '' && !isDate(data.verified)) throw fail(`核验日期不合法：${data.verified}`)
    const requiredKey = {
      id: 'id',
      类型: 'type',
      作用域: 'scope',
      触发: 'trigger',
      证据: 'evidence',
      捕获于: 'captured',
      失效条件: 'invalidation',
      内容: 'content',
    }
    for (const field of REQUIRED_FIELDS) {
      if (field === 'id' || field === '捕获于' || field === '类型' || field === '作用域') continue
      if (String(data[requiredKey[field]] ?? '').trim() === '') throw fail(`「${field}」不能为空`)
    }
    return data
  }

  /** Find one entry by `id` or `file#id`. */
  find(root, reference) {
    const loaded = this.load(root)
    const value = oneLine(reference)
    if (value === '') throw fail('缺少条目 id')
    if (value.includes('#')) {
      const [file, id] = value.split('#')
      const entry = loaded.entries.find((candidate) => candidate.file === file && candidate.id === id)
      if (entry === undefined) throw fail(`找不到条目 ${value}`)
      return entry
    }
    const matches = loaded.entries.filter((candidate) => candidate.id === value)
    if (matches.length === 0) throw fail(`找不到条目 ${value}`)
    if (matches.length > 1) throw fail(`id ${value} 不唯一，请用 file#id 指定`)
    return matches[0]
  }

  /** One project snapshot for the panel. */
  snapshot(root) {
    const loaded = this.load(root)
    const staleEntries = loaded.stale.map((record) => {
      const entry = loaded.entries.find((candidate) => candidate.file === record.file && candidate.id === record.id)
      return { ...record, entry: entry === undefined ? null : publicEntry(entry) }
    })
    const byType = {}
    for (const entry of loaded.entries) byType[entry.type] = (byType[entry.type] ?? 0) + 1
    return {
      project: loaded.root,
      title: this.titleOf(loaded.root),
      exists: loaded.exists,
      certified: loaded.exists && loaded.marker === SCHEMA_VERSION,
      schema: loaded.marker,
      entries: [...loaded.entries]
        .sort((left, right) => right.date.localeCompare(left.date) || left.title.localeCompare(right.title))
        .map(publicEntry),
      stale: staleEntries,
      inbox: loaded.inbox,
      proposals: loaded.proposals,
      counts: {
        entries: loaded.entries.length,
        stale: loaded.stale.length,
        inbox: loaded.inbox.length,
        proposals: loaded.proposals.filter(isPendingProposal).length,
        user: loaded.entries.filter((entry) => entry.scope === 'user').length,
        byType,
      },
      index: { sync: loaded.indexSync },
      lexicon: { groups: loaded.lexiconGroups, issues: loaded.lexiconIssues },
      projects: this.projects(),
    }
  }

  /** Rebuild the generated index and topic/proposal sections. */
  async writeIndex(root) {
    const loaded = this.load(root)
    const mem = path.join(root, MEMORY_DIR)
    await mkdir(mem, { recursive: true })
    const file = path.join(mem, 'MEMORY.md')
    let text = readTextSafe(file)
    if (text === null) text = memorySkeleton()
    if ((schemaVersionOf(text) ?? 0) > SCHEMA_VERSION) throw fail(`记忆格式版本高于插件支持的 ${SCHEMA_VERSION}，拒绝写入`)
    text = text.replace(/「条目」区块由 `reflect-memory\.py index` 从条目生成，禁止手写。/g, '「条目」区块由记忆插件从条目生成，禁止手写。')
    text = text.replace(/由 `reflect-memory\.py index` 从条目生成/g, '由记忆插件从条目生成')
    const topicLines = loaded.topicFiles.map((name) => {
      const heading = readTextSafe(path.join(mem, name))
        ?.split(/\r?\n/)
        .find((line) => line.startsWith('# '))
      return `- ${name} — ${heading === undefined ? (TOPIC_FILES[name] ?? name) : heading.slice(2).trim()}`
    })
    const proposalLines = loaded.proposals
      .filter(isPendingProposal)
      .map((proposal) => (
        `- ${proposal.date === '' ? '未标日期' : proposal.date} ${proposal.title} → proposals/${proposal.file}`
      ))
    if (!text.includes('## 主题文件')) {
      text = text.replace('## 条目', `## 主题文件\n\n${topicLines.join('\n')}\n\n## 条目`)
    } else {
      text = rewriteSection(text, '主题文件', topicLines)
    }
    text = rewriteSection(text, '条目', renderIndexLines(loaded.entries))
    text = rewriteSection(text, '待确认提案', proposalLines)
    const marker = schemaVersionOf(text)
    if (marker === null) {
      const lines = text.split(/\r?\n/)
      const at = lines[0]?.startsWith('#') ? 1 : 0
      lines.splice(at, 0, `<!-- memory-schema: ${SCHEMA_VERSION} -->`)
      text = lines.join('\n')
    } else if (marker !== SCHEMA_VERSION) {
      text = text.replace(/<!--\s*memory-schema:\s*\d+\s*-->/, `<!-- memory-schema: ${SCHEMA_VERSION} -->`)
    }
    await atomicWrite(file, text)
    this.cache.delete(loaded.root)
    return text
  }

  /** Add one entry. */
  async add(root, input) {
    return this.serialize(root, async () => {
      const data = await this.resolveEvidenceInput(root, this.normalize(input))
      const loaded = this.load(root)
      if ((loaded.marker ?? 0) > SCHEMA_VERSION) throw fail(`记忆格式版本高于插件支持的 ${SCHEMA_VERSION}，拒绝写入`)
      const duplicate = loaded.entries.find((entry) => entry.file === data.file && entry.id === data.id)
      if (duplicate !== undefined) throw fail(`id ${data.id} 在 ${data.file} 中已存在`)
      const mem = await this.ensureLayout(root, data.type)
      const file = path.join(mem, data.file)
      let text = readTextSafe(file) ?? `# ${TOPIC_FILES[data.file] ?? data.type}\n`
      if (!text.endsWith('\n')) text += '\n'
      if (text.trim() !== '' && !text.endsWith('\n\n')) text += '\n'
      text += renderEntryData(data)
      await atomicWrite(file, text)
      this.cache.delete(loaded.root)
      await this.writeIndex(loaded.root)
      return this.find(loaded.root, `${data.file}#${data.id}`)
    })
  }

  /**
   * Rewrite one entry, moving it when its type changes.
   *
   * `patch` is a partial update: omitted fields keep their current value. The
   * `id` field is a locator, never a payload — a caller may echo `file#id`
   * there without tripping the identity guard.
   */
  async update(root, reference, patch) {
    return this.serialize(root, async () => {
      const current = this.find(root, reference)
      const echoed = oneLine(patch?.id ?? '')
      if (echoed !== '' && echoed !== current.id && echoed !== oneLine(reference)) throw fail('不支持修改条目 id')
      const requestedType = oneLine(patch?.type ?? '')
      const requestedFile = oneLine(patch?.file ?? patch?.topic ?? '')
      const nextFile = requestedFile !== ''
        ? requestedFile
        : (requestedType !== '' && requestedType !== current.type ? TYPE_FILE[requestedType] : current.file)
      const data = await this.resolveEvidenceInput(
        root,
        this.normalize({ ...patch, id: current.id, file: nextFile }, current),
        patch?.evidence !== undefined,
      )
      if (nextFile !== current.file) {
        const pre = this.load(root)
        const conflict = pre.entries.find((entry) => entry.file === nextFile && entry.id === data.id)
        if (conflict !== undefined && conflict !== current) throw fail(`id ${data.id} 在 ${nextFile} 中已存在`)
        await this.removeEntry(root, current)
        const loaded = this.load(root)
        if (loaded.entries.some((entry) => entry.file === nextFile && entry.id === data.id)) {
          throw fail(`id ${data.id} 在 ${nextFile} 中已存在`)
        }
        const mem = await this.ensureLayout(root, data.type)
        const file = path.join(mem, nextFile)
        let text = readTextSafe(file) ?? `# ${TOPIC_FILES[nextFile] ?? data.type}\n`
        if (!text.endsWith('\n')) text += '\n'
        if (text.trim() !== '' && !text.endsWith('\n\n')) text += '\n'
        text += renderEntryData(data)
        await atomicWrite(file, text)
        this.cache.delete(normalizeProject(root))
        await this.writeIndex(root)
        return this.find(root, `${nextFile}#${data.id}`)
      }
      await this.applyEntryData(root, current, data)
      await this.writeIndex(root)
      return this.find(root, `${data.file}#${data.id}`)
    })
  }

  /** Replace one entry block in place; the caller owns serialization. */
  async applyEntryData(root, current, data) {
    const file = path.join(root, MEMORY_DIR, current.file)
    const text = readTextSafe(file) ?? ''
    const lines = text.split(/\r?\n/)
    const rendered = renderEntryData(data).trimEnd().split(/\r?\n/)
    const before = lines.slice(0, current.startLine)
    const after = lines.slice(current.endLine + 1)
    while (after.length > 0 && after[0].trim() === '') after.shift()
    const out = [...before, ...rendered]
    if (after.length > 0) out.push('', ...after)
    await atomicWrite(file, `${out.join('\n').replace(/\n+$/, '')}\n`)
    this.cache.delete(normalizeProject(root))
  }

  /** Record that one entry still holds today; the content is untouched. */
  async verify(root, reference) {
    return this.serialize(root, async () => {
      const entry = this.find(root, reference)
      const data = this.normalize({}, entry, { verified: today() })
      await this.applyEntryData(root, entry, data)
      await this.writeIndex(root)
      return { file: entry.file, id: entry.id, title: entry.title, verified: data.verified }
    })
  }

  /**
   * Resolve `证据` paths before writing. A short citation whose suffix matches
   * exactly one repository file is completed to the repository-relative path;
   * an ambiguous one is refused so the writer disambiguates; an unknown one is
   * left alone for the audit to report.
   */
  async resolveEvidenceInput(root, data, enabled = true) {
    if (!enabled || typeof data?.evidence !== 'string' || data.evidence === '') return data
    const evidence = this.resolveEvidence(root, data.evidence)
    return evidence === data.evidence ? data : { ...data, evidence }
  }

  resolveEvidence(root, evidence) {
    const pattern = /([A-Za-z0-9_@./~-]+\.[A-Za-z0-9]{1,10})(?=:\d+(?:-\d+)?|\s+第\s*\d+\s*行)/g
    let text = evidence
    let index
    for (const match of evidence.matchAll(pattern)) {
      const cited = match[1]
      if (cited.includes('://') || cited.startsWith('/') || cited.startsWith('~')) continue
      // Bare file names are ambiguous by design; only paths with a directory
      // component are completed.
      if (!cited.includes('/')) continue
      if (existsSync(path.join(root, cited))) continue
      index = index ?? this.suffixIndex(root)
      const candidates = index.get(cited) ?? []
      if (candidates.length === 1) {
        text = text.split(cited).join(candidates[0])
        continue
      }
      if (candidates.length > 1) {
        throw fail(`证据路径不唯一：${cited}；请写仓库根相对路径（候选：${candidates.slice(0, 3).join('、')}）`)
      }
    }
    return text
  }

  /** Repository files keyed by every path suffix, skipping build and vendor trees. */
  suffixIndex(root) {
    const index = new Map()
    const skip = new Set(['node_modules', '.git', 'dist', 'dist-desktop', '.publish', 'promo-video', 'memory'])
    const walk = (directory, depth) => {
      if (depth > 14) return
      let rows = []
      try {
        rows = readdirSync(directory, { withFileTypes: true })
      } catch {
        return
      }
      for (const row of rows) {
        if (skip.has(row.name)) continue
        const absolute = path.join(directory, row.name)
        if (row.isDirectory()) {
          walk(absolute, depth + 1)
          continue
        }
        const relative = path.relative(root, absolute).split(path.sep).join('/')
        for (let at = 0; at < relative.length; at += 1) {
          if (relative[at] !== '/') continue
          const suffix = relative.slice(at + 1)
          const hits = index.get(suffix) ?? []
          if (hits.length < 5) hits.push(relative)
          index.set(suffix, hits)
        }
      }
    }
    walk(root, 0)
    return index
  }

  /** Remove one entry block and its stale-queue lines. */
  async removeEntry(root, current) {
    const file = path.join(root, MEMORY_DIR, current.file)
    const text = readTextSafe(file) ?? ''
    const lines = text.split(/\r?\n/)
    let start = current.startLine
    if (start > 0 && lines[start - 1].trim() === '') start -= 1
    const out = [...lines.slice(0, start), ...lines.slice(current.endLine + 1)]
    await atomicWrite(file, `${out.join('\n').replace(/\n+$/, '')}\n`)
    this.cache.delete(root)
    await this.removeStaleKey(root, `${current.file}#${current.id}`)
  }

  /** Delete one entry by reference. */
  async remove(root, reference) {
    return this.serialize(root, async () => {
      const current = this.find(root, reference)
      await this.removeEntry(root, current)
      await this.writeIndex(root)
      return { file: current.file, id: current.id, title: current.title }
    })
  }

  /** Remove queue lines for one `file#id`. */
  async removeStaleKey(root, key) {
    const file = path.join(root, MEMORY_DIR, 'stale.md')
    const text = readTextSafe(file) ?? STALE_SKELETON
    const lines = text.split(/\r?\n/)
    const kept = []
    for (const raw of lines) {
      const line = raw.trim()
      const match = STALE_LINE_RE.exec(line)
      if (match !== null && `${match[2]}#${match[3]}` === key) continue
      kept.push(raw)
    }
    const meaningful = kept.filter((line) => line.trim() !== '' && line.trim() !== '（无）')
    await atomicWrite(file, meaningful.length === 0 ? STALE_SKELETON : `${kept.join('\n').replace(/\n+$/, '')}\n`)
    this.cache.delete(normalizeProject(root))
  }

  /** Mark an entry as suspect, or update the reason when it is already queued. */
  async markStale(root, reference, reason) {
    return this.serialize(root, async () => {
      const entry = this.find(root, reference)
      const evidence = oneLine(reason)
      if (evidence === '') throw fail('标记失效必须写理由')
      const file = path.join(root, MEMORY_DIR, 'stale.md')
      const text = readTextSafe(file) ?? STALE_SKELETON
      const key = `${entry.file}#${entry.id}`
      const kept = []
      let replaced = false
      for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim()
        if (line === '（无）') continue
        const match = STALE_LINE_RE.exec(line)
        if (match !== null && `${match[2]}#${match[3]}` === key) {
          kept.push(renderStaleLine(today(), entry.file, entry.id, evidence))
          replaced = true
          continue
        }
        kept.push(raw)
      }
      if (!replaced) kept.push(renderStaleLine(today(), entry.file, entry.id, evidence))
      const meaningful = kept.filter((line) => line.trim() !== '')
      await atomicWrite(file, `${meaningful.join('\n').replace(/\n+$/, '')}\n`)
      this.cache.delete(normalizeProject(root))
      return { file: entry.file, id: entry.id, title: entry.title, reason: evidence }
    })
  }

  /** Resolve one stale queue record by deleting or keeping its entry. */
  async resolveStale(root, reference, decision) {
    return this.serialize(root, async () => {
      const value = oneLine(reference)
      if (!value.includes('#')) throw fail('处理失效需要 file#id')
      const key = value
      const loaded = this.load(root)
      const queued = loaded.stale.find((record) => `${record.file}#${record.id}` === key)
      if (queued === undefined) throw fail(`待清理队列里没有 ${key}`)
      if (decision !== 'delete' && decision !== 'keep') throw fail('decision 只能是 delete 或 keep')
      if (decision === 'delete') {
        const entry = loaded.entries.find((candidate) => `${candidate.file}#${candidate.id}` === key)
        if (entry !== undefined) {
          await this.removeEntry(root, entry)
          await this.writeIndex(root)
        } else {
          await this.removeStaleKey(root, key)
        }
      } else {
        const entry = loaded.entries.find((candidate) => `${candidate.file}#${candidate.id}` === key)
        await this.removeStaleKey(root, key)
        // Keeping an entry after review is itself a verification event.
        if (entry !== undefined) {
          const data = this.normalize({}, entry, { verified: today() })
          await this.applyEntryData(root, entry, data)
          await this.writeIndex(root)
        }
      }
      return { key, decision }
    })
  }

  /** Write one proposal, always as its own file so it can be closed alone. */
  async propose(root, input) {
    return this.serialize(root, async () => {
      const title = oneLine(input.title)
      const target = oneLine(input.target)
      const change = oneLine(input.change)
      const rationale = String(input.rationale ?? '').trim()
      if (title === '' || target === '' || change === '') throw fail('提案需要标题、目标文件和改动类型')
      if (rationale === '') throw fail('提案需要理由')
      const date = oneLine(input.date) || today()
      if (!isDate(date)) throw fail(`提案日期不合法：${date}`)
      const mem = await this.ensureLayout(root)
      const directory = path.join(mem, 'proposals')
      const existing = new Set(readdirSync(directory).filter((name) => name.endsWith('.md')))
      let number = 1
      let name = `${date}.md`
      while (existing.has(name)) {
        number += 1
        name = `${date}-${number}.md`
      }
      const section = [
        `## 提案 ${number} — ${title}`,
        `- 目标文件: ${target}`,
        `- 改动类型: ${change}`,
        '- 建议 diff:',
        '  ```diff',
        ...String(input.diff ?? '').split(/\r?\n/).map((line) => `  ${line}`),
        '  ```',
        `- 依据: ${oneLine(input.evidence) || '本轮会话'}`,
        `- 理由: ${rationale.replace(/\s+/g, ' ')}`,
        `- 状态: ${PROPOSAL_PENDING}`,
        '',
      ].join('\n')
      await atomicWrite(path.join(directory, name), `# 必读层提案 ${date}\n\n${section}`)
      this.cache.delete(normalizeProject(root))
      await this.writeIndex(root)
      return { file: `proposals/${name}`, title, target }
    })
  }

  /**
   * Close one proposal after the user approved it and the edit landed. The
   * approval wording is mandatory: it is the only record that a human agreed.
   */
  async resolveProposal(root, reference, evidence) {
    return this.serialize(root, async () => {
      const name = path.basename(oneLine(reference))
      if (!name.endsWith('.md')) throw fail('提案文件名不合法')
      const target = path.join(root, MEMORY_DIR, 'proposals', name)
      if (!existsSync(target)) throw fail(`找不到提案 ${name}`)
      const text = readTextSafe(target) ?? ''
      const parsed = parseProposalText(text)
      if (parsed.status === PROPOSAL_APPLIED) {
        throw fail(`提案已经标记为已应用（${parsed.approvedAt || '日期未知'}）`)
      }
      const approval = oneLine(evidence)
      if (approval === '') throw fail('标已应用必须写批准依据：用户批准的原话')
      const cleaned = text.split(/\r?\n/)
        .filter((line) => {
          const trimmed = line.trim()
          return !/^-\s*状态\s*[:：]/.test(trimmed) && !/^-\s*批准依据\s*[:：]/.test(trimmed)
        })
        .join('\n')
        .replace(/\n+$/, '')
      const next = `${cleaned}\n${renderProposalApplied(today(), approval).join('\n')}\n`
      await atomicWrite(target, next)
      this.cache.delete(normalizeProject(root))
      await this.writeIndex(root)
      return { file: `proposals/${name}`, title: parsed.title, approvedAt: today() }
    })
  }

  /** Delete one proposal document after it was handled outside the plugin. */
  async removeProposal(root, file) {
    return this.serialize(root, async () => {
      const name = path.basename(oneLine(file))
      if (!name.endsWith('.md')) throw fail('提案文件名不合法')
      const target = path.join(root, MEMORY_DIR, 'proposals', name)
      if (!existsSync(target)) throw fail(`找不到提案 ${name}`)
      await unlink(target)
      this.cache.delete(normalizeProject(root))
      await this.writeIndex(root)
      return { file: `proposals/${name}` }
    })
  }

  /** Read-only lexicon report: groups with per-alias risk readings. */
  lexiconReport(root) {
    const loaded = this.load(root)
    if (!loaded.exists) return { exists: false, groups: [], aliases: 0, risky: [], issues: [] }
    return { exists: true, ...this.lexiconStats(loaded), issues: loaded.lexiconIssues }
  }

  /**
   * Per-alias readings over the current corpus. `affected` counts entries whose
   * text mentions the alias but never the canonical word: those entries get
   * rewritten into the canonical concept when the alias is applied.
   */
  lexiconStats(loaded) {
    const docs = loaded.entries.map((entry) => ({ entry, text: entryText(entry).toLowerCase() }))
    const groups = loaded.lexiconGroups.map((group) => {
      const entries = docs.filter((doc) => termHitsIn(doc.text, group.canonical) > 0).length
      const aliases = group.terms.map((term) => {
        const affectedDocs = docs.filter((doc) => (
          termHitsIn(doc.text, term) > 0 && termHitsIn(doc.text, group.canonical) === 0
        ))
        return {
          term,
          hits: docs.reduce((total, doc) => total + termHitsIn(doc.text, term), 0),
          affected: affectedDocs.length,
          sample: affectedDocs.slice(0, 3).map((doc) => `${doc.entry.file}#${doc.entry.id}`),
        }
      })
      return { canonical: group.canonical, entries, aliases }
    })
    const risky = groups
      .flatMap((group) => group.aliases
        .filter((alias) => alias.affected > LEXICON_RISK_LIMIT)
        .map((alias) => ({ canonical: group.canonical, ...alias })))
      .sort((left, right) => right.affected - left.affected)
    return {
      groups,
      aliases: groups.reduce((total, group) => total + group.aliases.length, 0),
      risky,
    }
  }

  /** Add aliases to one group; the only supported way to write the lexicon. */
  async lexiconAdd(root, input = {}) {
    return this.serialize(root, async () => {
      const loaded = this.load(root)
      if (!loaded.exists) throw fail('当前项目还没有 memory/；先写入一条记忆，再维护词表')
      const canonical = oneLine(input.canonical ?? '').toLowerCase()
      const evidence = oneLine(input.evidence ?? '')
      const requested = Array.isArray(input.aliases) ? input.aliases : [input.alias]
      const aliases = [...new Set(requested.map((term) => oneLine(term).toLowerCase()).filter((term) => term !== ''))]
      if (canonical === '') throw fail('add 需要 canonical：库里实际在用的写法，例如「素材」')
      if (/[\s,，、;；=:：]/.test(canonical)) throw fail(`规范词必须是单个词，不能含空格或分隔符：${canonical}`)
      if (aliases.length === 0) throw fail('add 需要 aliases：别人会怎么说，例如「贴图」')
      if (evidence === '') throw fail('add 需要 evidence：写清触发这次补充的漏检原句')
      const docs = loaded.entries.map((entry) => ({ entry, text: entryText(entry).toLowerCase() }))
      if (!docs.some((doc) => termHitsIn(doc.text, canonical) > 0)) {
        throw fail(`规范词「${canonical}」在 ${loaded.entries.length} 条记忆里一次也没出现——映射过去仍然搜不到，先确认库里到底怎么写`)
      }
      const owners = new Map()
      for (const group of loaded.lexiconGroups) {
        for (const term of group.terms) owners.set(term, group.canonical)
      }
      const fresh = []
      const present = []
      for (const term of aliases) {
        if (term === canonical) throw fail(`别名不能等于规范词：${term}`)
        if (term.length < 2) throw fail(`别名太短，会连累别的词：${term}`)
        if (/[,，、;；\n]/.test(term)) throw fail(`别名不能含分隔符：${term}`)
        const owner = owners.get(term)
        if (owner !== undefined && owner !== canonical) {
          throw fail(`别名「${term}」已经属于「${owner}」，要改归属先到 /reflect 复核`)
        }
        if (owner === canonical) present.push(term)
        else fresh.push(term)
      }
      if (fresh.length === 0) {
        return {
          canonical,
          added: [],
          present,
          created: false,
          groups: loaded.lexiconGroups.length,
          message: `「${present.join('、')}」已经在「${canonical}」这一组里，没有改动。`,
        }
      }
      const affected = fresh.flatMap((term) => docs
        .filter((doc) => termHitsIn(doc.text, term) > 0 && termHitsIn(doc.text, canonical) === 0)
        .map((doc) => ({ term, ref: `${doc.entry.file}#${doc.entry.id}` })))
      const forced = input.force === true && oneLine(input.reason ?? '') !== ''
      if (affected.length > LEXICON_RISK_LIMIT && !forced) {
        throw fail([
          `别名会把 ${affected.length} 条不含「${canonical}」的记忆也改写成同一个词，超过上限 ${LEXICON_RISK_LIMIT}，没有写入：`,
          ...affected.slice(0, 6).map((item) => `- ${item.term} → ${item.ref}`),
          affected.length > 6 ? `…还有 ${affected.length - 6} 条` : '',
          '这多半是把「相关」当成了「同义」；要到 /reflect 复核，或用 force + reason 显式强改。',
        ].filter((line) => line !== '').join('\n'))
      }
      const file = path.join(loaded.root, MEMORY_DIR, LEXICON_FILE)
      const current = readTextSafe(file) ?? lexiconSkeleton()
      const note = `# ${today()} ${forced ? 'REFLECT 强改' : '新增'}：${fresh.join(', ')}（漏检：${evidence.slice(0, 80)}）`
      const rewritten = lexiconWithTerms(current, canonical, fresh, note)
      await atomicWrite(file, rewritten.text)
      this.cache.delete(normalizeProject(loaded.root))
      const after = this.load(loaded.root)
      return {
        canonical,
        added: fresh,
        present,
        created: rewritten.created,
        forced,
        evidence,
        affected: [...new Set(affected.map((item) => item.ref))],
        groups: after.lexiconGroups.length,
        before: rankEntries(loaded.entries, evidence, 3, false, loaded.lexicon)
          .map((hit) => `${hit.entry.file}#${hit.entry.id}`),
        after: rankEntries(after.entries, evidence, 3, false, after.lexicon)
          .map((hit) => `${hit.entry.file}#${hit.entry.id}`),
      }
    })
  }

  /** Narrow or remove one mapping. Reflect-stage operation; reason is required. */
  async lexiconRemove(root, input = {}) {
    return this.serialize(root, async () => {
      const loaded = this.load(root)
      if (!loaded.exists) throw fail('当前项目还没有 memory/')
      const canonical = oneLine(input.canonical ?? '').toLowerCase()
      const alias = oneLine(input.alias ?? '').toLowerCase()
      const reason = oneLine(input.reason ?? '')
      if (canonical === '') throw fail('remove 需要 canonical')
      if (alias === '') throw fail('remove 需要 alias：要收窄或删除的那条说法')
      if (reason === '') throw fail('remove 需要 reason：写清这条映射造成的问题；反思时会留一条决策记忆')
      const file = path.join(loaded.root, MEMORY_DIR, LEXICON_FILE)
      const current = readTextSafe(file) ?? ''
      const affected = loaded.entries
        .filter((entry) => {
          const text = entryText(entry).toLowerCase()
          return termHitsIn(text, alias) > 0 && termHitsIn(text, canonical) === 0
        })
        .map((entry) => `${entry.file}#${entry.id}`)
      const rewritten = lexiconWithoutTerm(current, canonical, alias)
      if (!rewritten.removed) throw fail(`词表里没有「${alias}」→「${canonical}」这条映射`)
      await atomicWrite(file, rewritten.text)
      this.cache.delete(normalizeProject(loaded.root))
      const after = this.load(loaded.root)
      return {
        canonical,
        alias,
        reason,
        droppedGroup: rewritten.droppedGroup,
        affected,
        groups: after.lexiconGroups.length,
      }
    })
  }

  /**
   * Run current queries through the lexicon: shows the normalized wording and
   * the hits, so a reflect pass can confirm a fix without the sample fixture.
   */
  lexiconCheck(root, queries = []) {
    const loaded = this.load(root)
    const list = (Array.isArray(queries) ? queries : [queries])
      .map((query) => oneLine(query))
      .filter((query) => query !== '')
    return list.map((query) => ({
      query,
      normalized: canonText(query, loaded.lexicon),
      hits: rankEntries(loaded.entries, query, 3, false, loaded.lexicon)
        .map((hit) => ({ ref: `${hit.entry.file}#${hit.entry.id}`, score: Math.round(hit.score) })),
    }))
  }

  /** Rebuild the index and certify the shape. */
  async certify(root) {
    return this.serialize(root, async () => {
      const loaded = this.load(root)
      if (!loaded.exists) throw fail('当前项目还没有 memory/')
      if ((loaded.marker ?? 0) > SCHEMA_VERSION) throw fail(`记忆格式版本高于插件支持的 ${SCHEMA_VERSION}`)
      const errors = []
      for (const name of loaded.topicFiles) {
        if (!TOPIC_FILE_RE.test(name)) errors.push(`主题文件名不合法：${name}`)
      }
      for (const entry of loaded.entries) {
        for (const problem of entry.problems) {
          if (problem.level === 'error') errors.push(`${entry.file}#${entry.id || '?'}：${problem.message}`)
        }
      }
      for (const line of loaded.staleMalformed) errors.push(`待清理队列有无法解析的行：${line}`)
      if (errors.length > 0) {
        throw fail(`体检未通过，未重建索引：\n${errors.slice(0, 12).join('\n')}${errors.length > 12 ? `\n…还有 ${errors.length - 12} 项` : ''}`)
      }
      await this.writeIndex(root)
      return this.snapshot(root)
    })
  }

  /** Full read-only audit. */
  audit(root) {
    const loaded = this.load(root)
    const issues = []
    const push = (level, code, message, extra = {}) => issues.push({ level, code, message, ...extra })
    if (!loaded.exists) {
      return {
        exists: false,
        schema: null,
        certified: false,
        counts: { entries: 0, stale: 0, inbox: 0, proposals: 0, user: 0, byType: {} },
        indexSync: true,
        lexicon: { groups: 0, aliases: 0, risky: 0 },
        issues,
        checkedAt: new Date().toISOString(),
      }
    }
    for (const issue of loaded.lexiconIssues) push(issue.level, issue.code, issue.message)
    if (loaded.marker === null) push('warn', 'schema-missing', 'MEMORY.md 缺少 memory-schema 标记')
    else if (loaded.marker < SCHEMA_VERSION) push('warn', 'schema-old', `记忆格式版本 ${loaded.marker} 低于 ${SCHEMA_VERSION}`)
    else if (loaded.marker > SCHEMA_VERSION) push('error', 'schema-newer', `记忆格式版本 ${loaded.marker} 高于插件支持的 ${SCHEMA_VERSION}，写入已拒绝`)

    for (const entry of loaded.entries) {
      for (const problem of entry.problems) {
        push(problem.level, problem.code, `${entry.file}#${entry.id || '?'}：${problem.message}`, { file: entry.file, id: entry.id })
      }
      for (const { path: cited } of evidencePaths(`${entry.evidence}\n${entry.content}`)) {
        const target = cited.startsWith('/') ? cited : path.join(loaded.root, cited)
        if (!existsSync(target)) {
          push('warn', 'evidence-missing', `${entry.file}#${entry.id} 引用的证据文件不存在：${cited}`, { file: entry.file, id: entry.id })
        }
      }
    }

    const rendered = renderIndexLines(loaded.entries)
    const current = loaded.index.entryLines
    if (!loaded.indexSync) {
      push('warn', 'index-drift', `索引与条目不一致（生成物：当前 ${current.length} 行，应为 ${rendered.length} 行）；运行「重建索引」修复`)
    }
    const entryKeys = new Set(loaded.entries.map((entry) => `${entry.file}#${entry.id}`))
    for (const line of current) {
      const parsed = parseIndexLine(line)
      if (parsed === null) {
        push('warn', 'index-line', `无法解析的索引行：${line}`)
        continue
      }
      if (!entryKeys.has(`${parsed.file}#${parsed.id}`)) {
        push('warn', 'index-orphan', `索引指向不存在的条目：${parsed.file}#${parsed.id}`)
      }
    }
    for (const entry of loaded.entries) {
      if (!loaded.index.entryLines.some((line) => {
        const parsed = parseIndexLine(line)
        return parsed !== null && parsed.file === entry.file && parsed.id === entry.id
      })) {
        push('warn', 'entry-unindexed', `条目未出现在索引：${entry.file}#${entry.id}`, { file: entry.file, id: entry.id })
      }
    }

    for (const line of loaded.staleMalformed) push('error', 'stale-line', `待清理队列有无法解析的行：${line}`)
    for (const record of loaded.stale) {
      if (!entryKeys.has(`${record.file}#${record.id}`)) {
        push('warn', 'stale-orphan', `待清理队列指向不存在的条目：${record.file}#${record.id}`, { file: record.file, id: record.id })
      }
    }
    if (loaded.inbox.length > 0) push('warn', 'inbox-pending', `待补队列还有 ${loaded.inbox.length} 条`)

    const lexiconStats = this.lexiconStats(loaded)
    const lexicon = {
      groups: lexiconStats.groups.length,
      aliases: lexiconStats.aliases,
      risky: lexiconStats.risky.length,
    }

    const pendingProposals = loaded.proposals.filter(isPendingProposal)
    const listedProposals = new Set(loaded.index.proposalLines.map((line) => (line.split('→').pop() ?? '').trim()))
    for (const proposal of pendingProposals) {
      if (!listedProposals.has(`proposals/${proposal.file}`)) {
        push('warn', 'proposal-orphan', `提案未出现在索引：proposals/${proposal.file}`)
      }
    }
    for (const listed of listedProposals) {
      const name = listed.replace(/^proposals\//, '')
      if (!pendingProposals.some((proposal) => proposal.file === name)) {
        push('warn', 'proposal-stale', `索引里的提案已不再待确认：${listed}`)
      }
    }
    for (const proposal of loaded.proposals) {
      if ((proposal.sections ?? 1) > 1) {
        push('warn', 'proposal-legacy', `提案文件含多段，应拆成一条一文件：proposals/${proposal.file}（${proposal.sections} 段）`)
      }
    }

    const byType = {}
    for (const entry of loaded.entries) byType[entry.type] = (byType[entry.type] ?? 0) + 1
    return {
      exists: true,
      schema: loaded.marker,
      certified: loaded.marker === SCHEMA_VERSION,
      counts: {
        entries: loaded.entries.length,
        stale: loaded.stale.length,
        inbox: loaded.inbox.length,
        proposals: loaded.proposals.filter(isPendingProposal).length,
        user: loaded.entries.filter((entry) => entry.scope === 'user').length,
        byType,
      },
      indexSync: loaded.indexSync,
      lexicon,
      issues,
      checkedAt: new Date().toISOString(),
    }
  }

  /** Rank entries against one query. */
  recall(root, query, limit = 8, auto = false) {
    const loaded = this.load(root)
    return rankEntries(loaded.entries, query, limit, auto, loaded.lexicon).map((result) => ({
      ...result,
      entry: publicEntry(result.entry),
    }))
  }
}

