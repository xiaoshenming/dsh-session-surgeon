# Probes

Small, self-contained reproductions of behaviour that is only visible in the
released format packages. They are **not** repair fixtures: nothing here is
ever written to a session root.

## `dangling-tool-call.json` + `run.mjs`

The six-event shape from
[#4549](https://github.com/deepseek-ai/deepseek-harness/discussions/4549): a
`tool/call` is durable, its `tool/result` never is, and the step/turn close
anyway. Five paths disagree about it — measured identically on
`@deepseek-ai/dsh@0.1.7-rc.1` and `0.1.7-rc.2`:

| path | entry point | result |
|---|---|---|
| v0→v1 migration **stage** (row-by-row) | `sessionFormatV0ToV1.createStage(...)` | accepted |
| v0/v1/v2 **restore** | `restoreReleasedV2Artifact(...)` | `step/end leaves unresolved tool call c1` |
| v3→v4 migration **stage** | `createSessionFormatV3ToV4([]).createStage(...)` | accepted |
| v4 **restore** (what publishing a v3→v4 migration runs) | `restoreReleasedV4Artifact(...)` | `step/end leaves unresolved tool call c1` |
| **reading a stored current-generation log** | `readStoredLog(path, id)` (`SessionLogScanner.finish()` → `assertReleasedV4Relationships`) | `SessionPersistenceCorruptionError: stored log is corrupt: … leaves unresolved tool call c1` |

Rows 1–4 hand the same six events to a stage or a restore. Row 5 writes a real
v4 artifact (`--tmp-probe-cwd--/session-probe/session.v4.jsonl.zstd`, header
frame plus one event frame, `checksumFlag=1`) into a temporary directory and
reads it back through the official read path, so the refusal a user sees is
reproduced end to end. The temporary directory is removed again.

Run it where the official packages resolve (a DSH profile, or any checkout with
`@deepseek-ai/dsh` installed):

```bash
node fixtures/probes/run.mjs
# or point at explicit builds:
node fixtures/probes/run.mjs \
  --v0          node_modules/@deepseek-ai/dsh-session-format-v0-to-v1/lib/index.js \
  --v1-to-v2    .../dsh-session-format-v1-to-v2/lib/index.js \
  --v3-to-v4    .../dsh-session-format-v3-to-v4/lib/index.js \
  --persistence .../dsh-session-persistence-jsonl/lib/index.js
```

It prints one line per path and exits non-zero if any row drifts. Every entry
point re-parses the fixture on purpose: the official `restore.decodeRow()`
rewrites the row objects it is handed **in place** — reusing one parsed batch
across verdicts can silently flip the second one (reported with a reproduction
in [#6559](https://github.com/deepseek-ai/deepseek-harness/discussions/6559)).

The consequence for repair is the point of the probe: an offline tool cannot
append the missing `tool/result` after the step closed, so `dsh-session-surgeon`
only reports `dangling-tool-call` and never manufactures the event. Because the
current generation checks relationships on the ordinary read path too, such a
session may not open at all — the inner error text is the same on every path;
only the outer wrapper (`SessionFormatError` vs `SessionPersistenceCorruptionError`)
tells the entry points apart.
