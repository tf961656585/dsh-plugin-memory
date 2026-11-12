# dsh-plugin-memory

Repository memory for DeepSeek Harness. It replaces the one-shot `reflect` skill
with an always-available capability:

- the agent can recall, read, write, correct, and audit memory while it works;
- the plugin recalls strongly related entries automatically at the start of a turn;
- a sidebar panel manages entries, stale reports, proposals, and audits visually;
- `/reflect` still performs a deliberate full reflection pass when the user asks.

## Storage contract

Memory stays in each repository's `memory/` directory. The plugin is the only
writer and validator; it keeps the generated `MEMORY.md` index, `stale.md`,
`inbox.md`, and `proposals/` in sync. Entries keep the established schema:
heading `## YYYY-MM-DD — title`, then `id`, `类型`, `作用域`, optional `钩子`,
`触发`, `证据`, `捕获于`, `失效条件`, and `内容`.

## Tools

- `memory_recall` — search or browse entries; returns bounded summaries.
- `memory_get` — read one entry in full.
- `memory_write` — add, update, or delete an entry.
- `memory_stale` — mark an entry as suspect, or resolve the queue.
- `memory_audit` — shape, index, queues, proposals, and evidence-file checks.
- `memory_propose` — write a proposal for an AGENTS/spec/skill change.

## Development

```sh
node --check host.js
node --check client.js
node --test test/*.test.mjs
```

Install the directory through **Plugins > Add plugin** or `plugin_manager`
`install_bundle`.
