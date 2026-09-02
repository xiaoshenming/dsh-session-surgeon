# dsh-session-surgeon

左侧会话 ⋯ → **复制会话 ID**，贴进新对话，让新会话接着学旧会话。这是 Codex 那种「拿线程 ID 继续聊」的用法；官方菜单只有重命名 / 分叉 / 归档，没有复制 ID。

同时能修好打不开的 DeepSeek Harness 会话（seq gap / torn zstd / 孤立代理字符 / 消息缺 ID）。崩溃恢复插进来的短闭包如果撞上还活着的写者（#1586），会丢掉那几条合成闭包、保住后面的真内容，而不是一刀切到第一个缺口。packed 行只重叠已经提交的前缀、后面连续时（#5151），会接上尚未提交的后缀。文件已经 seq gap 时 compact 会拒绝，先停写者再 repair。Alpha 把 `sourceEventSeqs` 压成区间（#5160）时，当前 rc.2 打不开；repair 会把 `[start,end]` 无损展开成密集整数（区间里本来就有这些序号，不是伪造历史）。Alpha 写入、rc.2 不认识的 `model/selection` 会在结构校验通过后保留原事件，只补 `ignorable: true`；任意未知插件事件绝不套用。`inspect` 还会**警告**悬空 `tool/call`（没有对应 `tool/result`，下次模型请求永久 400）以及空的 `tool_calls[].id`（#5182，下次请求 `id cannot be empty`），但**不会编**假结果或假 callId。官方以后修加载器，也救不回已经坏掉的 `session.jsonl.zstd`。

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

在能加载本仓库技能的对话里，说一句 **更新插件** 即可：扫官方 Discussions、吸收对口反馈、改代码、写 CHANGELOG、回复、用 px 推 `main`。技能正文：[skills/dsh-session-surgeon-update/SKILL.md](./skills/dsh-session-surgeon-update/SKILL.md)。

## 命令行

```bash
npx --yes github:xiaoshenming/dsh-session-surgeon scan
npx --yes github:xiaoshenming/dsh-session-surgeon inspect <id>
npx --yes github:xiaoshenming/dsh-session-surgeon repair <id>          # 默认 dry-run
npx --yes github:xiaoshenming/dsh-session-surgeon repair <id> --apply  # 先写 .bak.<utc>（Windows 上备份文件只读 fsync 的 EPERM 不再中止 apply）
```

DSH **没有** Codex 那种任务 ID。能 resume 的是 session。复制会话 ID 是日常最接近的做法。详见 [docs/LEARNING-TASKS.md](./docs/LEARNING-TASKS.md)。
