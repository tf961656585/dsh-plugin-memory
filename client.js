/**
 * Repository memory — Client half.
 *
 * Adds the book icon to the left sidebar and the management page it opens. The
 * page reads and writes the Host store over two same-origin routes; it keeps
 * only the last project choice in localStorage.
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-memory',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'memory'
    const PANEL_ID = 'memory'
    const ROUTE_STATE = '/plugin/memory/state'
    const ROUTE_MUTATE = '/plugin/memory/mutate'
    const PROJECT_KEY = 'memory:project'
    const TYPE_ORDER = ['隐藏依赖', '踩坑', '决策', '偏好', '情境事实']
    const TYPE_LABEL = {
      隐藏依赖: 'typeDep',
      踩坑: 'typePit',
      决策: 'typeDec',
      偏好: 'typePref',
      情境事实: 'typeFact',
    }

    const zh = {
      panel: '记忆',
      title: '记忆',
      tabEntries: '条目',
      subtitle: 'agent 在干活时记下的经验；读取前按「失效条件」核验，不是每轮必读的指令。',
      refresh: '刷新',
      add: '写一条',
      searchPlaceholder: '搜标题、钩子、内容或证据…',
      allTypes: '全部类型',
      typeDep: '隐藏依赖',
      typePit: '踩坑',
      typeDec: '决策',
      typePref: '偏好',
      typeFact: '情境事实',
      scopeUser: '用户级',
      scopeProject: '项目',
      staleBadge: '待核验',
      certified: '已认证',
      uncertified: '未认证',
      schemaMissing: '缺格式标记',
      schemaOld: '旧格式',
      statEntries: '{n} 条记忆',
      statStale: '{n} 条待清理',
      statProposals: '{n} 份提案',
      statUser: '{n} 条用户级',
      project: '项目',
      loading: '正在读取记忆库…',
      loadFailed: '记忆库没读出来，检查一下连接再试。',
      retry: '重试',
      emptyTitle: '这个项目还没有记忆',
      emptyBody: '让 agent 在干活时记下可复用教训，或者先自己写一条。',
      addFirst: '写第一条',
      noMatch: '没有匹配的条目。',
      noProjectTitle: '还没有可管理的项目记忆库',
      noProjectBody: '让 agent 在某个仓库里第一次写入记忆，这个面板就会列出那个项目。',
      expand: '展开',
      collapse: '收起',
      edit: '编辑',
      markStale: '标为失效',
      delete: '删除',
      confirmDelete: '确认删除',
      cancel: '取消',
      save: '保存',
      saving: '保存中…',
      saveFailed: '没保存成功。',
      saved: '已保存',
      editorAdd: '写一条记忆',
      editorEdit: '编辑记忆',
      fieldTitle: '一句话主题',
      fieldTitlePlaceholder: '例：跑通知集成测试前要先 seed',
      fieldType: '类型',
      fieldScope: '作用域',
      fieldHook: '钩子（索引里显示，1–3 个表面信号）',
      fieldHookPlaceholder: '例：跑 notification 集成测试 / 审计事件映射报错时',
      fieldTrigger: '触发（下次什么情境该读）',
      fieldTriggerPlaceholder: '例：跑 notification 集成测试；或审计事件映射测试因缺 fixture 失败时',
      fieldEvidence: '证据（文件:行 或本轮对话依据）',
      fieldEvidencePlaceholder: '例：apps/editor/src/lib/audit-events.ts:42',
      fieldInvalidation: '失效条件（什么情况发生时本条没用）',
      fieldInvalidationPlaceholder: '例：seed 步骤被测试脚手架自动化',
      fieldContent: '内容（可复用洞察：what 与 why）',
      fieldContentPlaceholder: '例：改通知偏好后跑集成测试，必须先 pnpm seed:test-notifications，否则审计事件映射测试会因缺 fixture 失败。',
      fieldId: '地址',
      editorNote: '保存时按记忆契约校验，字段不合法会拒绝写入；写入后自动重建索引。',
      triggerLabel: '触发',
      evidenceLabel: '证据',
      invalidationLabel: '失效条件',
      contentLabel: '内容',
      problemsLabel: '格式问题',
      hookLabel: '何时读',
      metaLabel: '元信息',
      staleTitle: '待清理',
      staleEmpty: '没有待清理的记忆。',
      staleHint: '这些是读侧发现可能失效的条目；核验后删除条目，或保留条目只移除提醒。',
      staleReason: '失效证据',
      staleReasonPlaceholder: '读到的现状 / 与记忆矛盾之处',
      staleSubmit: '加入待清理',
      resolveDelete: '删除条目',
      resolveKeep: '保留，移除提醒',
      staleOrphan: '条目已不存在',
      dateLabel: '发现于',
      proposalTitle: '待确认提案',
      proposalEmpty: '没有待确认的提案。',
      proposalHint: 'agent 对 AGENTS.md、spec 或 skill 的改动只写提案；确认后再改目标文件，然后在这里删除提案。',
      proposalExpand: '展开全文',
      proposalDelete: '删除提案',
      proposalConfirm: '确认删除',
      auditTitle: '体检',
      auditHint: '检查字段、重复 id、索引漂移、队列、提案和证据文件。语义失效仍需读代码核验。',
      auditRun: '运行体检',
      auditRunning: '体检中…',
      auditAgain: '重新体检',
      auditCertify: '重建索引并认证',
      auditCertifying: '认证中…',
      auditNoIssues: '没有发现形状或索引问题。',
      auditChecked: '检查于',
      issueError: '错误',
      issueWarn: '提醒',
      indexDrift: '索引待重建',
      projectMissing: '项目不存在',
      deleteStaleBody: '确认删除这条记忆？删除后不可撤销。',
      deleteEntryBody: '确认删除这条记忆？删除后不可撤销。',
      staleMarked: '已加入待清理',
      auditNeedsRun: '还没有运行体检。',
    }

    const en = {
      panel: 'Memory',
      title: 'Memory',
      tabEntries: 'Entries',
      subtitle: 'Experience the agent stored while working; verify the invalidation condition before relying on it.',
      refresh: 'Refresh',
      add: 'Write one',
      searchPlaceholder: 'Search title, hook, content, or evidence…',
      allTypes: 'All types',
      typeDep: 'Hidden dependency',
      typePit: 'Pitfall',
      typeDec: 'Decision',
      typePref: 'Preference',
      typeFact: 'Context fact',
      scopeUser: 'User',
      scopeProject: 'Project',
      staleBadge: 'Needs check',
      certified: 'Certified',
      uncertified: 'Uncertified',
      schemaMissing: 'No schema marker',
      schemaOld: 'Old format',
      statEntries: '{n} entries',
      statStale: '{n} stale',
      statProposals: '{n} proposals',
      statUser: '{n} user-level',
      project: 'Project',
      loading: 'Reading memory…',
      loadFailed: 'Could not read memory. Check the connection and retry.',
      retry: 'Retry',
      emptyTitle: 'This project has no memory yet',
      emptyBody: 'Have the agent record a reusable lesson while working, or write one yourself.',
      addFirst: 'Write the first entry',
      noMatch: 'No matching entries.',
      noProjectTitle: 'No project memory to manage yet',
      noProjectBody: 'The panel lists a project after the agent first writes memory there.',
      expand: 'Expand',
      collapse: 'Collapse',
      edit: 'Edit',
      markStale: 'Mark stale',
      delete: 'Delete',
      confirmDelete: 'Confirm delete',
      cancel: 'Cancel',
      save: 'Save',
      saving: 'Saving…',
      saveFailed: 'Could not save.',
      saved: 'Saved',
      editorAdd: 'Write a memory',
      editorEdit: 'Edit memory',
      fieldTitle: 'One-line subject',
      fieldTitlePlaceholder: 'e.g. Seed notification integration tests first',
      fieldType: 'Type',
      fieldScope: 'Scope',
      fieldHook: 'Hook (shown in the index; 1–3 surface signals)',
      fieldHookPlaceholder: 'e.g. Running notification integration tests / audit mapping failure',
      fieldTrigger: 'Trigger (when to read this next time)',
      fieldTriggerPlaceholder: 'e.g. Running notification integration tests; or audit mapping failing for missing fixtures',
      fieldEvidence: 'Evidence (file:line or this session)',
      fieldEvidencePlaceholder: 'e.g. apps/editor/src/lib/audit-events.ts:42',
      fieldInvalidation: 'Invalidation condition (when this stops being true)',
      fieldInvalidationPlaceholder: 'e.g. The test harness now seeds automatically',
      fieldContent: 'Content (the reusable what and why)',
      fieldContentPlaceholder: 'e.g. After changing notification preferences, run pnpm seed:test-notifications first or the audit mapping test fails for missing fixtures.',
      fieldId: 'Address',
      editorNote: 'Saving validates the memory contract; an invalid field is rejected. The index is rebuilt after every write.',
      triggerLabel: 'Trigger',
      evidenceLabel: 'Evidence',
      invalidationLabel: 'Invalidation',
      contentLabel: 'Content',
      problemsLabel: 'Format problems',
      hookLabel: 'When to read',
      metaLabel: 'Metadata',
      staleTitle: 'Stale',
      staleEmpty: 'No stale reports.',
      staleHint: 'These entries were reported as possibly invalid. Verify, then delete the entry or keep it and remove the reminder.',
      staleReason: 'Invalidation evidence',
      staleReasonPlaceholder: 'The current state / the contradiction you found',
      staleSubmit: 'Add to stale queue',
      resolveDelete: 'Delete entry',
      resolveKeep: 'Keep, remove reminder',
      staleOrphan: 'Entry no longer exists',
      dateLabel: 'Reported',
      proposalTitle: 'Open proposals',
      proposalEmpty: 'No open proposals.',
      proposalHint: 'Changes to AGENTS.md, spec, or skills are proposed by the agent. Apply them outside the panel, then delete the proposal here.',
      proposalExpand: 'Show full text',
      proposalDelete: 'Delete proposal',
      proposalConfirm: 'Confirm delete',
      auditTitle: 'Audit',
      auditHint: 'Checks fields, duplicate ids, index drift, queues, proposals, and evidence files. Semantic invalidation still needs a code read.',
      auditRun: 'Run audit',
      auditRunning: 'Auditing…',
      auditAgain: 'Run again',
      auditCertify: 'Rebuild index and certify',
      auditCertifying: 'Certifying…',
      auditNoIssues: 'No shape or index problems found.',
      auditChecked: 'Checked',
      issueError: 'Error',
      issueWarn: 'Warning',
      indexDrift: 'Index needs rebuild',
      projectMissing: 'Project missing',
      deleteStaleBody: 'Delete this memory? This cannot be undone.',
      deleteEntryBody: 'Delete this memory? This cannot be undone.',
      staleMarked: 'Added to the stale queue',
      auditNeedsRun: 'No audit has run yet.',
    }

    const CSS = `
.mem-page{display:flex;flex-direction:column;height:100%;min-height:0;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}
.mem-head{padding:20px 24px 10px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.mem-head-row{display:flex;align-items:flex-start;gap:12px}
.mem-title{margin:0;font-size:16px;font-weight:600;line-height:24px}
.mem-sub{margin:6px 0 0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.mem-stats{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:10px}
.mem-stat{padding:2px 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary)}
.mem-stat-warn{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-primary)}
.mem-stat-bad{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}
.mem-spacer{flex:1}
.mem-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 24px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.mem-select,.mem-search,.mem-input,.mem-textarea{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12px;font-family:inherit}
.mem-select,.mem-search,.mem-input{height:28px;padding:0 8px}
.mem-search{flex:1;min-width:160px;max-width:320px}
.mem-select{max-width:260px}
.mem-textarea{padding:6px 8px;resize:vertical;line-height:17px}
.mem-input:focus,.mem-textarea:focus,.mem-select:focus,.mem-search:focus{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.mem-chips{display:flex;align-items:center;gap:4px;flex-wrap:wrap}
.mem-chip{height:24px;padding:0 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:11px;cursor:pointer;font-family:inherit}
.mem-chip:hover{background:var(--dsw-alias-bg-layer-2)}
.mem-chip-on{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2)}
.mem-btn{height:28px;padding:0 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12px;cursor:pointer;font-family:inherit}
.mem-btn:hover{background:var(--dsw-alias-bg-layer-2)}
.mem-btn:disabled{opacity:.45;cursor:not-allowed}
.mem-btn-primary{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-brand-primary);color:#fff}
.mem-btn-primary:hover{filter:brightness(.96)}
.mem-btn-danger{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}
.mem-tabs{display:flex;gap:4px;padding:8px 24px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}
.mem-tab{height:30px;padding:0 8px;border:none;border-bottom:2px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;cursor:pointer;font-family:inherit}
.mem-tab:hover{color:var(--dsw-alias-label-primary)}
.mem-tab-on{color:var(--dsw-alias-label-primary);border-bottom-color:var(--dsw-alias-brand-primary);font-weight:600}
.mem-tab-count{margin-left:4px;font-size:10px;opacity:.75}
.mem-body{flex:1;min-height:0;overflow:auto;padding:12px 24px 32px}
.mem-card{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);margin-bottom:8px;overflow:hidden}
.mem-card-head{display:flex;align-items:flex-start;gap:8px;padding:10px 12px 0}
.mem-badge{flex:none;padding:0 6px;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;font-size:10px;line-height:16px;color:var(--dsw-alias-label-secondary);margin-top:1px}
.mem-badge-stale{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-primary)}
.mem-titleline{flex:1;min-width:0;font-size:13px;font-weight:600;line-height:18px;overflow-wrap:anywhere}
.mem-meta{margin-top:3px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mem-hook{margin:6px 12px 0;font-size:12px;line-height:17px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
.mem-hook b{color:var(--dsw-alias-label-primary);font-weight:600}
.mem-preview{margin:4px 12px 0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.mem-detail{padding:8px 12px 10px;margin-top:8px;border-top:1px solid var(--dsw-alias-border-l1)}
.mem-field-label{font-size:10px;line-height:15px;color:var(--dsw-alias-label-secondary);text-transform:uppercase;letter-spacing:.04em}
.mem-field-value{margin:2px 0 8px;font-size:12px;line-height:18px;white-space:pre-wrap;overflow-wrap:anywhere}
.mem-field-value:last-child{margin-bottom:0}
.mem-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:8px 12px 10px;border-top:1px solid var(--dsw-alias-border-l1)}
.mem-btn-small{height:24px;padding:0 8px;font-size:11px}
.mem-editor{margin-bottom:12px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);padding:12px}
.mem-editor-head{display:flex;align-items:baseline;gap:8px;margin-bottom:10px}
.mem-editor-title{font-size:13px;font-weight:600}
.mem-editor-id{font-size:11px;color:var(--dsw-alias-label-secondary)}
.mem-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px 12px}
.mem-field{display:flex;flex-direction:column;gap:4px;min-width:0}
.mem-wide{grid-column:1/-1}
.mem-note{margin:8px 0 0;padding:8px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-2);font-size:11px;line-height:17px;color:var(--dsw-alias-label-secondary)}
.mem-error{margin:0 0 10px;padding:8px 10px;border:1px solid var(--dsw-alias-state-error-primary);border-radius:6px;font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary);white-space:pre-wrap;overflow-wrap:anywhere}
.mem-notice{margin:0 0 10px;padding:6px 10px;border:1px solid var(--dsw-alias-state-success-primary);border-radius:6px;font-size:12px;color:var(--dsw-alias-state-success-primary)}
.mem-empty{padding:24px 12px;text-align:center;font-size:12px;line-height:19px;color:var(--dsw-alias-label-secondary)}
.mem-empty strong{display:block;margin-bottom:4px;color:var(--dsw-alias-label-primary);font-size:13px}
.mem-center{display:flex;align-items:center;justify-content:center;min-height:160px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.mem-issue{display:flex;align-items:flex-start;gap:8px;padding:6px 0;border-bottom:1px solid var(--dsw-alias-border-l1);font-size:12px;line-height:18px}
.mem-issue:last-child{border-bottom:none}
.mem-issue-level{flex:none;padding:0 5px;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;font-size:10px;line-height:16px;color:var(--dsw-alias-label-secondary);margin-top:1px}
.mem-issue-error{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}
.mem-issue-warn{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-primary)}
.mem-proposal{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);margin-bottom:8px}
.mem-proposal-head{display:flex;align-items:flex-start;gap:8px;padding:10px 12px}
.mem-proposal-body{padding:0 12px 10px}
.mem-proposal pre{margin:6px 0 0;padding:8px;border-radius:6px;background:var(--dsw-alias-bg-layer-2);font-size:11px;line-height:17px;white-space:pre-wrap;overflow-wrap:anywhere;max-height:360px;overflow:auto}
.mem-inline-form{display:flex;gap:6px;align-items:center;margin-top:8px}
.mem-inline-form .mem-input{flex:1;min-width:120px}
.mem-summary{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);margin:0 0 8px}
@media (max-width:760px){
.mem-head,.mem-bar,.mem-body,.mem-tabs{padding-left:14px;padding-right:14px}
.mem-grid{grid-template-columns:1fr}
.mem-search{max-width:none}
.mem-head-row{flex-wrap:wrap}
}
`

    function formatText(t, key, vars) {
      const template = typeof t === 'function' ? t(key) : key
      if (typeof template !== 'string') return key
      return template.replace(/\{(\w+)\}/g, (_match, name) => String(vars?.[name] ?? `{${name}}`))
    }

    function typeLabel(t, type) {
      return t(TYPE_LABEL[type] ?? 'typePit')
    }

    function scopeLabel(t, scope) {
      return t(scope === 'user' ? 'scopeUser' : 'scopeProject')
    }

    function keyOf(entry) {
      return `${entry.file}#${entry.id}`
    }

    function readProjectPreference() {
      try {
        return window.localStorage.getItem(PROJECT_KEY) ?? ''
      } catch {
        return ''
      }
    }

    function storeProjectPreference(project) {
      try {
        window.localStorage.setItem(PROJECT_KEY, project)
      } catch {
        // The filter still works for this page.
      }
    }

    function MemoryIcon({ size }) {
      const edge = typeof size === 'number' && size > 0 ? size : 16
      return h(
        'svg',
        {
          width: edge,
          height: edge,
          viewBox: '0 0 16 16',
          fill: 'none',
          'aria-hidden': true,
          style: { display: 'block' },
        },
        h('path', {
          d: 'M3 2.6c0-.55.45-1 1-1h6.2c.55 0 1 .45 1 1v9.8H4c-.55 0-1 .45-1 1V2.6Z',
          stroke: 'currentColor',
          strokeWidth: 1.25,
          strokeLinejoin: 'round',
        }),
        h('path', {
          d: 'M4 12.4h7.2M5.1 4.7h4.2M5.1 6.9h3.1',
          stroke: 'currentColor',
          strokeWidth: 1.2,
          strokeLinecap: 'round',
        }),
      )
    }

    function Badge({ t, entry }) {
      return h(
        'span',
        { className: `mem-badge${entry.stale ? ' mem-badge-stale' : ''}` },
        `${typeLabel(t, entry.type)}${entry.stale ? ` · ${t('staleBadge')}` : ''}`,
      )
    }

    function EntryCard({ t, entry, expanded, busy, deleting, onToggle, onEdit, onMarkStale, onDelete, onCancelDelete }) {
      const [askReason, setAskReason] = React.useState(false)
      const [reason, setReason] = React.useState('')
      const disabled = busy === keyOf(entry)
      const submitReason = (event) => {
        event.preventDefault()
        const value = reason.trim()
        if (value === '') return
        onMarkStale(entry, value)
        setAskReason(false)
        setReason('')
      }
      return h(
        'article',
        { className: 'mem-card' },
        h(
          'div',
          { className: 'mem-card-head' },
          h(Badge, { t, entry }),
          h(
            'div',
            { style: { flex: 1, minWidth: 0 } },
            h('div', { className: 'mem-titleline' }, entry.title),
            h('div', { className: 'mem-meta' }, `${entry.date} · ${scopeLabel(t, entry.scope)} · ${keyOf(entry)}`),
          ),
        ),
        entry.hook === '' ? null : h('div', { className: 'mem-hook' }, h('b', null, `${t('hookLabel')}：`), entry.hook),
        expanded ? null : h('div', { className: 'mem-preview' }, entry.content),
        expanded
          ? h(
            'div',
            { className: 'mem-detail' },
            h('div', { className: 'mem-field-label' }, t('triggerLabel')),
            h('div', { className: 'mem-field-value' }, entry.trigger),
            h('div', { className: 'mem-field-label' }, t('evidenceLabel')),
            h('div', { className: 'mem-field-value' }, entry.evidence),
            h('div', { className: 'mem-field-label' }, t('invalidationLabel')),
            h('div', { className: 'mem-field-value' }, entry.invalidation),
            h('div', { className: 'mem-field-label' }, t('contentLabel')),
            h('div', { className: 'mem-field-value' }, entry.content),
            entry.problems.length === 0 ? null : h(
              'div',
              null,
              h('div', { className: 'mem-field-label' }, t('problemsLabel')),
              h('div', { className: 'mem-field-value' }, entry.problems.map((problem) => problem.message).join('；')),
            ),
          )
          : null,
        askReason
          ? h(
            'form',
            { className: 'mem-inline-form', onSubmit: submitReason },
            h('input', {
              className: 'mem-input',
              value: reason,
              autoFocus: true,
              placeholder: t('staleReasonPlaceholder'),
              onChange: (event) => setReason(event.target.value),
            }),
            h('button', { type: 'submit', className: 'mem-btn mem-btn-small mem-btn-primary', disabled }, t('staleSubmit')),
            h('button', {
              type: 'button',
              className: 'mem-btn mem-btn-small',
              onClick: () => { setAskReason(false); setReason('') },
            }, t('cancel')),
          )
          : null,
        h(
          'div',
          { className: 'mem-actions' },
          h('button', { type: 'button', className: 'mem-btn mem-btn-small', onClick: () => onToggle(entry) }, expanded ? t('collapse') : t('expand')),
          h('button', { type: 'button', className: 'mem-btn mem-btn-small', onClick: () => onEdit(entry), disabled }, t('edit')),
          h('button', { type: 'button', className: 'mem-btn mem-btn-small', onClick: () => setAskReason(true), disabled }, t('markStale')),
          deleting === keyOf(entry)
            ? h(
              React.Fragment,
              null,
              h('button', { type: 'button', className: 'mem-btn mem-btn-small mem-btn-danger', onClick: () => onDelete(entry), disabled }, t('confirmDelete')),
              h('button', { type: 'button', className: 'mem-btn mem-btn-small', onClick: onCancelDelete }, t('cancel')),
            )
            : h('button', { type: 'button', className: 'mem-btn mem-btn-small', onClick: () => onDelete(entry), disabled, title: t('deleteEntryBody') }, t('delete')),
        ),
      )
    }

    function Editor({ t, mode, entry, busy, onSave, onCancel }) {
      const [fields, setFields] = React.useState({
        title: entry?.title ?? '',
        type: entry?.type ?? '踩坑',
        scope: entry?.scope ?? 'project',
        hook: entry?.hook ?? '',
        trigger: entry?.trigger ?? '',
        evidence: entry?.evidence ?? '',
        invalidation: entry?.invalidation ?? '',
        content: entry?.content ?? '',
      })
      const update = (field, value) => setFields((previous) => ({ ...previous, [field]: value }))
      const submit = (event) => {
        event.preventDefault()
        onSave(fields)
      }
      return h(
        'form',
        { className: 'mem-editor', onSubmit: submit },
        h(
          'div',
          { className: 'mem-editor-head' },
          h('span', { className: 'mem-editor-title' }, mode === 'add' ? t('editorAdd') : t('editorEdit')),
          entry === null ? null : h('span', { className: 'mem-editor-id' }, `${t('fieldId')}：${keyOf(entry)}`),
        ),
        h(
          'div',
          { className: 'mem-grid' },
          h(
            'label',
            { className: 'mem-field mem-wide' },
            h('span', { className: 'mem-field-label' }, t('fieldTitle')),
            h('input', {
              className: 'mem-input',
              value: fields.title,
              autoFocus: true,
              placeholder: t('fieldTitlePlaceholder'),
              onChange: (event) => update('title', event.target.value),
            }),
          ),
          h(
            'label',
            { className: 'mem-field' },
            h('span', { className: 'mem-field-label' }, t('fieldType')),
            h(
              'select',
              { className: 'mem-select', value: fields.type, onChange: (event) => update('type', event.target.value) },
              TYPE_ORDER.map((type) => h('option', { key: type, value: type }, typeLabel(t, type))),
            ),
          ),
          h(
            'label',
            { className: 'mem-field' },
            h('span', { className: 'mem-field-label' }, t('fieldScope')),
            h(
              'select',
              { className: 'mem-select', value: fields.scope, onChange: (event) => update('scope', event.target.value) },
              h('option', { value: 'project' }, scopeLabel(t, 'project')),
              h('option', { value: 'user' }, scopeLabel(t, 'user')),
            ),
          ),
          h(
            'label',
            { className: 'mem-field mem-wide' },
            h('span', { className: 'mem-field-label' }, t('fieldHook')),
            h('input', {
              className: 'mem-input',
              value: fields.hook,
              placeholder: t('fieldHookPlaceholder'),
              onChange: (event) => update('hook', event.target.value),
            }),
          ),
          h(
            'label',
            { className: 'mem-field mem-wide' },
            h('span', { className: 'mem-field-label' }, t('fieldTrigger')),
            h('textarea', {
              className: 'mem-textarea',
              rows: 2,
              value: fields.trigger,
              placeholder: t('fieldTriggerPlaceholder'),
              onChange: (event) => update('trigger', event.target.value),
            }),
          ),
          h(
            'label',
            { className: 'mem-field mem-wide' },
            h('span', { className: 'mem-field-label' }, t('fieldEvidence')),
            h('textarea', {
              className: 'mem-textarea',
              rows: 2,
              value: fields.evidence,
              placeholder: t('fieldEvidencePlaceholder'),
              onChange: (event) => update('evidence', event.target.value),
            }),
          ),
          h(
            'label',
            { className: 'mem-field mem-wide' },
            h('span', { className: 'mem-field-label' }, t('fieldInvalidation')),
            h('textarea', {
              className: 'mem-textarea',
              rows: 2,
              value: fields.invalidation,
              placeholder: t('fieldInvalidationPlaceholder'),
              onChange: (event) => update('invalidation', event.target.value),
            }),
          ),
          h(
            'label',
            { className: 'mem-field mem-wide' },
            h('span', { className: 'mem-field-label' }, t('fieldContent')),
            h('textarea', {
              className: 'mem-textarea',
              rows: 5,
              value: fields.content,
              placeholder: t('fieldContentPlaceholder'),
              onChange: (event) => update('content', event.target.value),
            }),
          ),
        ),
        h('p', { className: 'mem-note' }, t('editorNote')),
        h(
          'div',
          { className: 'mem-actions', style: { borderTop: 'none', paddingLeft: 0, paddingRight: 0, paddingBottom: 0 } },
          h('button', { type: 'button', className: 'mem-btn', onClick: onCancel, disabled: busy === 'save' }, t('cancel')),
          h('button', { type: 'submit', className: 'mem-btn mem-btn-primary', disabled: busy === 'save' }, busy === 'save' ? t('saving') : t('save')),
        ),
      )
    }

    function StaleList({ t, records, busy, onResolve }) {
      if (records.length === 0) return h('div', { className: 'mem-empty' }, t('staleEmpty'))
      return h(
        React.Fragment,
        null,
        h('p', { className: 'mem-summary' }, t('staleHint')),
        records.map((record) => {
          const key = `${record.file}#${record.id}`
          return h(StaleRow, { key, t, record, busy, onResolve })
        }),
      )
    }

    function StaleRow({ t, record, busy, onResolve }) {
      const [confirming, setConfirming] = React.useState(false)
      const entry = record.entry
      return h(
        'article',
        { className: 'mem-card' },
        h(
          'div',
          { className: 'mem-card-head' },
          h('span', { className: 'mem-badge mem-badge-stale' }, t('staleBadge')),
          h(
            'div',
            { style: { flex: 1, minWidth: 0 } },
            h('div', { className: 'mem-titleline' }, entry === null ? t('staleOrphan') : entry.title),
            h('div', { className: 'mem-meta' }, `${t('dateLabel')} ${record.date} · ${record.file}#${record.id}`),
          ),
        ),
        h('div', { className: 'mem-hook' }, h('b', null, `${t('staleReason')}：`), record.reason),
        h(
          'div',
          { className: 'mem-actions' },
          confirming
            ? h(
              React.Fragment,
              null,
              h('button', {
                type: 'button',
                className: 'mem-btn mem-btn-small mem-btn-danger',
                disabled: busy === key,
                onClick: () => { onResolve(record, 'delete'); setConfirming(false) },
              }, t('resolveDelete')),
              h('button', { type: 'button', className: 'mem-btn mem-btn-small', onClick: () => setConfirming(false) }, t('cancel')),
            )
            : h('button', {
              type: 'button',
              className: 'mem-btn mem-btn-small',
              disabled: busy === key,
              onClick: () => { if (entry === null) onResolve(record, 'keep'); else setConfirming(true) },
            }, entry === null ? t('resolveKeep') : t('resolveDelete')),
          entry === null ? null : h('button', {
            type: 'button',
            className: 'mem-btn mem-btn-small',
            disabled: busy === key,
            onClick: () => onResolve(record, 'keep'),
          }, t('resolveKeep')),
        ),
      )
    }

    function ProposalList({ t, proposals, busy, onDelete }) {
      if (proposals.length === 0) return h('div', { className: 'mem-empty' }, t('proposalEmpty'))
      return h(
        React.Fragment,
        null,
        h('p', { className: 'mem-summary' }, t('proposalHint')),
        proposals.map((proposal) => h(ProposalRow, { key: proposal.file, t, proposal, busy, onDelete })),
      )
    }

    function ProposalRow({ t, proposal, busy, onDelete }) {
      const [confirming, setConfirming] = React.useState(false)
      return h(
        'article',
        { className: 'mem-proposal' },
        h(
          'div',
          { className: 'mem-proposal-head' },
          h('span', { className: 'mem-badge' }, proposal.date === '' ? t('proposalTitle') : proposal.date),
          h(
            'div',
            { style: { flex: 1, minWidth: 0 } },
            h('div', { className: 'mem-titleline' }, proposal.title),
            h('div', { className: 'mem-meta' }, `proposals/${proposal.file}`),
          ),
        ),
        h(
          'div',
          { className: 'mem-proposal-body' },
          h('details', null, h('summary', { style: { cursor: 'pointer', fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } }, t('proposalExpand')), h('pre', null, proposal.content)),
          h(
            'div',
            { className: 'mem-actions', style: { borderTop: 'none', paddingLeft: 0, paddingRight: 0, paddingBottom: 0 } },
            confirming
              ? h(
                React.Fragment,
                null,
                h('button', {
                  type: 'button',
                  className: 'mem-btn mem-btn-small mem-btn-danger',
                  disabled: busy === proposal.file,
                  onClick: () => { onDelete(proposal); setConfirming(false) },
                }, t('proposalConfirm')),
                h('button', { type: 'button', className: 'mem-btn mem-btn-small', onClick: () => setConfirming(false) }, t('cancel')),
              )
              : h('button', { type: 'button', className: 'mem-btn mem-btn-small', onClick: () => setConfirming(true), disabled: busy === proposal.file }, t('proposalDelete')),
          ),
        ),
      )
    }

    function AuditPanel({ t, audit, busy, onRun, onCertify }) {
      return h(
        'div',
        { className: 'mem-editor' },
        h(
          'div',
          { className: 'mem-editor-head' },
          h('span', { className: 'mem-editor-title' }, t('auditTitle')),
          audit === null ? null : h('span', { className: 'mem-editor-id' }, `${t('auditChecked')} ${new Date(audit.checkedAt).toLocaleString()}`),
        ),
        h('p', { className: 'mem-note', style: { marginTop: 0 } }, t('auditHint')),
        h(
          'div',
          { className: 'mem-actions', style: { borderTop: 'none', paddingLeft: 0, paddingRight: 0, paddingBottom: 8 } },
          h('button', { type: 'button', className: 'mem-btn', onClick: onRun, disabled: busy === 'audit' }, busy === 'audit' ? t('auditRunning') : (audit === null ? t('auditRun') : t('auditAgain'))),
          h('button', { type: 'button', className: 'mem-btn mem-btn-primary', onClick: onCertify, disabled: busy === 'certify' }, busy === 'certify' ? t('auditCertifying') : t('auditCertify')),
        ),
        audit === null ? h('div', { className: 'mem-empty' }, t('auditNeedsRun')) : h(
          React.Fragment,
          null,
          h(
            'p',
            { className: 'mem-summary' },
            `${audit.counts.entries} 条记忆 · ${audit.counts.stale} 待清理 · ${audit.counts.inbox} 待补 · ${audit.counts.proposals} 提案 · ${audit.indexSync ? '索引一致' : t('indexDrift')}`,
          ),
          audit.issues.length === 0
            ? h('div', { className: 'mem-empty' }, t('auditNoIssues'))
            : audit.issues.map((issue, index) => h(
              'div',
              { className: 'mem-issue', key: `${issue.code}-${index}` },
              h('span', { className: `mem-issue-level ${issue.level === 'error' ? 'mem-issue-error' : 'mem-issue-warn'}` }, issue.level === 'error' ? t('issueError') : t('issueWarn')),
              h('span', null, issue.message),
            )),
        ),
      )
    }

    function MemoryPage({ t }) {
      const [snapshot, setSnapshot] = React.useState(null)
      const [status, setStatus] = React.useState('loading')
      const [failure, setFailure] = React.useState(null)
      const [project, setProject] = React.useState(readProjectPreference)
      const [tab, setTab] = React.useState('entries')
      const [query, setQuery] = React.useState('')
      const [type, setType] = React.useState('')
      const [expanded, setExpanded] = React.useState('')
      const [editor, setEditor] = React.useState(null)
      const [deleting, setDeleting] = React.useState('')
      const [busy, setBusy] = React.useState('')
      const [notice, setNotice] = React.useState('')
      const [audit, setAudit] = React.useState(null)
      const requestRef = React.useRef(null)

      const load = React.useCallback(async (target, silent) => {
        requestRef.current?.abort()
        const controller = new AbortController()
        requestRef.current = controller
        if (!silent) setStatus((previous) => (previous === 'ready' ? 'refreshing' : 'loading'))
        try {
          const suffix = target === '' ? '' : `?project=${encodeURIComponent(target)}`
          const response = await fetch(`${ROUTE_STATE}${suffix}`, {
            signal: controller.signal,
            headers: { accept: 'application/json' },
          })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const data = await response.json()
          setSnapshot(data)
          setStatus('ready')
          setFailure(null)
          if (data.project !== '' && data.project !== target) {
            setProject(data.project)
            storeProjectPreference(data.project)
          }
        } catch (error) {
          if (controller.signal.aborted) return
          setStatus('error')
          setFailure(t('loadFailed'))
        }
      }, [t])

      React.useEffect(() => {
        void load(project, false)
        return () => { requestRef.current?.abort() }
      }, [load, project])

      React.useEffect(() => {
        const timer = setInterval(() => {
          if (document.visibilityState !== 'visible' || editor !== null || busy !== '') return
          void load(project, true)
        }, 8000)
        return () => clearInterval(timer)
      }, [busy, editor, load, project])

      React.useEffect(() => {
        if (notice === '') return undefined
        const timer = setTimeout(() => setNotice(''), 2200)
        return () => clearTimeout(timer)
      }, [notice])

      const changeProject = React.useCallback((next) => {
        setProject(next)
        storeProjectPreference(next)
        setEditor(null)
        setAudit(null)
        setFailure(null)
        setExpanded('')
        setDeleting('')
        setTab('entries')
      }, [])

      const mutate = React.useCallback(async (body, busyKey) => {
        setBusy(busyKey ?? '')
        setFailure(null)
        try {
          const response = await fetch(ROUTE_MUTATE, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ...body, project }),
          })
          const data = await response.json().catch(() => null)
          if (!response.ok) throw new Error(typeof data?.error === 'string' ? data.error : `HTTP ${response.status}`)
          if (data?.snapshot !== undefined) {
            setSnapshot(data.snapshot)
            setProject(data.snapshot.project)
            storeProjectPreference(data.snapshot.project)
            setStatus('ready')
          }
          if (data?.audit !== undefined) setAudit(data.audit)
          if (body.action !== 'audit' && body.action !== 'certify') setNotice(t('saved'))
          return true
        } catch (error) {
          setFailure(error?.message || t('saveFailed'))
          return false
        } finally {
          setBusy('')
        }
      }, [project, t])

      const saveEditor = React.useCallback(async (fields) => {
        if (editor === null) return
        if (editor.mode === 'add') {
          const ok = await mutate({ action: 'add', ...fields }, 'save')
          if (ok) setEditor(null)
          return
        }
        const ok = await mutate({ action: 'update', ref: keyOf(editor.entry), ...fields }, 'save')
        if (ok) setEditor(null)
      }, [editor, mutate])

      const markStale = React.useCallback(async (entry, reason) => {
        const ok = await mutate({ action: 'stale', ref: keyOf(entry), reason }, keyOf(entry))
        if (ok) setNotice(t('staleMarked'))
      }, [mutate, t])

      const deleteEntry = React.useCallback(async (entry) => {
        const ok = await mutate({ action: 'delete', ref: keyOf(entry) }, keyOf(entry))
        if (ok) setDeleting('')
      }, [mutate])

      const resolveStale = React.useCallback(async (record, decision) => {
        await mutate({ action: 'resolve', ref: `${record.file}#${record.id}`, decision }, `${record.file}#${record.id}`)
      }, [mutate])

      const deleteProposal = React.useCallback(async (proposal) => {
        await mutate({ action: 'proposal-delete', file: proposal.file }, proposal.file)
      }, [mutate])

      const runAudit = React.useCallback(async () => {
        setAudit(null)
        await mutate({ action: 'audit' }, 'audit')
      }, [mutate])

      const certify = React.useCallback(async () => {
        await mutate({ action: 'certify' }, 'certify')
      }, [mutate])

      const entries = snapshot?.entries ?? []
      const counts = snapshot?.counts ?? { entries: 0, stale: 0, proposals: 0, inbox: 0, user: 0 }
      const allProjects = snapshot?.projects ?? []
      const projects = allProjects.filter((row) => row.count > 0 || row.path === project || row.path === snapshot?.project)
      const filtered = React.useMemo(() => {
        const needle = query.trim().toLowerCase()
        return entries.filter((entry) => {
          if (type !== '' && entry.type !== type) return false
          if (needle === '') return true
          return `${entry.title}\n${entry.hook}\n${entry.trigger}\n${entry.content}\n${entry.evidence}\n${entry.invalidation}\n${entry.id}`
            .toLowerCase()
            .includes(needle)
        })
      }, [entries, query, type])

      const toggleEntry = React.useCallback((entry) => {
        setExpanded((previous) => (previous === keyOf(entry) ? '' : keyOf(entry)))
      }, [])

      const retry = React.useCallback(() => {
        void load(project, false)
      }, [load, project])

      const certified = snapshot?.certified === true
      const schema = snapshot?.schema ?? null
      const certificationLabel = certified
        ? t('certified')
        : (schema === null ? t('schemaMissing') : t('schemaOld'))

      return h(
        'div',
        { className: 'mem-page' },
        h('style', null, CSS),
        h(
          'header',
          { className: 'mem-head' },
          h(
            'div',
            { className: 'mem-head-row' },
            h(
              'div',
              { style: { flex: 1, minWidth: 0 } },
              h('h1', { className: 'mem-title' }, t('title')),
              h('p', { className: 'mem-sub' }, t('subtitle')),
            ),
            snapshot === null ? null : h('span', { className: `mem-stat${certified ? '' : ' mem-stat-warn'}`, title: schema === null ? t('schemaMissing') : `schema ${schema}` }, certificationLabel),
          ),
          h(
            'div',
            { className: 'mem-stats' },
            h('span', { className: 'mem-stat' }, formatText(t, 'statEntries', { n: counts.entries })),
            h('span', { className: `mem-stat${counts.stale > 0 ? ' mem-stat-warn' : ''}` }, formatText(t, 'statStale', { n: counts.stale })),
            h('span', { className: 'mem-stat' }, formatText(t, 'statProposals', { n: counts.proposals })),
            h('span', { className: 'mem-stat' }, formatText(t, 'statUser', { n: counts.user })),
            snapshot?.index?.sync === false ? h('span', { className: 'mem-stat mem-stat-warn' }, t('indexDrift')) : null,
          ),
        ),
        h(
          'div',
          { className: 'mem-bar' },
          projects.length === 0
            ? null
            : h(
              React.Fragment,
              null,
              h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } }, `${t('project')}：`),
              h(
                'select',
                {
                  className: 'mem-select',
                  value: project,
                  onChange: (event) => changeProject(event.target.value),
                  'aria-label': t('project'),
                },
                projects.map((row) => h('option', { key: row.path, value: row.path }, `${row.title}（${row.count}）`)),
              ),
            ),
          tab !== 'entries' ? null : h('input', {
            className: 'mem-search',
            value: query,
            placeholder: t('searchPlaceholder'),
            'aria-label': t('searchPlaceholder'),
            onChange: (event) => setQuery(event.target.value),
          }),
          tab !== 'entries' ? null : h(
            'div',
            { className: 'mem-chips' },
            h('button', { type: 'button', className: `mem-chip${type === '' ? ' mem-chip-on' : ''}`, onClick: () => setType('') }, t('allTypes')),
            TYPE_ORDER.map((value) => h(
              'button',
              {
                key: value,
                type: 'button',
                className: `mem-chip${type === value ? ' mem-chip-on' : ''}`,
                onClick: () => setType(type === value ? '' : value),
              },
              typeLabel(t, value),
            )),
          ),
          h('span', { className: 'mem-spacer' }),
          h('button', { type: 'button', className: 'mem-btn', onClick: retry, disabled: status === 'loading' }, t('refresh')),
          h('button', {
            type: 'button',
            className: 'mem-btn mem-btn-primary',
            onClick: () => { setEditor({ mode: 'add', entry: null }); setDeleting('') },
            disabled: projects.length === 0,
          }, t('add')),
        ),
        h(
          'div',
          { className: 'mem-tabs' },
          h('button', { type: 'button', className: `mem-tab${tab === 'entries' ? ' mem-tab-on' : ''}`, onClick: () => setTab('entries') }, t('tabEntries'), h('span', { className: 'mem-tab-count' }, counts.entries)),
          h('button', { type: 'button', className: `mem-tab${tab === 'stale' ? ' mem-tab-on' : ''}`, onClick: () => setTab('stale') }, t('staleTitle'), h('span', { className: 'mem-tab-count' }, counts.stale)),
          h('button', { type: 'button', className: `mem-tab${tab === 'proposals' ? ' mem-tab-on' : ''}`, onClick: () => setTab('proposals') }, t('proposalTitle'), h('span', { className: 'mem-tab-count' }, counts.proposals)),
          h('button', { type: 'button', className: `mem-tab${tab === 'audit' ? ' mem-tab-on' : ''}`, onClick: () => setTab('audit') }, t('auditTitle')),
        ),
        h(
          'div',
          { className: 'mem-body' },
          notice === '' ? null : h('div', { className: 'mem-notice' }, notice),
          failure === null ? null : h('div', { className: 'mem-error' }, failure),
          status === 'loading' && snapshot === null ? h('div', { className: 'mem-center' }, t('loading')) : null,
          snapshot !== null && snapshot.exists === false && projects.length > 0
            ? h(
              'div',
              { className: 'mem-empty' },
              h('strong', null, t('emptyTitle')),
              h('div', null, t('emptyBody')),
            )
            : null,
          projects.length === 0 && status !== 'loading'
            ? h(
              'div',
              { className: 'mem-empty' },
              h('strong', null, t('noProjectTitle')),
              h('div', null, t('noProjectBody')),
            )
            : null,
          editor === null ? null : h(Editor, {
            key: `${editor.mode}:${editor.entry === null ? 'new' : keyOf(editor.entry)}`,
            t,
            mode: editor.mode,
            entry: editor.entry,
            busy,
            onSave: saveEditor,
            onCancel: () => setEditor(null),
          }),
          tab === 'entries' && snapshot !== null && snapshot.exists
            ? (filtered.length === 0
              ? h('div', { className: 'mem-empty' }, query === '' && type === '' ? `${t('emptyTitle')} ${t('emptyBody')}` : t('noMatch'))
              : filtered.map((entry) => h(EntryCard, {
                key: keyOf(entry),
                t,
                entry,
                expanded: expanded === keyOf(entry),
                busy,
                deleting,
                onToggle: toggleEntry,
                onEdit: (target) => { setEditor({ mode: 'edit', entry: target }); setDeleting('') },
                onMarkStale: markStale,
                onDelete: (target) => {
                  if (deleting === keyOf(target)) {
                    void deleteEntry(target)
                    return
                  }
                  setDeleting(keyOf(target))
                },
                onCancelDelete: () => setDeleting(''),
              })))
            : null,
          tab === 'stale' && snapshot !== null
            ? h(StaleList, { t, records: snapshot.stale, busy, onResolve: resolveStale })
            : null,
          tab === 'proposals' && snapshot !== null
            ? h(ProposalList, { t, proposals: snapshot.proposals, busy, onDelete: deleteProposal })
            : null,
          tab === 'audit'
            ? h(AuditPanel, { t, audit, busy, onRun: runAudit, onCertify: certify })
            : null,
        ),
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'memory: dictionaries')
        const t = ctx.locale.bind(NS)
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
          locale: NS,
          inject: () => ({ t }),
        }, MemoryPage))
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 15,
          label: () => t('panel'),
          locale: NS,
        }, MemoryIcon))
      },
      __test: { formatText, typeLabel, keyOf },
    }
  },
})
