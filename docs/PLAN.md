# dsh-session-surgeon 规划

> 兼容：DeepSeek Harness `0.1.0-rc.6`
> 状态：v0.1 已落地（scan / inspect / repair / compact / export + web 插件）

一句话：把打不开、卡死、seq 坏掉的 DSH 会话修回来，并能压缩、切片、脱敏导出。官方以后修加载器，也救不回已经坏掉的日志。

---

## 1. 为什么做这个，不做什么

### 做

- 扫描 `~/.dsh/sessions` 下所有 `session.jsonl.zstd` / `session.jsonl`
- 诊断：不完整尾帧、seq gap、坏 UTF-16、孤儿 `.tmp`、过大日志
- 修复：强制 `.bak` + dry-run 默认开；去重重叠 seq、丢掉 committed gap 后的脏尾、剥离非法代理码元、补合成 `turn/end` / `step/end` / `tool` closer
- 切片：按 `turn/end` 切成可加载段，生成「续跑入口」
- 脱敏导出：剥密钥 / 绝对路径 / 用户消息里的 token，给 Discussions 当附件

### 明确不做（红海 / 官方会收）

- 插件市场、awesome、桌面壳、桌宠、费用热力图
- 第 N 个 memory / 视觉桥 / doctor
- 改 `agent-loop`
- 把 `@deepseek-ai/dsh-tools` 打进 `dependencies`（#2130 生死线）

---

## 2. 本机已经核实的存储事实

官方包：`@deepseek-ai/dsh-session-persistence-jsonl@0.1.0-rc.6`。

磁盘布局：

```
~/.dsh/sessions/
  --<normalized-cwd>--/          # 例如 --home-ming--
    <encoded-session-id>/
      session.jsonl.zstd         # 默认
      session.jsonl              # 仅 compression: none
```

物理编码：

- 标准 **Zstandard 独立帧拼接**
- **第 1 帧只装 header 一行**（listing 只读这一帧）
- 之后 **每一帧 = 一次 write-behind 追加批次**（默认 200ms 合并窗口）
- 每帧带 checksum；完整帧解压失败 = 整文件拒载
- 最后一帧结构不完整：官方 `load` 会截断并从该帧起点重编码，补合成 closer
- 最后一个已提交 `turn/end` 之前的缺陷 = 官方认定为 corruption，**拒绝加载**

逻辑编码：

- 第 1 行不可变 `SessionHeader`：
  `{ type: 'session', version, id, cwd?, createdAt, parentSession?, seedLength?, origin?, delegationDepth, agentPreset? }`
- `delegationDepth` 必填；缺了官方拒载
- `agentPreset` 持久化，因为恢复时工具集必须一致
- 之后每一行是一条 storage record
- `seq` 在 **解码后的事件流** 上必须连续：`events[i].seq === i`
- 连续 ≥3 条同块 `assistant/chunk` 会被打成 packed 行：
  `text-chunks` / `reasoning-chunks` / `tool-call-chunks`
  带 `seq0` / `time0` / `dt[]`，读的时候必须展开
- 本机会话实测：1531 逻辑行，解码后 lastSeq=7951，packed 行 516 条。
  表面 seq「跳号」是 packed 行，不是损坏。

本机 6 个会话（2026-08-17）：

| id | 角色 | 大小 | 帧数 |
|---|---|---|---|
| session-c5d9a029-… | 顶层（空壳，只有 header） | 1.2MB / 2386 帧 | 异常：大量空追加 |
| session-6b29ed49-… | 本对话（standard） | 619KB / 750 帧 | 健康 |
| 2a04844e-… | 子代理 depth=1，parent=6b29 | 291KB | 健康 |
| 7db0a065-… | 子代理 | 398KB | 健康 |
| 62af9f6a-… | 子代理 | 325KB | 健康 |
| 02f3c83e-… | 子代理 | 559KB | 健康 |

崩溃家族（官方 Discussions）：

