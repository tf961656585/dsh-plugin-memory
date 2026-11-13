/**
 * Memory contract: the single implementation of the repository memory format.
 *
 * The same parser, validator, renderer, index generator, and recall scorer are
 * used by the Host tools, the Web routes, and the tests. Nothing outside this
 * module writes a memory line.
 */

export const SCHEMA_VERSION = 3
export const MEMORY_DIR = 'memory'
export const FIELD_ORDER = ['id', '类型', '作用域', '钩子', '触发', '证据', '捕获于', '核验于', '失效条件', '内容']
export const REQUIRED_FIELDS = ['id', '类型', '作用域', '触发', '证据', '捕获于', '失效条件', '内容']
export const OPTIONAL_FIELDS = ['钩子']
export const TYPES = ['隐藏依赖', '踩坑', '决策', '偏好', '情境事实']
export const SCOPES = ['user', 'project']
export const SPECIAL_FILES = new Set(['MEMORY.md', 'stale.md', 'inbox.md', 'README.md', 'lexicon.md'])
export const LEXICON_FILE = 'lexicon.md'
export const TOPIC_FILES = {
  'dependencies.md': '隐藏依赖',
  'pitfalls.md': '踩坑',
  'decisions.md': '决策及原因',
  'preferences.md': '被纠正的偏好',
  'facts.md': '情境事实',
}
export const TYPE_FILE = {
  隐藏依赖: 'dependencies.md',
  踩坑: 'pitfalls.md',
  决策: 'decisions.md',
  偏好: 'preferences.md',
  情境事实: 'facts.md',
}
export const ID_RE = /^[a-z0-9][a-z0-9._-]*$/
export const TOPIC_FILE_RE = /^[^/\\\s#→]+\.md$/
export const INDEX_LINE_RE = /^-\s*\[([^\]]+)\]\s*(\d{4}-\d{2}-\d{2})\s+(.+?)\s*→\s*([^\s#]+)#([A-Za-z0-9._-]+)(?:\s*｜核验\s*(\d{4}-\d{2}-\d{2}))?\s*$/
export const STALE_LINE_RE = /^-\s*(\d{4}-\d{2}-\d{2})\s+([^\s#]+)#([A-Za-z0-9._-]+)\s+[—–-]\s*(.+)$/
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
export const HOOK_RESERVED = '→'

const FIELD_LINE_RE = /^-\s*([^:：\n]{1,20})\s*[:：]\s*(.*)$/
const KNOWN_FIELDS = new Set(FIELD_ORDER)
const HEADING_RE = /^##\s+(\d{4}-\d{2}-\d{2})\s+[—–-]\s*(.+?)\s*$/

/** Local calendar day, the same date basis the memory format uses. */
export function today(now = new Date()) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** Collapse any whitespace run to one space; field values are single-line. */
export function oneLine(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

/** Whether a string is a real `YYYY-MM-DD` calendar date. */
export function isDate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false
  const date = new Date(`${value}T00:00:00`)
  return !Number.isNaN(date.getTime()) && today(date) === value
}

/** Turn a title into a stable ASCII id fragment. */
export function slugOf(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
}

/** Build an id when the caller does not supply one. */
export function newId(type, now = new Date()) {
  const prefix = {
    隐藏依赖: 'dep',
    踩坑: 'pit',
    决策: 'dec',
    偏好: 'pref',
    情境事实: 'fact',
  }[type] ?? 'mem'
  const stamp = today(now).replaceAll('-', '')
  const tail = Math.random().toString(16).slice(2, 10)
  return `${prefix}-${stamp}-${tail}`
}

/**
 * Parse one topic file.
 * @param file topic file name, such as `pitfalls.md`.
 * @param text whole file content.
 * @returns entries in file order, each carrying its source line range.
 */
export function parseTopicText(file, text) {
  const lines = String(text ?? '').split(/\r?\n/)
  const entries = []
  let current = null
  let order = 0

  const finish = (endLine) => {
    if (current === null) return
    current.endLine = endLine
    current.lineCount = current.endLine - current.startLine + 1
    current.order = order++
    entries.push(current)
    current = null
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const heading = HEADING_RE.exec(line)
    if (heading !== null) {
      finish(index - 1)
      current = {
        file,
        date: heading[1],
        title: heading[2].trim(),
        fields: {},
        fieldCounts: {},
        startLine: index,
        endLine: index,
        order: 0,
        lastField: '',
        notes: [],
      }
      continue
    }
    // Any other `## ` heading closes the current entry; it is not content.
    if (/^##\s+/.test(line)) {
      finish(index - 1)
      continue
    }
    if (current === null) continue
    const field = FIELD_LINE_RE.exec(line)
    if (field !== null) {
      const name = field[1].trim()
      const value = field[2].trim()
      // A legacy field outside the schema (for example `核验`) is preserved as
      // content instead of being appended to the previous field, where it
      // would corrupt `捕获于` or `失效条件`.
      if (!KNOWN_FIELDS.has(name)) {
        current.notes.push(line.trim())
        current.lastField = ''
        continue
      }
      current.fieldCounts[name] = (current.fieldCounts[name] ?? 0) + 1
      if (!(name in current.fields)) current.fields[name] = value
      else current.fields[name] += `\n${value}`
      current.lastField = name
      continue
    }
    if (line.trim() === '') continue
    if (current.lastField !== '') {
      // The writer indents continuation lines by two spaces; preserve anything
      // beyond that as intentional content indentation.
      const continuation = line.startsWith('  ') ? line.slice(2) : line.trim()
      current.fields[current.lastField] += current.fields[current.lastField] === ''
        ? continuation
        : `\n${continuation}`
    }
  }
  finish(lines.length - 1)

  for (const entry of entries) {
    entry.id = entry.fields.id ?? ''
    entry.type = entry.fields['类型'] ?? ''
    const rawScope = entry.fields['作用域'] ?? ''
    entry.scope = rawScope.startsWith('user') ? 'user' : (rawScope.startsWith('project') ? 'project' : rawScope)
    entry.hook = entry.fields['钩子'] ?? ''
    entry.trigger = entry.fields['触发'] ?? ''
    entry.evidence = entry.fields['证据'] ?? ''
    entry.captured = entry.fields['捕获于'] ?? ''
    entry.verified = entry.fields['核验于'] ?? ''
    entry.invalidation = entry.fields['失效条件'] ?? ''
    entry.content = entry.fields['内容'] ?? ''
    if (entry.notes.length > 0) {
      entry.content = entry.content === '' ? entry.notes.join('\n') : `${entry.content}\n${entry.notes.join('\n')}`
    }
  }
  return entries
}

/** Problems that make one entry fail the write contract. */
export function entryProblems(entry) {
  const problems = []
  for (const field of REQUIRED_FIELDS) {
    if (!String(entry.fields[field] ?? '').trim()) {
      problems.push({ level: 'error', code: 'missing-field', field, message: `缺字段「${field}」` })
    }
  }
  for (const [field, count] of Object.entries(entry.fieldCounts ?? {})) {
    if (count > 1) problems.push({ level: 'error', code: 'duplicate-field', field, message: `字段「${field}」出现 ${count} 次` })
  }
  if (entry.title.trim() === '') problems.push({ level: 'error', code: 'empty-title', message: '条目标题为空' })
  if (!isDate(entry.date)) problems.push({ level: 'error', code: 'bad-date', message: `标题日期不合法：${entry.date}` })
  if (entry.verified !== '' && !isDate(entry.verified)) {
    problems.push({ level: 'error', code: 'bad-verified', message: `核验日期不合法：${entry.verified}` })
  }
  if (entry.id !== '' && !ID_RE.test(entry.id)) {
    problems.push({ level: 'error', code: 'bad-id', message: `id 只能使用小写字母、数字、点、下划线、连字符：${entry.id}` })
  }
  if (entry.type !== '' && !TYPES.includes(entry.type)) {
    problems.push({ level: 'error', code: 'bad-type', message: `未知类型：${entry.type}` })
  }
  if (entry.scope !== '' && !SCOPES.includes(entry.scope)) {
    problems.push({ level: 'error', code: 'bad-scope', message: `未知作用域：${entry.scope}` })
  }
  if (entry.hook.includes(HOOK_RESERVED)) {
    problems.push({ level: 'error', code: 'hook-reserved', message: `「钩子」不能包含 ${HOOK_RESERVED}` })
  }
  if (!TOPIC_FILE_RE.test(entry.file)) {
    problems.push({ level: 'error', code: 'bad-topic-file', message: `主题文件名不合法：${entry.file}` })
  }
  return problems
}

/**
 * Render one entry in the canonical write form.
 * @param data normalized fields: title, type, scope, hook, trigger, evidence,
 *   captured, invalidation, content, id.
 */
export function renderEntryData(data) {
  const captured = data.captured
  const lines = [
    `## ${captured} — ${oneLine(data.title)}`,
    '',
    `- id: ${data.id}`,
    `- 类型: ${data.type}`,
    `- 作用域: ${data.scope}`,
  ]
  if (oneLine(data.hook) !== '') lines.push(`- 钩子: ${oneLine(data.hook)}`)
  lines.push(
    `- 触发: ${oneLine(data.trigger)}`,
    `- 证据: ${oneLine(data.evidence)}`,
    `- 捕获于: ${captured}`,
  )
  if (oneLine(data.verified) !== '') lines.push(`- 核验于: ${oneLine(data.verified)}`)
  lines.push(`- 失效条件: ${oneLine(data.invalidation)}`)
  const content = String(data.content ?? '').split(/\r?\n/)
  lines.push(`- 内容: ${(content[0] ?? '').trim()}`)
  for (const extra of content.slice(1)) lines.push(`  ${extra}`.trimEnd())
  return `${lines.join('\n')}\n`
}

/** Parse the generated index sections and schema marker. */
export function parseIndexText(text) {
  const result = { marker: null, entryLines: [], proposalLines: [], hasEntrySection: false, hasProposalSection: false }
  let section = null
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const marker = /<!--\s*memory-schema:\s*(\d+)\s*-->/.exec(raw)
    if (marker !== null && result.marker === null) result.marker = Number(marker[1])
    const line = raw.trim()
    if (line === '## 条目') {
      section = 'entries'
      result.hasEntrySection = true
      continue
    }
    if (line === '## 待确认提案') {
      section = 'proposals'
      result.hasProposalSection = true
      continue
    }
    if (/^##\s+/.test(line)) {
      section = null
      continue
    }
    if (line === '' || line === '（无）') continue
    if (section === 'entries' && line.startsWith('- [')) result.entryLines.push(line)
    if (section === 'proposals') result.proposalLines.push(line)
  }
  return result
}

/** Render the generated entry lines in topic-file and entry order. */
export function renderIndexLines(entries) {
  const lines = []
  for (const entry of entries) {
    if (entry.id === '' || entry.type === '' || entry.date === '') continue
    const hook = oneLine(entry.hook) || oneLine(entry.trigger)
    if (hook === '' || hook.includes(HOOK_RESERVED)) continue
    const verified = entry.verified ? `｜核验 ${entry.verified}` : ''
    lines.push(`- [${entry.type}] ${entry.date} ${hook} → ${entry.file}#${entry.id}${verified}`)
  }
  return lines
}

/** Parse one generated index line. */
export function parseIndexLine(line) {
  const match = INDEX_LINE_RE.exec(String(line ?? '').trim())
  if (match === null) return null
  return { type: match[1], date: match[2], hook: match[3], file: match[4], id: match[5], verified: match[6] ?? '' }
}

/** Replace one `## heading` section body, keeping everything around it. */
export function rewriteSection(text, heading, bodyLines) {
  const lines = String(text ?? '').split(/\r?\n/)
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`)
  const body = bodyLines.length > 0 ? bodyLines : ['（无）']
  if (start === -1) {
    const trimmed = lines.join('\n').replace(/\n+$/, '')
    return `${trimmed}\n\n## ${heading}\n\n${body.join('\n')}\n`
  }
  let end = lines.length
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index])) {
      end = index
      break
    }
  }
  const before = lines.slice(0, start)
  const after = lines.slice(end)
  while (after.length > 0 && after[0].trim() === '') after.shift()
  const out = [...before, `## ${heading}`, '', ...body, '']
  if (after.length > 0) out.push(...after)
  return `${out.join('\n').replace(/\n+$/, '')}\n`
}

