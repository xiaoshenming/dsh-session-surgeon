# dsh-session-surgeon

Copy a session ID from the sidebar ⋯ menu, then paste it into a new chat so the new session can learn from the old one — the Codex-style “continue from this thread” move that stock DSH does not expose.

Also repairs DeepSeek Harness sessions that refuse to load. 官方以后修加载器，也救不回已经坏掉的 `session.jsonl.zstd`。

> Compatible with `@deepseek-ai/dsh@0.1.0-rc.6`.

## Why copy the session ID

Stock DSH session ⋯ only has rename / fork / archive. There is no “copy ID”.

After this plugin:

1. Left sidebar, click ⋯ on a session → **复制会话 ID**
2. Open a new chat and paste something like:

   ```text
   Continue from session session-1e66cda9-a046-4893-8f4b-b817080acbea.
   Read that log if you need prior context.
   ```

   or, for an agent with tools:

   ```text
   session_inspect id=session-1e66cda9-a046-4893-8f4b-b817080acbea
   Then keep going from where that conversation left off.
   ```

The ID is the durable handle (with or without the `session-` prefix — same session). Fork duplicates a file; copying the ID lets a **new** session refer to the old one, the way people pass a Codex thread id around.

## Install

One command, same as other DSH plugins:

```bash
dsh plugin --profile web add "github:xiaoshenming/dsh-session-surgeon#main"
```

Restart `dsh web`. Then:

- Session ⋯ menu: **复制会话 ID** (the everyday action) / inspect / dry-run repair
- Sidebar **会话医生 / Session surgeon**: browse conversations, copy id, dry-run repair, apply repair, compact preview, export JSONL

Developers working in a checkout can still use `dsh plugin --profile web add link:"$(pwd)"`.

## Also: repair unloadable sessions

Real crash families from official Discussions:

- [#317](https://github.com/deepseek-ai/deepseek-harness/discussions/317) stack overflow on huge history
- [#1497](https://github.com/deepseek-ai/deepseek-harness/discussions/1497) / [#1586](https://github.com/deepseek-ai/deepseek-harness/discussions/1586) `seq gap in committed region`
- [#436](https://github.com/deepseek-ai/deepseek-harness/discussions/436) lone UTF-16 surrogate → permanent HTTP 400
- [#674](https://github.com/deepseek-ai/deepseek-harness/discussions/674) leftover `.tmp` plaintext

Default repair is dry-run. `--apply` writes `.bak.<utc>` first and never invents missing seqs.

## CLI

No `dsh web` required after the plugin (or this repo) is on disk:

```bash
npx --yes github:xiaoshenming/dsh-session-surgeon scan
npx --yes github:xiaoshenming/dsh-session-surgeon inspect <session-id>
npx --yes github:xiaoshenming/dsh-session-surgeon repair <session-id>          # dry-run
npx --yes github:xiaoshenming/dsh-session-surgeon repair <session-id> --apply  # writes .bak.<utc> first
```

Or from a clone: `node bin/dsh-session-surgeon.mjs scan`.

Agent tools after install: `session_scan` / `session_inspect` / `session_repair` (`apply` defaults to false).

## Commands

| command | meaning |
|---|---|
| `scan [root]` | list sessions + header health + orphan `.tmp` |
| `inspect <id>` | decode every zstd frame, expand packed rows, report seq gaps |
| `repair <id>` | default `--dry-run`; `--apply` rewrites after `.bak.<utc>` |
| `compact <id> --keep-last-turns N` | keep the last N complete turns, renumber seq from 0 |
| `export <id>` | JSONL dump; redacts secrets unless `--no-redact` |
| `index [root]` | session / parent / goal / health table |

`--format text` prints a human table. Exit 0 on success, 2 on usage error, 1 on not-found / refuse.

## What this is not

Not a marketplace, not a token heatmap, not a memory plugin, not a Codex task store.

DSH has **session id + optional same-session goal id**, not a Codex-style resumable task id. Copying the session ID is the closest everyday equivalent. See [docs/LEARNING-TASKS.md](./docs/LEARNING-TASKS.md).

## Docs

- [docs/PLAN.md](./docs/PLAN.md) — milestones, safety, release
- [docs/SESSION-FORMAT.md](./docs/SESSION-FORMAT.md) — zstd frames, header, packed rows, when the official loader refuses
- [docs/REPAIR-SPEC.md](./docs/REPAIR-SPEC.md) — repair steps aligned with the official loader
- [docs/LEARNING-TASKS.md](./docs/LEARNING-TASKS.md) — why there is no Codex task id
- [docs/IMPLEMENTATION-CONTRACT.md](./docs/IMPLEMENTATION-CONTRACT.md) — multi-agent implementation contract

## Safety

- Default is read-only. Write paths require `--apply` and write `.bak.<utc>` first.
- Never commit raw files from `~/.dsh/sessions` (they contain user text and secrets).
- Do **not** put `@deepseek-ai/dsh-tools` in `dependencies`.
- Export redacts `sk-*`, PEM blocks, and home paths unless `--no-redact`.

## License

MIT
