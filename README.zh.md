# dsh-session-surgeon

把打不开的 DeepSeek Harness 会话修回来。

官方以后修加载器，也救不回已经坏掉的 `session.jsonl.zstd`。

GUI（重启 `dsh web` 后）：
- 左侧「会话医生」：扫描 / 检查 / 复制 ID / 预览修复 / 应用修复 / 预览压缩 / 导出 JSONL
- 会话 ⋯ 菜单：复制会话 ID / 检查会话 / 预览修复

```bash
node bin/dsh-session-surgeon.mjs scan
node bin/dsh-session-surgeon.mjs inspect <id>
node bin/dsh-session-surgeon.mjs repair <id>          # 默认 dry-run
node bin/dsh-session-surgeon.mjs repair <id> --apply  # 先写 .bak.<utc>
```

装进本机 web profile：

```bash
git clone https://github.com/xiaoshenming/dsh-session-surgeon.git
cd dsh-session-surgeon
dsh plugin --profile web add link:"$(pwd)"
```

DSH **没有** Codex 那种任务 ID。能 resume 的是 session；goal 只挂在当前会话上，恢复后还要显式 `resume`。详见 [docs/LEARNING-TASKS.md](./docs/LEARNING-TASKS.md)。