/** Parse stale queue lines; unparseable non-placeholder lines are returned too. */
export function parseStaleText(text) {
  const records = []
  const malformed = []
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '' || line === '（无）' || line.startsWith('#')) continue
    // A template or explanatory line is not a queue record; only a line that
    // looks like a record but does not parse is a real drop signal.
    if (!line.startsWith('-')) continue
    if (line.includes('<') || line.includes('YYYY')) continue
    const match = STALE_LINE_RE.exec(line)
    if (match === null) {
      malformed.push(line)
      continue
    }
    records.push({ date: match[1], file: match[2], id: match[3], reason: match[4].trim(), line })
  }
  return { records, malformed }
}

/** Render one stale queue line. */
export function renderStaleLine(date, file, id, reason) {
  return `- ${date} ${file}#${id} — ${oneLine(reason)}`
}

/** Proposal lifecycle: pending until a human approves and the change lands. */
export const PROPOSAL_PENDING = '待确认'
export const PROPOSAL_APPLIED = '已应用'
const PROPOSAL_STATUS_RE = /^-\s*状态\s*[:：]\s*(待确认|已应用)\s*(\d{4}-\d{2}-\d{2})?\s*$/
const PROPOSAL_APPROVAL_RE = /^-\s*批准依据\s*[:：]\s*(.+)$/