- #317 / #370 / #501 / #508 / #534 超长会话 stack overflow
- #1497 / #1586 崩溃恢复与残留执行流并发写 → `seq gap in committed region`
- #436 孤立 UTF-16 代理码元 → 永久 HTTP 400
- #674 崩溃后 `.tmp` 明文残留
- #483 write-behind 丢未 flush 的尾巴

surgeon 的价值：官方修加载器救不回已经写坏的文件。我们修文件。

---

## 3. 和 Codex「任务 ID」到底差在哪

用户直觉是对的：**DSH 没有 Codex 那种跨会话、可 `resume <task-id>` 的任务对象。**

| | Codex | DSH 0.1.0-rc.6 |
|---|---|---|
| 用户能抄走的 ID | thread / task id，CLI 可 resume | **session id**（目录名）+ 可选 **goal id** |
| 一个 ID 对应什么 | 一个可续跑的任务 | 一段 append-only 事件日志 |
| 长期目标 | 任务本身就是一等公民 | `ctx.goals`：**同一会话里最多一个当前目标** |
| 目标持久化 | 任务记录 | 会话日志里的 `goal/change` 事件（本机已见到 `create` / `complete`） |
| 恢复后会不会自动接着干 | 会 | **不会**。续行权限是进程内存态，`session-start` 一律 disarm；必须显式 `resume` |
| 多任务并行 | 多个 task | 系统有意不支持并行 goal；并行靠 **子代理 session**（`parentSession` + `delegationDepth`） |
| 清单 | — | `todo/write` 只是会话内待办，不是任务 ID |
| 轮次 | — | `turn/start` / `turn/end`，`data.turn` 是会话内递增整数 |

本机证据（本对话）：

- session id：`session-6b29ed49-540f-4778-bdff-172942d8c879`
- 第一个 goal：`goal-c83eed04-2d26-4388-b7ed-da3a29a987fe`（调研插件生态，后 complete）
- 第二个 goal：`goal-257e863b-2fe1-468e-ad4c-f8df297369be`（创建本仓库）
- 子代理 4 个，header 里 `parentSession` 指回本会话，`origin: subagent`，`delegationDepth: 1`
- 用户消息有自己的 `id`（例如 `3f3f0f7b-…`），那是消息 id，不是任务 id

所以：

- 「打开某个任务」在 DSH 里 = 打开某个 **session**，必要时再 `get_goal` / `resume`
- 「让它学会某个任务」≠ 给它一个 Codex task id
- surgeon 会把 session / goal / turn / 子代理树编成一张索引，补上这个产品空缺，但 **不发明第二套任务数据库**。权威永远是 JSONL。

详见 [docs/LEARNING-TASKS.md](./LEARNING-TASKS.md)。

---

## 4. 产品形态

两份入口，一个解析器：

1. **CLI（第一周必须能用）**  
   `dsh-session-surgeon <scan|inspect|repair|compact|export>`  
   不依赖 `dsh web` 能起来。会话坏的时候 GUI 往往已经打不开。

2. **Cordis 双半区插件（第二周）**  
   - host：复用同一解析器，注册 `session_scan` / `session_repair` 工具 + 设置页数据 API  
   - client：只占 `settings.plugins.tab`，列出坏会话红点、dry-run diff、一键修复  
   - **不抢** aionui 的 `details` 右栏，不 DOM 补丁

包约束：

- npm 名与仓库同名：`dsh-session-surgeon`
- `dsh.bundle.patch` + 可选 `dsh.client`
- `@deepseek-ai/*` 全部 `peerDependencies` 或 devOnly，**禁止**放进 `dependencies`
- 钉 `0.1.0-rc.6`
- Node `^22.19.0 || >=24`（要用内置 `zlib.zstdDecompressSync`）

---

## 5. 里程碑

### M0 本周（骨架，现在）

