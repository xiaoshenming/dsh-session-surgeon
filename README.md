# dsh-session-surgeon

Repair DeepSeek Harness sessions that refuse to load.

把打不开、卡死、seq 坏掉的 DSH 会话修回来。官方以后修加载器，也救不回已经坏掉的 `session.jsonl.zstd`。

> Status: week 0 skeleton. Compatible with `@deepseek-ai/dsh@0.1.0-rc.6`.
> 仓库位置：`/home/ming/data/Project/DSHProject/dsh-session-surgeon`

## Why

Real crash families from official Discussions:

- [#317](https://github.com/deepseek-ai/deepseek-harness/discussions/317) stack overflow on huge history
- [#1497](https://github.com/deepseek-ai/deepseek-harness/discussions/1497) / [#1586](https://github.com/deepseek-ai/deepseek-harness/discussions/1586) `seq gap in committed region`
- [#436](https://github.com/deepseek-ai/deepseek-harness/discussions/436) lone UTF-16 surrogate → permanent HTTP 400
- [#674](https://github.com/deepseek-ai/deepseek-harness/discussions/674) leftover `.tmp` plaintext

Cost meters / memory / marketplaces are saturated. Almost nobody repairs the JSONL.

## Install (later)

```bash
# CLI, no dsh web required
npx dsh-session-surgeon scan

# optional plugin (week 2)
dsh plugin --profile web add dsh-session-surgeon
```

Right now, from this checkout:

```bash
node bin/dsh-session-surgeon.mjs scan
node bin/dsh-session-surgeon.mjs inspect session-6b29ed49-540f-4778-bdff-172942d8c879
```

## Commands

| command | meaning |
|---|---|
| `scan [root]` | list sessions + header + health hint (header-frame only in week 0) |
| `inspect <id>` | decode every zstd frame, count types, report seq gaps |
| `repair <id>` | **not implemented** — will default to `--dry-run` |
| `compact <id>` | **not implemented** |
| `export <id>` | **not implemented** — will default to redaction |

## What this is not

Not a marketplace, not a token heatmap, not a memory plugin, not a Codex task store.

DSH has **session id + optional same-session goal id**, not a Codex-style resumable task id. See [docs/LEARNING-TASKS.md](./docs/LEARNING-TASKS.md).

## Docs

- [docs/PLAN.md](./docs/PLAN.md) — milestones, on-disk format, safety
- [docs/LEARNING-TASKS.md](./docs/LEARNING-TASKS.md) — how to teach DSH a task

## Safety

- Default is read-only.
- Future write paths require `--apply` and write `.bak.<utc>` first.
- Never commit raw files from `~/.dsh/sessions` (they contain user text and secrets).
- Do **not** put `@deepseek-ai/dsh-tools` in `dependencies`.

## License

MIT
