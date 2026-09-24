# Probes

Small, self-contained reproductions of behaviour that is only visible in the
released format packages. They are **not** repair fixtures: nothing here is
ever written to a session root.

## `dangling-tool-call.json` + `run.mjs`

The six-event shape from
[#4549](https://github.com/deepseek-ai/deepseek-harness/discussions/4549): a
`tool/call` is durable, its `tool/result` never is, and the step/turn close
anyway. Two different code paths disagree about it:

| path | entry point | result |
|---|---|---|
| v0→v1 migration **stage** (row-by-row, plain read) | `sessionFormatV0ToV1.createStage(...)` | accepted |
| v0/v1/v2 **restore** | `restoreReleasedV2Artifact(...)` | `step/end leaves unresolved tool call c1` |
| v3→v4 migration **stage** | `createSessionFormatV3ToV4([]).createStage(...)` | accepted |
| v4 **restore** (what publishing a v3→v4 migration runs) | `restoreReleasedV4Artifact(...)` | `step/end leaves unresolved tool call c1` |

Run it where the official packages resolve (a DSH profile, or any checkout with
`@deepseek-ai/dsh-session-format-*` installed):

```bash
node fixtures/probes/run.mjs
# or point at explicit builds:
node fixtures/probes/run.mjs \
  --v0        node_modules/.pnpm/@deepseek-ai+dsh-session-format-v0-to-v1*/lib/index.js \
  --v1-to-v2  .../dsh-session-format-v1-to-v2*/lib/index.js \
  --v3-to-v4  .../dsh-session-format-v3-to-v4*/lib/index.js
```

It prints one line per path and exits non-zero if the split is not reproduced.
The consequence for repair is the point of the probe: an offline tool cannot
append the missing `tool/result` after the step closed, so `dsh-session-surgeon`
only reports `dangling-tool-call` and never manufactures the event.
