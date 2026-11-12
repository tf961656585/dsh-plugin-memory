# Memory

Repository memory is experiential knowledge, not an authoritative spec. This
plugin keeps one `memory/` directory per repository and gives both the agent and
the user one contract for reading and changing it.

## What the agent gets

- **Recall**: `memory_recall` ranks entries against the task's file paths, error
  strings, symbols, and wording. At the first step of a turn the plugin also
  injects up to three strongly matching hooks automatically; it never injects the
  whole index.
- **Read**: `memory_get` returns one entry with its evidence and invalidation
  condition.
- **Write while working**: `memory_write` adds, updates, or deletes one entry.
  Every write is validated and regenerates the index.
- **Correct immediately**: when a stored entry contradicts the current code, the
  agent marks it with `memory_stale` instead of using it as a basis for action.
  Stale entries wait in a queue for a deliberate review.
- **Audit**: `memory_audit` reports missing fields, duplicate ids, index drift,
  queue problems, orphan proposals, and evidence files that no longer exist.
- **Propose, don't edit**: `memory_propose` writes a proposal for an AGENTS/spec/
  skill change; the plugin never edits those files itself.

The `/reflect` command starts a deliberate full pass: audit, verify entries,
resolve stale reports, write this session's lessons, and propose read-layer
changes.

## What the user gets

A **Memory** panel in the left sidebar. It is scoped to one project at a time
(the project selector lists repositories that already have a `memory/`
directory):

- browse and search entries, filter by type, expand one to read its trigger,
  evidence, and invalidation condition;
- add or edit an entry with the same validation the agent uses;
- mark an entry as stale with a reason, or resolve the stale queue;
- review proposals before they are applied outside the memory layer;
- run an audit and rebuild the index with one click.

## Limitations

- Evidence checks confirm only that a cited file still exists. Semantic
  invalidation still requires reading the current code.
- A repository without `memory/` is normal. The agent creates the directory on
  the first write; the panel lists only projects that already have one.
- Proposals are listed and can be archived; applying them to AGENTS/spec/skill
  remains a deliberate edit outside this plugin.
