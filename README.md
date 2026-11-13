# dsh-plugin-memory

Repository memory for DeepSeek Harness. It replaces the one-shot `reflect` skill
with an always-available capability:

- the agent can recall, read, write, correct, and audit memory while it works;
- recall matches titles, body text, and evidence with rarity weighting, and an
  optional per-project `memory/lexicon.md` maps spoken wording onto stored wording;
- the plugin recalls strongly related entries automatically at the start of a turn
  when the match lands on an entry's trigger surface (title, hook, or trigger);
- a sidebar panel manages entries, stale reports, proposals, and audits visually;
- `/reflect` still performs a deliberate full reflection pass when the user asks.

## Storage contract

Memory stays in each repository's `memory/` directory. The plugin is the only
writer and validator; it keeps the generated `MEMORY.md` index, `stale.md`,
`inbox.md`, and `proposals/` in sync. `lexicon.md` is maintained by the agent through
`memory_lexicon` (the plugin is the only writer; a manual edit is not the
supported path): additions happen while working with the missed query as
evidence, narrowing/deleting happens during `/reflect`. Entries keep the established schema:
heading `## YYYY-MM-DD — title`, then `id`, `类型`, `作用域`, optional `钩子`,
`触发`, `证据`, `捕获于`, optional `核验于`, `失效条件`, and `内容`. `核验于` is
machine-written by `memory_verify` (or by keeping a stale entry); it never accepts
an agent-supplied date, so "last confirmed true" stays a fact rather than a claim.

Every proposal lives in its own file (`proposals/YYYY-MM-DD.md`,
`proposals/YYYY-MM-DD-2.md`, ...) with a `- 状态:` line: `待确认` until the user
approves and the edit lands, then `已应用 <date>` plus a mandatory
`- 批准依据:` line quoting the approval. Only pending proposals are counted and
listed in the index; applied ones stay on disk as the record.

Evidence paths are normalized before writing: a short citation whose suffix
matches exactly one repository file is completed to the repository-relative path,
an ambiguous one is refused, and an unknown one is left for the audit to report.

## Tools

- `memory_recall` — search or browse entries; returns bounded summaries.
- `memory_get` — read one entry in full.
- `memory_write` — add, update, or delete an entry. `update` accepts a partial
  payload: omitted fields keep their current value.
- `memory_verify` — stamp one entry as verified today without changing content.
- `memory_stale` — mark an entry as suspect, or resolve the queue.
- `memory_audit` — shape, index, queues, pending proposals, and evidence-file checks.
- `memory_propose` — write a proposal (`action=propose`) or mark an approved,
  applied proposal as applied (`action=resolve`, approval wording required).

## Development

```sh
node --check host.js
node --check client.js
node --test test/*.test.mjs

# Recall quality against one real memory library (see docs/recall-design.md)
node test/eval-recall.mjs /path/to/project test/fixtures/recall-webgame.json
```

Install the directory through **Plugins > Add plugin** or `plugin_manager`
`install_bundle`.