/**
 * Parse one proposal document. Legacy files that still hold several `## 提案`
 * sections are accepted; `sections` lets the audit report them for splitting.
 */
export function parseProposalText(text) {
  const source = String(text ?? '')
  const section = /^##\s+提案\s*\d*\s*[—–-]\s*(.+)$/m.exec(source)
  const heading = /^#\s+(.+)$/m.exec(source)
  let status = PROPOSAL_PENDING
  let approvedAt = ''
  let approval = ''
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim()
    const statusMatch = PROPOSAL_STATUS_RE.exec(line)
    if (statusMatch !== null) {
      status = statusMatch[1]
      approvedAt = statusMatch[2] ?? ''
      continue
    }
    const approvalMatch = PROPOSAL_APPROVAL_RE.exec(line)
    if (approvalMatch !== null) approval = approvalMatch[1].trim()
  }
  return {
    title: (section?.[1] ?? heading?.[1] ?? '').trim(),
    status,
    approvedAt,
    approval,
    sections: (source.match(/^##\s+提案\s/mg) ?? []).length,
  }
}

/** The lines appended to a proposal once it is applied. */
export function renderProposalApplied(date, approval) {
  return [`- 状态: ${PROPOSAL_APPLIED} ${date}`, `- 批准依据: ${oneLine(approval)}`]
}

/** The schema marker in an index document, or null. */
export function schemaVersionOf(text) {
  const match = /<!--\s*memory-schema:\s*(\d+)\s*-->/.exec(String(text ?? ''))
  return match === null ? null : Number(match[1])
}

/** Extract cited `path:line` and `path 第 N 行` references for existence checks. */
export function evidencePaths(text) {
  const found = []
  const seen = new Set()
  const pattern = /([A-Za-z0-9_@./~-]+\.[A-Za-z0-9]{1,10})(?::(\d+)|(?:\s+第\s*(\d+)\s*行))/g
  for (const match of String(text ?? '').matchAll(pattern)) {
    const value = match[1]
    if (value.includes('://') || value.startsWith('/') || value.startsWith('~') || value.startsWith('-') || value.includes('*') || value.startsWith('memory/')) continue
    // Only relative paths with a directory component are checked. Bare names
    // and URL/path fragments produced too many false positives in practice.
    if (!value.includes('/')) continue
    const line = Number(match[2] ?? match[3] ?? 0)
    const key = `${value}:${line}`
    if (seen.has(key)) continue
    seen.add(key)
    found.push({ path: value, line })
  }
  return found
}

const STOP_EN = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'from', 'have', 'has', 'are', 'was', 'were', 'will',
  'would', 'can', 'could', 'should', 'not', 'but', 'you', 'your', 'our', 'its', 'use', 'using', 'code',
  'file', 'files', 'test', 'tests', 'run', 'runs', 'new', 'old', 'get', 'set', 'add', 'fix', 'bug',
  'work', 'task', 'when', 'then', 'than', 'into', 'out', 'about', 'after', 'before', 'more', 'less',
  'some', 'any', 'all', 'one', 'two', 'how', 'why', 'what', 'where', 'which', 'who', 'we', 'they',
  'them', 'their', 'there', 'here', 'been', 'being', 'does', 'did', 'done', 'make', 'made', 'just',
  'only', 'also', 'very', 'much', 'many', 'most', 'please', 'like', 'want', 'need', 'help',
])

