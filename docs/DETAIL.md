# Memory

Repository memory is experiential knowledge, not an authoritative spec. This
plugin keeps one `memory/` directory per repository and gives both the agent and
the user one contract for reading and changing it.

## What the agent gets

- **Recall**: `memory_recall` ranks entries against the task's file paths, error
  strings, symbols, and wording. Titles, hooks, triggers, body text, and evidence
  all participate; rarer words weigh more, so a specific phrase outranks a common
  one. Each hit reports the words that matched. A short query (one or two
  meaningful words) falls back to a low threshold and at most three entries and
  says so. At the first step of a turn the plugin also injects matching hooks
  automatically when the match is strong and lands on the entry's trigger
  surface (title, hook, or trigger) — a shared stock phrase in the body stays
  quiet. It never injects the whole index.
- **Project lexicon**: an optional `memory/lexicon.md` maps the wording people
  actually use onto the wording the entries use (`- 素材 = 贴图, 图片, 资源`).
  Query and entries are normalized through the same table, so either side can be
  written the natural way. The agent maintains it through `memory_lexicon`
  (nobody edits the text by hand): adds are allowed while working and must cite
  the missed query; narrowing or deleting a mapping belongs to `/reflect`. The
  write path refuses a canonical wording absent from the corpus, aliases shorter
  than two characters, and — unless forced with a reason during `/reflect` —
  mappings that would rewrite more than ten entries which never mention the
  canonical word.
- **Read**: `memory_get` returns one entry with its evidence and invalidation
  condition.
- **Write while working**: `memory_write` adds, updates, or deletes one entry.
  `update` takes a partial payload — omitted fields keep their current value — and
  accepts either a bare id or `file#id`. Every write is validated and regenerates
  the index.
- **Verify**: `memory_verify` stamps `核验于` on one entry without touching its
  content; keeping a stale entry after review stamps it too. The index shows the
  date so an old unverified entry never looks freshly confirmed.
- **Correct immediately**: when a stored entry contradicts the current code, the
  agent marks it with `memory_stale` instead of using it as a basis for action.
  Stale entries wait in a queue for a deliberate review.
- **Audit**: `memory_audit` reports missing fields, duplicate ids, index drift,
  queue problems, orphan proposals, and evidence files that no longer exist.
- **Propose, don't edit**: `memory_propose` writes one proposal per file for an
  AGENTS/spec/skill change; the plugin never edits those files itself. After the
  user approves and the edit lands, the agent closes the proposal with
  `action=resolve` and must quote the approval; only pending proposals count.

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
- review proposals with their status (pending or applied, with the approval record);
- run an audit and rebuild the index with one click.

## Limitations

- Evidence checks confirm only that a cited file still exists. Semantic
  invalidation still requires reading the current code. Short paths are completed
  on write when the suffix is unique; an ambiguous suffix is refused.
- Recall is lexical: a paraphrase whose words appear nowhere in the entry and
  nowhere in the lexicon still misses. The lexicon is the only synonym source; it
  is a handful of lines per project, not a growing dictionary.
- The lexicon is edited as text today; the panel shows entries, not the lexicon.
- A repository without `memory/` is normal. The agent creates the directory on
  the first write; the panel lists only projects that already have one.
- Proposals are listed with their status; applying them to AGENTS/spec/skill
  remains a deliberate edit outside this plugin, after which the agent marks the
  proposal applied.
