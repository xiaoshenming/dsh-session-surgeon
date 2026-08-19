# dsh-session-surgeon

左侧会话 ⋯ → **复制会话 ID**，贴进新对话，让新会话接着学旧会话。这是 Codex 那种「拿线程 ID 继续聊」的用法；官方菜单只有重命名 / 分叉 / 归档，没有复制 ID。

同时能修好打不开的 DeepSeek Harness 会话（seq gap / torn zstd / 孤立代理字符 / 消息缺 ID）。官方以后修加载器，也救不回已经坏掉的 `session.jsonl.zstd`。

## 最常用：复制会话 ID

1. 左侧某条会话点 ⋯ → **复制会话 ID**
2. 开一个新聊天，把 ID 贴进去，例如：

   ```text
   接着 session-1e66cda9-a046-4893-8f4b-b817080acbea 继续。
   需要旧上下文时去读那份会话。
   ```

   如果新会话已经装了本插件的 agent 工具：

   ```text
   session_inspect id=session-1e66cda9-a046-4893-8f4b-b817080acbea
   从上次停的地方继续。
   ```

有 `session-` 前缀和没有前缀是同一种会话，只是 ID 写法不同。分叉会复制一份文件；复制 ID 是让**新会话引用旧会话**。

## 安装

和其他 DSH 插件一样，一条命令：

```bash
dsh plugin --profile web add "github:xiaoshenming/dsh-session-surgeon#main"
```

然后重启 `dsh web`。

- 会话 ⋯ 菜单：**复制会话 ID**（日常就用这个）/ 检查 / 预览修复
- 左侧「会话医生」：看对话、复制 ID、预览修复、应用修复、导出

本地改代码时仍可用 `dsh plugin --profile web add link:"$(pwd)"`。

## 命令行

```bash
npx --yes github:xiaoshenming/dsh-session-surgeon scan
npx --yes github:xiaoshenming/dsh-session-surgeon inspect <id>
npx --yes github:xiaoshenming/dsh-session-surgeon repair <id>          # 默认 dry-run
npx --yes github:xiaoshenming/dsh-session-surgeon repair <id> --apply  # 先写 .bak.<utc>
```

DSH **没有** Codex 那种任务 ID。能 resume 的是 session。复制会话 ID 是日常最接近的做法。详见 [docs/LEARNING-TASKS.md](./docs/LEARNING-TASKS.md)。