const STOP_BI = new Set([
  '我们', '你们', '他们', '这个', '那个', '这些', '那些', '一个', '一些', '什么', '怎么', '怎样',
  '可以', '需要', '应该', '就是', '因为', '所以', '如果', '现在', '已经', '还是', '没有', '这样',
  '那样', '的话', '时候', '东西', '问题', '任务', '工作', '文件', '代码', '项目', '进行', '出现',
  '处理', '使用', '通过', '以及', '并且', '但是', '然后', '而且', '一下', '一种', '不是', '不能',
  '可能', '时候', '地方', '情况', '内容', '结果', '方式', '目前', '这里', '那里', '之后', '之前',
  '今天', '明天', '昨天', '一份', '这个', '那个', '好看', '页面',
])

/** Interrogative and filler characters never make a useful recall token. */
const STOP_CHAR_RE = /[吗呢吧呀啊哦啦嘛嗯哈么]/

const FILE_EXT_RE = /\.(?:ts|tsx|js|mjs|cjs|jsx|py|json|ya?ml|css|scss|vue|go|rs|java|kt|swift|sh|sql|toml|ini|html|md)$/

const LATIN_TERM_RE = /^[a-z0-9][a-z0-9._-]*$/

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Recall scoring knobs in one place: the tools, automatic recall, and the
 * tests all read these numbers, so a threshold change is one edit.
 */