- [x] 独立仓库已落地
- [x] PLAN / LEARNING-TASKS / README
- [x] CLI 能列出本机会话 header（只读第 1 帧）
- [ ] 合成 fixture：残缺尾帧、seq gap、lone surrogate、孤儿 tmp
- [ ] 禁止提交真实 `~/.dsh/sessions` 原文（含密钥）

### M1 第 1 周 — scan + inspect

- 按帧解码全部 zstd 帧
- 展开 packed 行，重建逻辑 seq
- 报告：帧失败、JSON 坏行、seq gap、未闭合 turn/step/tool、文件过大、header 缺字段
- 输出 JSON 与人话两种格式
- 黄金测试：合成 fixture 必须稳定复现

### M2 第 1–2 周 — repair

- 默认 `--dry-run`
- 写修复前 `.bak.<utc>`
- 策略（按顺序，每步可关）：
  1. 丢掉最后不完整帧里解不出的字节
  2. committed region 里的重叠 seq：保留先写的，丢掉崩溃重放尾
  3. committed gap：在最后一个合法 `turn/end` 处截断
  4. 剥离孤立 UTF-16 代理码元
  5. 补合成 `tool` / `step` / `turn` closer（对齐官方 persistence 合同）
- 修复后再跑一遍 inspect，seq 必须连续
- 拒绝「修到 header 都没了」的文件，只报告

### M3 第 2 周 — compact + export

- `compact --keep-last-turns N`：前面的 turn 打成摘要事件，保留最近 N 个完整 turn
- 切片：每个切片是合法的独立 session 文件（自己的 header + 连续 seq）
- `export --redact`：密钥正则 + 路径哈希 + 可选丢掉 user 原文

### M4 第 3 周 — GUI + 只读时间线

- 设置页坏会话列表
- 同一解析器上的 turn 时间线（虚拟滚动，不把 8000 seq 一次打进 DOM）
- 不要新开 `dsh-tracebox` 仓库

### 以后再说

- 网关方言包（compat-kit）另开仓库
- 安装闸 / governor / plugin-guard 不塞进本仓库

---

## 6. 安全

- 会话日志含用户消息、工具参数、可能的 API key、绝对路径
- 默认只读；写操作必须 `--apply` 且先备份
- 脱敏导出默认开；`--no-redact` 必须显式
- 真实损坏语料只放 `fixtures/anonymized/`，提交前跑 `scripts/check-no-secrets.sh`
- 插件不监听端口、不改 profile、不访问网络
- README 写清读写哪些目录

---

## 7. 开源发布（做完 M2 再发）

1. 先回帖 #317 / #1497 / #1586：「这帖里的坏日志我修得动」
2. 再开 Show and tell：`New plugin: dsh-session-surgeon — 把打不开的会话修回来`
3. topic：`dsh-plugin` `deepseek-harness`
4. 只给 1 个还在合 PR 的 awesome 提收录，不群发
5. 中文：Linux.do / V2EX，标题写「会话打不开别删」
6. README 第一屏：3 条合成损坏样本 + 修复命令 + 30 秒 GIF

---

## 8. 成功标准

M2 完成时：

- `npx dsh-session-surgeon scan` 能列出本机全部会话并标健康度
- 4 类合成 fixture 全部 `repair --apply` 后可被官方 loader 语义接受（连续 seq、成对 turn、合法 header）
- 不把任何 `@deepseek-ai/*` 打进 runtime `dependencies`
- 对健康的本机会话 `repair --dry-run` 报告 0 处必须修改

---

## 9. 知识文档索引

| 文档 | 回答什么 |
|---|---|
| [PLAN.md](./PLAN.md) | 做什么、不做什么、里程碑、发布 |
| [SESSION-FORMAT.md](./SESSION-FORMAT.md) | 磁盘布局、zstd 帧、header、packed 行、官方何时拒载 |
| [REPAIR-SPEC.md](./REPAIR-SPEC.md) | 修复步骤如何对齐官方 loader |
| [LEARNING-TASKS.md](./LEARNING-TASKS.md) | 为什么没有 Codex task id，怎么让 DSH 学会一个任务 |
