# dsh-session-surgeon

Repair DeepSeek Harness sessions that refuse to load.

把打不开、卡死、seq 坏掉的 DSH 会话修回来。官方以后修加载器，也救不回已经坏掉的 `session.jsonl.zstd`。

> Compatible with `@deepseek-ai/dsh@0.1.0-rc.6`.

## Why

Real crash families from official Discussions:

- [#317](https://github.com/deepseek-ai/deepseek-harness/discussions/317) stack overflow on huge history
- [#1497](https://github.com/deepseek-ai/deepseek-harness/discussions/1497) / [#1586](https://github.com/deepseek-ai/deepseek-harness/discussions/1586) `seq gap in committed region`
- [#436](https://github.com/deepseek-ai/deepseek-harness/discussions/436) lone UTF-16 surrogate → permanent HTTP 400
- [#674](https://github.com/deepseek-ai/deepseek-harness/discussions/674) leftover `.tmp` plaintext

Cost meters / memory / marketplaces are saturated. Almost nobody repairs the JSONL.

## Install

After `dsh web` restart:

- Sidebar **会话医生 / Session surgeon**: scan, inspect, copy id, dry-run repair, apply repair, compact preview, export JSONL
- Session ⋯ menu: copy session id / inspect / dry-run repair

CLI, no `dsh web` required:

```bash
node bin/dsh-session-surgeon.mjs scan
node bin/dsh-session-surgeon.mjs inspect <session-id>
node bin/dsh-session-surgeon.mjs repair <session-id>          # dry-run
node bin/dsh-session-surgeon.mjs repair <session-id> --apply  # writes .bak.<utc> first
```

Hot-plug into the web profile (does not patch DSH source):

```bash
git clone https://github.com/xiaoshenming/dsh-session-surgeon.git
cd dsh-session-surgeon
dsh plugin --profile web add link:"$(pwd)"
```

Then restart `dsh web`. Agent tools: `session_scan` / `session_inspect` / `session_repair` (`apply` defaults to false).

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

DSH has **session id + optional same-session goal id**, not a Codex-style resumable task id. See [docs/LEARNING-TASKS.md](./docs/LEARNING-TASKS.md).

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