export const RECALL = Object.freeze({
  manualThreshold: 10,
  autoThreshold: 15,
  shortThreshold: 0.5,
  shortTokenLimit: 2,
  shortLimit: 3,
  autoHeadSpan: 4,
  strongWeight: 12,
  wordHeadWeight: 1.5,
  gramHeadWeight: 1.3,
  phraseBonus: 6,
  maxMatched: 4,
})

/**
 * Parse `memory/lexicon.md`: one `- 规范词 = 别名, 别名` line per group.
 * Blank lines, `#` headings, and HTML comments are ignored.
 * @param text whole lexicon file.
 * @returns parsed groups plus every line or duplicate it could not accept.
 */
export function parseLexiconText(text) {
  const groups = []
  const issues = []
  const seeing = new Set()
  const owners = new Map()
  for (const rawLine of String(text ?? '').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#') || line.startsWith('<!--')) continue
    // Prose around the table is documentation, not a broken entry.
    if (!line.startsWith('-') && !line.startsWith('*')) continue
    const match = /^[-*]\s*(.+?)\s*[=:：]\s*(.+)$/.exec(line)
    if (match === null) {
      issues.push({ level: 'warn', code: 'lexicon-line', message: `词表行无法解析：${line}` })
      continue
    }
    const canonical = match[1].trim().toLowerCase()
    if (canonical === '') {
      issues.push({ level: 'warn', code: 'lexicon-canonical', message: `词表行缺少规范词：${line}` })
      continue
    }
    if (seeing.has(canonical)) {
      issues.push({ level: 'warn', code: 'lexicon-duplicate-canonical', message: `规范词「${canonical}」重复出现，只保留第一组` })
      continue
    }
    seeing.add(canonical)
    const terms = []
    for (const rawTerm of match[2].split(/[,，、;；]/)) {
      const term = rawTerm.trim().toLowerCase()
      if (term === '' || term === canonical) continue
      const owner = owners.get(term)
      if (owner !== undefined && owner !== canonical) {
        issues.push({ level: 'warn', code: 'lexicon-duplicate-term', message: `别名「${term}」同时映射到「${owner}」和「${canonical}」，已忽略后一组` })
        continue
      }
      owners.set(term, canonical)
      terms.push(term)
    }
    if (terms.length === 0) {
      issues.push({ level: 'warn', code: 'lexicon-empty', message: `词表「${canonical}」没有别名` })
    }
    groups.push({ canonical, terms })
  }
  return { groups, issues }
}

/**
 * Build the replacement table one project's recall uses.
 * @param groups parsed lexicon groups.
 * @returns `{ ordered, pattern, canonicalOf }` (longest term first), or null
 *   when nothing maps.
 */
export function buildLexicon(groups) {
  const table = new Map()
  for (const group of Array.isArray(groups) ? groups : []) {
    table.set(group.canonical, group.canonical)
    for (const term of group.terms) if (!table.has(term)) table.set(term, group.canonical)
  }
  // Every canonical stays in the table as a self-mapping branch: longest-first
  // alternation then protects a canonical word from being rewritten by a shorter
  // alias that happens to sit inside it (asset-meta must keep its "asset").
  const ordered = [...table.entries()]
    .sort((left, right) => right[0].length - left[0].length)
  const branches = ordered.map(([term]) => (
    LATIN_TERM_RE.test(term)
      ? `(?<![a-z0-9])${escapeRegExp(term)}(?![a-z0-9])`
      : escapeRegExp(term)
  ))
  if (branches.length === 0) return null
  return {
    ordered: ordered.map(([term, canonical]) => ({ term, canonical })),
    pattern: new RegExp(branches.join('|'), 'g'),
    canonicalOf: new Map(ordered),
  }
}

/** Lowercase text and replace every lexicon term with its canonical word. */
export function canonText(text, lexicon) {
  const source = String(text ?? '').toLowerCase()
  if (lexicon === null || lexicon === undefined) return source
  // One pass, longest alternative first: a canonical word produced by a
  // replacement is never scanned again (asset-meta must keep its "asset").
  return source.replace(lexicon.pattern, (matched) => lexicon.canonicalOf.get(matched) ?? matched)
}

/** The exact text recall indexes for one entry. */
export function entryText(entry) {
  const headText = `${entry.title}\n${entry.hook}\n${entry.trigger}`
  return `${headText}\n${entry.content}\n${entry.evidence}\n${entry.invalidation}\n${entry.id}\n${entry.file}`
}

/**
 * Count raw occurrences of one lexicon term, using the same matching the
 * canonicalizer applies: word boundaries for latin tokens, plain substring for
 * CJK and mixed terms.
 * @param text haystack.
 * @param term alias or canonical wording.
 */
