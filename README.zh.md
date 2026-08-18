# dsh-session-surgeon

把打不开的 DeepSeek Harness 会话修回来。

官方以后修加载器，也救不回已经坏掉的 `session.jsonl.zstd`。

## 安装

和其他 DSH 插件一样，一条命令：

```bash
dsh plugin --profile web add "github:xiaoshenming/dsh-session-surgeon#main"
```

然后重启 `dsh web`。

- 左侧「会话医生」：扫描 / 检查 / 复制 ID / 预览修复 / 应用修复 / 预览压缩 / 导出 JSONL
- 会话 ⋯ 菜单：复制会话 ID / 检查会话 / 预览修复

本地改代码时仍可用 `dsh plugin --profile web add link:"$(pwd)"`。

## 命令行

```bash
npx --yes github:xiaoshenming/dsh-session-surgeon scan
npx --yes github:xiaoshenming/dsh-session-surgeon inspect <id>
npx --yes github:xiaoshenming/dsh-session-surgeon repair <id>          # 默认 dry-run
npx --yes github:xiaoshenming/dsh-session-surgeon repair <id> --apply  # 先写 .bak.<utc>
```

DSH **没有** Codex 那种任务 ID。能 resume 的是 session；goal 只挂在当前会话上，恢复后还要显式 `resume`。详见 [docs/LEARNING-TASKS.md](./docs/LEARNING-TASKS.md)。
