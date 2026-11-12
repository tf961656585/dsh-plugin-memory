/**
 * Memory contract: the single implementation of the repository memory format.
 *
 * The same parser, validator, renderer, index generator, and recall scorer are
 * used by the Host tools, the Web routes, and the tests. Nothing outside this
 * module writes a memory line.
 */

export const SCHEMA_VERSION = 3
export const MEMORY_DIR = 'memory'
export const FIELD_ORDER = ['id', '类型', '作用域', '钩子', '触发', '证据', '捕获于', '失效条件', '内容']
export const REQUIRED_FIELDS = ['id', '类型', '作用域', '触发', '证据', '捕获于', '失效条件', '内容']
export const OPTIONAL_FIELDS = ['钩子']
export const TYPES = ['隐藏依赖', '踩坑', '决策', '偏好', '情境事实']
export const SCOPES = ['user', 'project']
export const SPECIAL_FILES = new Set(['MEMORY.md', 'stale.md', 'inbox.md', 'README.md'])
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
export const INDEX_LINE_RE = /^-\s*\[([^\]]+)\]\s*(\d{4}-\d{2}-\d{2})\s+(.+?)\s*→\s*([^\s#]+)#([A-Za-z0-9._-]+)\s*$/
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
    `- 失效条件: ${oneLine(data.invalidation)}`,
  )
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
    lines.push(`- [${entry.type}] ${entry.date} ${hook} → ${entry.file}#${entry.id}`)
  }
  return lines
}

/** Parse one generated index line. */
export function parseIndexLine(line) {
  const match = INDEX_LINE_RE.exec(String(line ?? '').trim())
  if (match === null) return null
  return { type: match[1], date: match[2], hook: match[3], file: match[4], id: match[5] }
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
])

/** Tokenize a prompt for deterministic hook matching. */
export function tokensOf(text) {
  const source = String(text ?? '')
  const lower = source.toLowerCase()
  const words = new Set()
  const strong = new Set()
  const bigrams = new Set()

  for (const match of lower.matchAll(/[a-z0-9_][a-z0-9_./-]{1,}/g)) {
    const token = match[0]
    if (STOP_EN.has(token)) continue
    words.add(token)
    if (
      token.includes('/')
      || token.includes('-')
      || /\.(?:ts|tsx|js|mjs|cjs|jsx|py|json|ya?ml|css|scss|vue|go|rs|java|kt|swift|sh|sql|toml|ini|html|md)$/.test(token)
    ) strong.add(token)
  }
  for (const match of source.matchAll(/`([^`\n]{2,80})`/g)) strong.add(match[1].toLowerCase().trim())
  for (const match of source.matchAll(/[“"]([^”"\n]{3,80})[”"]/g)) {
    const token = match[1].toLowerCase().trim()
    if (!STOP_EN.has(token)) words.add(token)
  }
  for (const match of source.matchAll(/[\u4e00-\u9fff]{2,}/g)) {
    const run = match[0]
    for (let index = 0; index < run.length - 1; index += 1) {
      const bigram = run.slice(index, index + 2)
      if (!STOP_BI.has(bigram)) bigrams.add(bigram)
    }
  }
  return { words, strong, bigrams }
}

/** Score one entry against one prompt. */
export function scoreEntry(entry, tokens, query = '') {
  const head = `${entry.title}\n${entry.hook}\n${entry.trigger}`.toLowerCase()
  const hay = `${head}\n${entry.content}\n${entry.evidence}\n${entry.invalidation}\n${entry.id}\n${entry.file}`.toLowerCase()
  let score = 0
  let strongHits = 0
  let bigramHits = 0
  for (const token of tokens.strong) {
    if (token !== '' && hay.includes(token)) {
      score += 10
      strongHits += 1
    }
  }
  for (const token of tokens.words) {
    if (token.length < 3) continue
    if (head.includes(token)) score += 3
    else if (hay.includes(token)) score += 1
  }
  for (const token of tokens.bigrams) {
    if (head.includes(token)) bigramHits += 1
  }
  score += Math.min(bigramHits * 2, 12)
  const phrase = oneLine(query).toLowerCase()
  if (phrase.length >= 4 && phrase.length <= 80 && head.includes(phrase)) score += 6
  return { score, strongHits, bigramHits }
}

/**
 * Rank entries for recall.
 * @param entries all entries of one repository.
 * @param query task wording, file paths, errors, or symbols.
 * @param limit maximum returned entries.
 * @param auto when true, use the stricter automatic-recall threshold.
 */
export function rankEntries(entries, query, limit = 8, auto = false) {
  if (oneLine(query) === '') {
    return [...entries]
      .filter((entry) => !auto || !entry.stale)
      .sort((left, right) => right.date.localeCompare(left.date) || left.title.localeCompare(right.title))
      .slice(0, limit)
      .map((entry) => ({ entry, score: 0, strongHits: 0, bigramHits: 0 }))
  }
  const tokens = tokensOf(query)
  const ranked = []
  for (const entry of entries) {
    if (auto && entry.stale) continue
    const result = scoreEntry(entry, tokens, query)
    const threshold = auto ? 9 : 6
    const qualifies = auto
      ? result.score >= threshold && (result.strongHits > 0 || result.bigramHits >= 3)
      : result.score >= threshold
    if (qualifies) ranked.push({ entry, ...result })
  }
  ranked.sort((left, right) => (
    right.score - left.score
    || right.entry.date.localeCompare(left.entry.date)
    || left.entry.title.localeCompare(right.entry.title)
  ))
  return ranked.slice(0, limit)
}