export function termHitsIn(text, term) {
  const hay = String(text ?? '').toLowerCase()
  const needle = String(term ?? '').toLowerCase()
  if (needle === '') return 0
  if (LATIN_TERM_RE.test(needle)) {
    const pattern = new RegExp(`(?<![a-z0-9])${escapeRegExp(needle)}(?![a-z0-9])`, 'g')
    let count = 0
    for (const _ of hay.matchAll(pattern)) count += 1
    return count
  }
  let count = 0
  let from = 0
  for (;;) {
    const at = hay.indexOf(needle, from)
    if (at < 0) return count
    count += 1
    from = at + 1
  }
}

const LEXICON_GROUP_RE = /^[-*]\s*(.+?)\s*[=:：]\s*(.+)$/

function splitAliases(value) {
  return String(value ?? '')
    .split(/[,，、;；]/)
    .map((term) => term.trim().toLowerCase())
    .filter((term) => term !== '')
}

/** Render one lexicon group line. */
export function lexiconLine(canonical, terms) {
  return `- ${canonical} = ${terms.join(', ')}`
}

/**
 * Add aliases to a lexicon file text, creating the group at the end when new.
 * Prose, comments and every other group are preserved byte for byte.
 * @returns `{ text, created }`
 */
export function lexiconWithTerms(text, canonical, terms, note = '') {
  const source = String(text ?? '')
  const lines = source.split(/\r?\n/)
  const wanted = terms.map((term) => term.toLowerCase())
  for (let index = 0; index < lines.length; index += 1) {
    const match = LEXICON_GROUP_RE.exec(lines[index].trim())
    if (match === null) continue
    if (match[1].trim().toLowerCase() !== canonical) continue
    const merged = splitAliases(match[2])
    for (const term of wanted) if (!merged.includes(term)) merged.push(term)
    const line = lexiconLine(canonical, merged)
    const noteLine = note.trim()
    if (noteLine === '') {
      lines[index] = line
      return { text: lines.join('\n'), created: false }
    }
    // The note becomes a dated changelog line directly above the group; the
    // parser ignores comment lines.
    lines.splice(index, 0, noteLine)
    lines[index + 1] = line
    return { text: lines.join('\n'), created: false }
  }
  const trimmed = source.replace(/\s+$/, '')
  const block = [note.trim(), lexiconLine(canonical, wanted)].filter((line) => line !== '')
  return {
    text: trimmed === '' ? `${block.join('\n')}\n` : `${trimmed}\n\n${block.join('\n')}\n`,
    created: true,
  }
}

/**
 * Remove one alias from one group; drop the line (and the contiguous provenance
 * comments written above it) when the group would become empty. Comments that
 * mention the removed alias are dropped with it.
 * @returns `{ text, removed, droppedGroup }`
 */
export function lexiconWithoutTerm(text, canonical, term) {
  const source = String(text ?? '')
  const lines = source.split(/\r?\n/)
  const needle = term.toLowerCase()
  for (let index = 0; index < lines.length; index += 1) {
    const match = LEXICON_GROUP_RE.exec(lines[index].trim())
    if (match === null) continue
    if (match[1].trim().toLowerCase() !== canonical) continue
    const existing = splitAliases(match[2])
    if (!existing.includes(needle)) return { text: source, removed: false, droppedGroup: false }
    let start = index
    while (start > 0 && lines[start - 1].trim().startsWith('#')) start -= 1
    const comments = lines.slice(start, index).filter((line) => !line.toLowerCase().includes(needle))
    const next = existing.filter((candidate) => candidate !== needle)
    if (next.length > 0) {
      const out = [...lines.slice(0, start), ...comments, lexiconLine(canonical, next), ...lines.slice(index + 1)]
      return { text: out.join('\n'), removed: true, droppedGroup: false }
    }
    const before = lines.slice(0, start)
    const after = lines.slice(index + 1)
    if (before.length > 0 && before[before.length - 1].trim() === ''
        && after.length > 0 && after[0].trim() === '') after.shift()
    return { text: [...before, ...after].join('\n'), removed: true, droppedGroup: true }
  }
  return { text: source, removed: false, droppedGroup: false }
}

/**
 * Tokenize one query or one entry for recall.
 * @param text raw text.
 * @param lexicon optional term table for canonicalizing CJK and latin terms.
 * @returns `{ strong, words, grams }`: decisive identifiers, latin words, and
 *   CJK two/three-character runs.
 */
