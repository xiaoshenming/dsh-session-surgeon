# dsh-session-surgeon

把打不开的 DeepSeek Harness 会话修回来。

官方以后修加载器，也救不回已经坏掉的 `session.jsonl.zstd`。

```bash
node bin/dsh-session-surgeon.mjs scan
node bin/dsh-session-surgeon.mjs inspect <id>
node bin/dsh-session-surgeon.mjs repair <id>          # 默认 dry-run
node bin/dsh-session-surgeon.mjs repair <id> --apply  # 先写 .bak.<utc>
```

装进本机 web profile：

```bash
dsh plugin --profile web add link:/home/ming/data/Project/DSHProject/dsh-session-surgeon
```

DSH **没有** Codex 那种任务 ID。能 resume 的是 session；goal 只挂在当前会话上，恢复后还要显式 `resume`。详见 [docs/LEARNING-TASKS.md](./docs/LEARNING-TASKS.md)。
