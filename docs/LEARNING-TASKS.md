# 怎么让 DSH「学会某个任务」

> 回答用户原话：怎么让它学习某个任务？我发现这个不像 Codex 那样拥有任务 ID。

短答案：**DSH 没有 Codex task id。** 它有三层更容易混淆的东西：session、goal、todo。学会一个任务 = 把「做法」写成 Skill / 把「未完成目标」写成 Goal / 把「可复现轨迹」留给 session 日志。surgeon 负责让这些日志还能打开。

---

## 1. 三层 ID，别混

### Session（真正能 resume 的东西）

- 位置：`~/.dsh/sessions/--<cwd>--/<id>/session.jsonl.zstd`
- 本对话：`session-6b29ed49-540f-4778-bdff-172942d8c879`
- header 里有 `id` / `cwd` / `agentPreset` / `parentSession` / `delegationDepth`
- 恢复会话 = 重放这段 JSONL，再开一个新 loop
- **恢复不会自动接着干活**（见下节 goal）

子代理是 **另一个 session**，不是同一个任务的子记录：

- 本轮 4 个子代理目录名就是它们的 session id
- header：`parentSession: session-6b29…`，`delegationDepth: 1`，`origin: subagent`，`agentPreset: liangshen`

### Goal（同会话里的「当前目标」）

官方包 `@deepseek-ai/dsh-goal`：

- 一个会话 **最多一个当前目标**
- 持久权威是日志里的 `goal/change` 事件，不是另一张表
- 本机已见到：

```json
{
  "type": "goal/change",
  "data": {
    "operation": "create",
    "goal": {
      "id": "goal-c83eed04-2d26-4388-b7ed-da3a29a987fe",
      "revision": 1,
      "objective": "调研 …",
      "phase": "active",
      "maxGoalRounds": 8
    }
  }
}
```

- 动词：create / edit / pause / resume / complete / block / clear
- `GoalRef = { id, revision }`，陈旧 revision 会被拒
- **续行权限不落盘**。每次 `session-start`、fork、驱动器替换都会 `disarm()`
- 所以：你把 goal id 抄走，新开进程也不会自动续跑；必须再 `resume`
- `maxGoalRounds` 只数轮次，不数 token / 钱 / 挂钟
- 没有并行 goal，没有独立评估器

这就是「不像 Codex 任务 ID」的根因：Codex 的 task 是跨进程的调度对象；DSH 的 goal 是 **挂在当前 session 上的一张状态纸**。

### Todo（更轻）

- 事件：`todo/write`
- 本机例子：`抓取 Discussions… / 派出多智能体…` 这种清单
- 没有稳定 id，下一写就整表替换
- 给模型看进度用，不能当 resume 句柄

### Turn / Message

- `turn/start` `{ turn: N }` —— 会话内递增
- `user/message.data.id` —— 单条消息 id
- 都不是任务 id

---

## 2. 「学会一个任务」在 DSH 里的正确做法

按你想要的「学会」程度选一层，不要幻想官方会冒出 Codex 式 task store。

### A. 学会「以后怎么做」→ 写 Skill

能用大白话说清步骤，就写：

```
~/.dsh/skills/repair-broken-session/SKILL.md
```

或项目内 `.dsh/skills/`。frontmatter 必须是 kebab-case，驼峰会被整份丢弃。

注意：web profile **默认关掉** `tool-skill`。要用 `dsh web --patch enable-skills.yml`，否则静默不生效。

Skill 是判断指引，不是调度器。适合：「修会话时先 scan 再 dry-run 再 apply」。

### B. 学会「这件事还没做完」→ 开 Goal

在**同一个会话**里：

1. `create_goal({ objective, max_goal_rounds })`
2. 模型用 `get_goal` / `update_goal` 推进
3. 进程挂了再打开：**goal 还在日志里，但不会自动跑**
4. 你或插件必须再 `resume`

适合长调研、长修复。不适合「我有 20 个独立任务要排队」。

多个未完成事项：用子代理（多个 child session）或 task-board（你本机已装），不要硬塞进并行 goal。

### C. 学会「上次是怎么做成的」→ 吃 session 轨迹

DSH 最大优势是全量 append-only 日志。一次成功修复的 scan → inspect → repair 全过程都在 JSONL 里。

surgeon 后续会做：

- 从健康 session 抽「成功配方」：用了哪些工具、哪些 fixture、哪些命令
- 导出成 Skill 草稿（人审之后再放进 `~/.dsh/skills`）
- **不会**自动把轨迹当 prompt 无脑回灌（那是 memory 红海，且烧 token）

### D. 不要做的

- 不要再造一套 `tasks.json` 当第二权威
- 不要用 todo 列表冒充可 resume 的任务
- 不要以为抄 goal id 到另一个 session 就能续跑（goal 回放绑在原 session 的连续 revision 上）

---

## 3. surgeon 补上的产品缺口

我们不发明任务系统，只把已有 ID 编成能用的索引：

```
dsh-session-surgeon index
```

输出一张表：

| session | parent | depth | preset | turns | goal id / phase | last turn reason | health |
|---|---|---|---|---|---|---|---|
| 6b29… | — | 0 | standard | 9 | goal-257e… / active | — | ok |
| 2a04… | 6b29… | 1 | liangshen | 1 | — | completed | ok |

然后：

- `inspect <session-id>` 按 turn 列出用户原话（脱敏）
- `export --recipe <session-id>` 抽出「成功工具序列」供人改成 Skill
- GUI 设置页用 session id + goal phase 当标签，不再假装有 Codex task id

这样用户问「我那个调研任务呢？」时，答案是：打开 session `6b29…`，goal `c83eed04…` 已经 complete；要续做就开新 goal，或 `resume` 当前这条。

---

## 4. 和本仓库开发流程的关系

开发 surgeon 本身也用 DSH goal，不另起 Codex 任务：

- 当前 goal：`goal-257e863b-2fe1-468e-ad4c-f8df297369be`
- 权威仍然是本 session 的 JSONL
- 里程碑写在 [PLAN.md](./PLAN.md)，不写进虚构的 task id