export function tokensOf(text, lexicon = null) {
  const raw = String(text ?? '')
  const lower = raw.toLowerCase()
  const canon = canonText(raw, lexicon)
  const strong = new Set()
  const words = new Set()
  const grams = new Set()

  for (const match of canon.matchAll(/[a-z0-9_][a-z0-9_./-]{1,}/g)) {
    const token = match[0]
    if (STOP_EN.has(token)) continue
    // Markers such as `3.` or `25.6.0` carry no wording; they only create noise
    // and match inside unrelated numbers (a list marker once matched `v24.13.0`).
    if (!/[a-z]/.test(token)) continue
    words.add(token)
    if (token.includes('/') || token.includes('-') || FILE_EXT_RE.test(token)) strong.add(token)
  }
  for (const match of lower.matchAll(/`([^`\n]{2,80})`/g)) strong.add(match[1].trim())
  for (const match of canon.matchAll(/[\u4e00-\u9fff]{2,}/g)) {
    const run = match[0]
    for (let index = 0; index < run.length - 1; index += 1) {
      const bigram = run.slice(index, index + 2)
      if (!STOP_BI.has(bigram) && !STOP_CHAR_RE.test(bigram)) grams.add(bigram)
      if (index < run.length - 2) {
        const trigram = run.slice(index, index + 3)
        if (!STOP_BI.has(trigram) && !STOP_CHAR_RE.test(trigram)) grams.add(trigram)
      }
    }
  }
  return { strong, words, grams }
}

/** Union of a raw token set and its canonicalized twin, so both spellings match. */
function tokensFor(text, lexicon) {
  const raw = tokensOf(text, null)
  if (lexicon === null || lexicon === undefined) return raw
  const canon = tokensOf(text, lexicon)
  return {
    strong: new Set([...raw.strong, ...canon.strong]),
    words: new Set([...raw.words, ...canon.words]),
    grams: new Set([...raw.grams, ...canon.grams]),
  }
}

const recallIndexCache = new WeakMap()

/** Per-entry canonical text plus corpus document frequencies. */
function recallIndex(entries, lexicon) {
  const cached = recallIndexCache.get(entries)
  if (cached !== undefined && cached.lexicon === lexicon) return cached
  const docs = entries.map((entry) => {
    const headText = `${entry.title}\n${entry.hook}\n${entry.trigger}`
    const allText = entryText(entry)
    return {
      entry,
      head: `${headText.toLowerCase()}\n${canonText(headText, lexicon)}`,
      hay: `${allText.toLowerCase()}\n${canonText(allText, lexicon)}`,
      tokens: tokensFor(allText, lexicon),
    }
  })
  const df = new Map()
  for (const doc of docs) {
    const seen = new Set([...doc.tokens.words, ...doc.tokens.grams, ...doc.tokens.strong])
    for (const token of seen) df.set(token, (df.get(token) ?? 0) + 1)
  }
  const value = { lexicon, docs, df, total: Math.max(1, docs.length) }
  recallIndexCache.set(entries, value)
  return value
}

const idfOf = (index, term) => Math.log(1 + index.total / (index.df.get(term) ?? 1))

/** Score one indexed entry against one query; shared by ranking and tests. */
function scoreDocument(doc, tokens, queryLine, index) {
  const matched = new Map()
  const headTerms = new Set()
  const add = (term, weight) => {
    const previous = matched.get(term)
    if (previous === undefined || weight > previous) matched.set(term, weight)
  }
  let score = 0
  let strongHits = 0
  let gramHits = 0

  for (const term of tokens.strong) {
    if (!doc.hay.includes(term)) continue
    score += RECALL.strongWeight
    strongHits += 1
    add(term, RECALL.strongWeight)
  }
  for (const term of tokens.words) {
    if (term.length < 2) continue
    const weight = idfOf(index, term)
    if (doc.head.includes(term)) {
      score += weight * RECALL.wordHeadWeight
      headTerms.add(term)
      add(term, weight * RECALL.wordHeadWeight)
    } else if (doc.hay.includes(term)) {
      score += weight
      add(term, weight)
    }
  }
  for (const term of tokens.grams) {
    const weight = idfOf(index, term)
    if (doc.head.includes(term)) {
      score += weight * RECALL.gramHeadWeight
      gramHits += 1
      headTerms.add(term)
      add(term, weight * RECALL.gramHeadWeight)
    } else if (doc.hay.includes(term)) {
      score += weight
      gramHits += 1
      add(term, weight)
    }
  }
  if (queryLine.length >= 4 && queryLine.length <= 80 && doc.head.includes(queryLine)) score += RECALL.phraseBonus

  const ordered = [...matched.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([term]) => term)
  const kept = ordered.filter((term, position) => (
    !ordered.slice(0, position).some((other) => other.length > term.length && other.includes(term))
  ))
  return {
    score,
    strongHits,
    gramHits,
    matched: kept.slice(0, RECALL.maxMatched),
    headTerms: [...headTerms],
    hitTerms: [...matched.keys()],
  }
}

/**
 * Merge matched terms into character spans of the query. Overlapping n-grams
 * of one phrase collapse into one span, so 「做任何」cannot pose as two hits.
 * @returns sorted `[start, end)` spans.
 */
function matchedSpans(queryLine, terms) {
  const intervals = []
  for (const term of terms) {
    if (typeof term !== 'string' || term === '') continue
    let from = 0
    for (;;) {
      const at = queryLine.indexOf(term, from)
      if (at < 0) break
      intervals.push([at, at + term.length])
      from = at + 1
    }
  }
  intervals.sort((left, right) => left[0] - right[0] || left[1] - right[1])
  const spans = []
  for (const [start, end] of intervals) {
    const last = spans[spans.length - 1]
    // Merge overlaps only: two words that happen to sit next to each other
    // (命中敌人) are still two hits, while sliding n-grams of one phrase are one.
    if (last !== undefined && start < last[1]) last[1] = Math.max(last[1], end)
    else spans.push([start, end])
  }
  return spans
}

/**
 * Whether a hit is decisive enough to inject on its own. Automatic recall must
 * point at the entry's trigger surface, not just at a sentence it happens to
 * share: a decisive identifier, a head span of at least `autoHeadSpan` chars,
 * or two separate spans with one fully inside the head. Common phrases like
 * 「一切正常」and「不做任何编辑」merge into one body span and stay quiet.
 */
function decisiveRecall(result, queryLine) {
  if (result.strongHits > 0) return true
  const headSpans = matchedSpans(queryLine, result.headTerms)
  const allSpans = matchedSpans(queryLine, result.hitTerms)
  let headOnly = 0
  let longest = 0
  for (const [start, end] of allSpans) {
    let cursor = start
    let complete = false
    for (const [headStart, headEnd] of headSpans) {
      if (headEnd <= cursor) continue
      if (headStart > cursor) break
      cursor = headEnd
      if (cursor >= end) { complete = true; break }
    }
    if (!complete) continue
    headOnly += 1
    longest = Math.max(longest, end - start)
  }
  return longest >= RECALL.autoHeadSpan || (headOnly >= 1 && allSpans.length >= 2)
}

/**
 * Rank entries for recall.
 * @param entries all entries of one repository.
 * @param query task wording, file paths, errors, or symbols.
 * @param limit maximum returned entries.
 * @param auto when true, use the stricter automatic-recall threshold.
 * @param lexicon optional project lexicon that maps user wording to stored terms.
 */
export function rankEntries(entries, query, limit = 8, auto = false, lexicon = null) {
  const phrase = oneLine(query)
  if (phrase === '') {
    return [...entries]
      .filter((entry) => !auto || !entry.stale)
      .sort((left, right) => right.date.localeCompare(left.date) || left.title.localeCompare(right.title))
      .slice(0, limit)
      .map((entry) => ({ entry, score: 0, strongHits: 0, gramHits: 0, matched: [], headTerms: [], hitTerms: [], short: false }))
  }
  const index = recallIndex(entries, lexicon)
  const tokens = tokensFor(phrase, lexicon)
  // Count the canonical wording only: an alias spelling from the lexicon must
  // not inflate the query into "long query" mode and raise its threshold.
  const canonical = tokensOf(phrase, lexicon)
  const significant = canonical.grams.size + canonical.words.size + canonical.strong.size
  const short = !auto && canonical.strong.size === 0 && significant <= RECALL.shortTokenLimit
  const threshold = auto ? RECALL.autoThreshold : short ? RECALL.shortThreshold : RECALL.manualThreshold
  const effectiveLimit = short ? Math.min(limit, RECALL.shortLimit) : limit
  const queryLine = canonText(phrase, lexicon)
  const ranked = []
  for (const doc of index.docs) {
    if (auto && doc.entry.stale) continue
    const result = scoreDocument(doc, tokens, queryLine, index)
    const scoreOk = result.score >= threshold
      || (result.strongHits > 0 && result.score >= RECALL.manualThreshold)
    const qualifies = auto ? scoreOk && decisiveRecall(result, queryLine) : scoreOk
    if (qualifies) ranked.push({ entry: doc.entry, ...result, short })
  }
  ranked.sort((left, right) => (
    right.score - left.score
    || right.entry.date.localeCompare(left.entry.date)
    || left.entry.title.localeCompare(right.entry.title)
  ))
  return ranked.slice(0, effectiveLimit)
}
