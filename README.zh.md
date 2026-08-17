# dsh-session-surgeon

把打不开的 DeepSeek Harness 会话修回来。

官方以后修加载器，也救不回已经坏掉的 `session.jsonl.zstd`。

当前是第 0 周骨架。完整规划见 [docs/PLAN.md](./docs/PLAN.md)。

```bash
node bin/dsh-session-surgeon.mjs scan
```

DSH **没有** Codex 那种任务 ID。能 resume 的是 session；goal 只挂在当前会话上，恢复后还要显式 `resume`。详见 [docs/LEARNING-TASKS.md](./docs/LEARNING-TASKS.md)。
