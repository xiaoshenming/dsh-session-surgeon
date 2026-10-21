# 修复规格（对齐官方 loader）

目标：`repair --apply` 之后的文件，必须能被**本机已安装**的 `@deepseek-ai/dsh-session-persistence-jsonl`（现为 0.1.7-rc.2；桌面端 0.2.0-rc.2 同一代际，格式仍是 v4；v0–v4 代际同一套合同）的 `load()` 接受，并且重放后 turn/step/tool 闭合。

官方只修 torn tail。下面每一条都是「官方拒载、我们才动手」的合同。

---

## 0. 总原则

1. 默认 `--dry-run`。没有 `--apply` 不许写。
2. `--apply` 先把原文件复制为 `session.jsonl.zstd.bak.<utc>`，再动原文。
3. 修错比不修更惨。header 都解不出 → 只报告，不写。
4. 不把 `@deepseek-ai/dsh-session` 打进 runtime `dependencies`。可以对齐它的语义自己实现；测试可以用 devDependency 对照官方 `decodeStorageRecord` / `interruptedTurnClosers`。
5. 真实 `~/.dsh/sessions` 禁止进 git。只提交合成 fixture。

---

## 1. 诊断分类

| code | 含义 | 官方态度 | 我们 |
|---|---|---|---|
| `header-ok` | 第 1 帧能解，header 形状合法 | 列入 list | 健康（还要全文 inspect） |
| `header-frame-corrupt` | 第 1 帧 checksum / 解压失败 | 拒载 | 不修 |
| `foreign-version` | `version !== 0` | 「请升级 harness」 | 不修，提示升级 |
| `torn-tail` | 最后一帧不完整 | load 时自动截断+closer | 可离线做同样的事（dsh 起不来时） |
| `header-frame-multiline` | 第 0 帧里除了表头行还装着正文（离线脚本「解压全部帧 → 追加一条 → 整体重压一帧」的产物） | **拒载**：读取端第一件事就是 `first frame is not exactly one header line`，整条会话打不开，尽管**每一行都完好**（#10440 的 13 个坏会话里有 12 个是这个形状） | **重新分帧**：第一行写回第 0 帧，其余行原样作为正文（排在后续帧之前）。事件、seq、内容一个字节不动，改动只在帧边界；首行解不出表头时仍报 `header-frame-corrupt` 并 refuse |
| `zero-fill-tail` | 最后一个完整帧之后直到 EOF 全是 0 字节（`write()` 与 `fsync()` 之间崩溃：#9372） | **拒载**：`invalid frame magic at byte <已提交长度>`（官方扫描器把零区当成坏魔数，整条会话打不开） | 丢掉零区，已提交的每一帧原样保留；**只有全 0 才算这个形状**，非 0 垃圾照旧只报告 |
| `failed-middle-frame` | 中间完整帧解压失败 | 整文件拒载 | 不自动修；报告帧号 |
| `unparsable-line` | 某行不是 JSON / packed 行畸形 | 若之后有 turn/end → 拒载 | 丢掉该行及之后，或停在上一 turn/end |
| `seq-gap-committed` | 展开后 seq 不连续，且之后有 turn/end | **拒载**（#1497/#1586） | 主修复路径；若能证明是崩溃恢复闭包 vs 还活着的写者，丢掉闭包、保留 live 分支 |
| `packed-overlap-suffix` | packed 行从已提交 seq 往回重叠、后缀连续且前缀与已提交事件一致 | **拒载**（#5151） | 丢掉已提交前缀成员，收下尚未提交的后缀 |
| `newer-format-ranges` | `sourceEventSeqs` 含 `[start,end]` 区间（Alpha #3048，version 仍为 0） | **0.1.2-rc.1+** persistence 读时展开，文件健康；更旧 rc.2 `foldSurface` 仍拒载（#5160） | 仅当本机 runtime **没有** `decodeSeqRanges` 时展开成密集整数；有则 no-op |
| `duplicate-tool-call-id` | 同一步 `assistant/message` 多次通告同一 `callId` | **0.1.3+** v0→v1 迁移拒读（#5909）；v4 另在读盘的关系折叠里拒（`repeats advertised tool call`） | 仅当本机 `SESSION_FORMAT_VERSION >= 1` 时给后出现的 id 加 `#n`，并按出现顺序重映射 `tool/call.callId`、`tool/result` 的 `message.toolCallId` + `source.callId`，以及 `data.stream` 里带 id 的记录（`tool-call-chunks` / `block-end` / 未合并的 `tool-call-delta`）；替换行沿用被替换行的 id。映射不完整就整体 refuse，不猜 id、不编空 id |
| `prune-tail-outside-turn` | `turn/end` 之后、没有开着回合时出现 replacement `tool/result`（空闲 tool-result 修剪器的输出，#8812） | **拒载**：两个已发布读端都把非 append 的 `tool/result` 走 `requireTurn()`（`assertReleasedV4Relationships`；0.2.0-rc.2 的 worker 里是 `else if (openTurn === null) throw "tool/result replacement is outside an open turn"`） | 仅当最后 `turn/end` 之后**整段**都是修剪器自己的行（`compaction/prune` + replacement `tool/result`，且 `sourceEventSeqs` 全部指向切点之前）时，裁回那个 `turn/end`；它们只遮蔽本来还在盘上的 surface 节点，不丢消息/回合/工具结果。尾巴里有别的东西、或没有可切的 `turn/end` → refuse 并说明原因 |
| `producer-source-invalid` | 消息 `source` 缺失/不是对象，或 `kind` 缺失、空、非字符串、与该槽位要求的 kind 不符（`system/message`→`system-prompt`、`assistant/message`→`model`、`tool/result`→`tool`；`user`/`developer` 任意非空且 ≠ `plugin`） | **拒载**：v4 准入 `assertV4MessageSources`（读盘每条都跑）+ seed 构造（槽位 kind 那条报 `message must have model source` 等） | **只报告**：正确值在工件里没有唯一答案；`{kind:"plugin"}` 字面量另有 `v4-literal-plugin-source` 可修，不并入这条 |
| `legacy-replay-state` | `assistant/chunk` finish / message source 的 `replayState` 根上有 `kind`（扁平 pi-ai） | **0.1.3+** v0→v1 `unexpected member "kind"`（#5694/#5909）；v0 仍能打开 | 仅当本机 format ≥ 1 时把除 `blocks` 外的键挪进 `response`；不编字段 |
| `title-references-invalid` | `session/title` 的 `messageSeqs` 违反两条折叠规则之一：**用户标题必须留空**；其余标题的每条引用必须是**更早、去重、`source.kind === "user"` 的** `user/message`（注入的 `runtime-context` / `team-message` 不算） | **拒载**：`session/title messageSeqs must be empty exactly for a user title` / `must cite distinct earlier human user/message events`，整条会话打不开（#10440 变体 C：补标题脚本按「离标题最近的若干事件」凑引用，10 条指到 `step/start`） | 用户标题的引用清空；指向不了真人消息的引用逐条丢掉（保留其余）。非用户标题若一条合法引用都不剩，它究竟来自哪些消息在工件里没有答案 → 只报告。仅 v4 判定（更早的阶段会改写标题行） |
| `llm-retry-chain` | 同一条 policy 链（`turn`/`step`/`provider`/`policyKey`）里的 `llm/retry` 没有逐次 +1，或一条链用了多个 `retryId` | **拒载**：关系折叠 `llm/retry skips its policy attempt sequence` / `llm/retry must keep one retryId per policy chain` → `stored session "…" is corrupt`，且写入时静默、下次打开才暴露（#9163） | 次数 = 该链内的顺序（1..N），id = 该链第一个 `retryId`；`llm/retry-started` 按原 `(retryId, retry)` 配对表跟着改。链身份不可比、配对不上、或新链复用了已有 id → refuse，不猜 |
| `v0-preset-extra-member` | `permission/preset` data 带冻结清单外成员（如 `origin`） | **0.1.5** v0→v1 迁移拒读（#6189）；v0 仍能打开 | 仅当本机 format ≥ 1 时只保留 `preset`，权限语义不变 |
| `v0-descriptor-version` | `subagent/descriptor` data.version ≠ 3 | **0.1.5** 迁移拒读 v0 工件（#6151） | 仅当本机 format ≥ 1 时把 version 改成 3（成员形状相同） |
| `v0-plugin-source-form` | 插件消息来源的 `form` 与 `summary`/`sections` 对不上（`form` 缺失时**不判**——官方在 `form === undefined` 处直接 return，两个成员都不看） | **0.1.5** v0→v1 迁移拒读（#6194；#10096 是同一闸门的现场。0.2.0-rc.2 与 0.2.1-rc.2 的该文件 SHA256 相同） | 仅当本机 format ≥ 1 时**对齐 `form`**：`sections` 是数组→`snapshot`，否则字符串 `summary`→`notice`；两者并存时保留 `sections`、丢掉展示用 `summary`（保住结构化内容）；无法渲染的成员（非数组 `sections`、非字符串 `summary`）与没有成员可依据的 `form`（未知字面量、`notice` 无 `summary`、`snapshot` 无 `sections`）连同该成员一起丢掉——否则整条会话会为一条展示提示打不开。正文不动。**只在 v0 工件上判**：该闸门只在 v0→v1 阶段运行，v3 会话里 `form:"snapshot"` + `sections` 完全合法（本机两份真实 v3 会话曾因此被报码并计划改写） |
| `v0-chunk-provenance` | `assistant/message` 分块引用不是同一 (turn,step) 自上次尝试边界（`turn/end`/`step/end`/`llm/retry`/`llm/retry-started`，同官方 `closesAttempt`）以来的完整有序一段 | **v0→v1 与 v1→v2 两道迁移都拒读**（#6175；[#7824](https://github.com/deepseek-ai/deepseek-harness/discussions/7824) 是声明范围把 `session/end-seed` 这类非分块事件也扫了进去；[#3](https://github.com/xiaoshenming/dsh-session-surgeon/issues/3) 漏判重试边界） | 仅当本机 format ≥ 1 时改引用磁盘上已有的分块 seq；无分块时改为空引用；`surfaceOp` 为 replace 的消息（/rewind 撤回标记）**绝不动**——其引用是 `applySurface` 要求的 shadowed 节点 |
| `v0-retired-source-kind` | 消息 `source.kind` 是已退役字面量（如 `instruction-hint`），不在 v2→v3 `SOURCE_KINDS` 里 | **0.1.5 / 0.1.6 / 0.1.7-rc.1 / 0.1.7-rc.2** 的 v2→v3 `assertSource` 按未分类拒读（#6559） | 仅当本机 format ≥ 1 时把 kind 改成同名后继（`plugin`），键集必须与 released plugin 来源完全一致；多出未知成员的一律不碰（只报告） |
| `v0-inbox-inserted-message` | `agent/inbox/spliced` 的 `inserted[]` 消息缺 `id` / `role` | v0→v1 `messageValue` 拒读整条会话（#6559） | 仅当本机 format ≥ 1 时补 `id`（与 `message-missing-id` 同一做法）与校验器实参写死的 `role: "user"`；正文/来源不动；content、source 缺失或带未知成员的不碰 |
| `forward-event-shim` | Alpha `model/selection` 降级后 rc.2 不认识 | `SessionFormatUnsupportedError` | 仅在官方结构校验通过时加 `ignorable: true`；保留 type/data/seq/time |
| `seq-overlap-replay` | 同一 seq 出现两次（崩溃重放） | 表现为 gap/overlap | 保留先写的，丢掉重放尾 |
| `lone-surrogate` | 事件或 header 的字符串含孤立 UTF-16 代理 | 文件照常加载，但之后每轮请求都 400（#436、#8466） | 事件里替换 U+FFFD（报出 `seq N (类型)`）；header 里只报告，见 2.4 |
| `orphan-tmp` | 旁边有 `.tmp` | 不管 | 列出；不自动当正本 |
| `open-tail` | 缺 tool/step/turn 闭合，但 seq 连续 | 官方补 closer | 复用同一语义 |
| `huge-history` | 事件/token 过多 | 加载 stack overflow（#317） | compact / 切片，不叫 repair |
| `turn-end-reason-invalid` | `turn/end` 的 `data.reason` 不是带字符串 `kind` 的对象（`null` / 缺失 / 类型不对） | **两道闸门都放行**：关系折叠只比对 turn 坐标，`Session.fromRestore` 根本不读 `reason` → 文件能加载；但官方聊天客户端读 `reason.kind` 时没有判空 → 该会话每次打开都白屏（#10489：`agent.cancel()` 传 union 外的 kind 抛 `unreachable variant` 并照样落盘） | **只报告**：这一回合完成/出错/被取消在工件里没有答案，编一个 `reason` 等于把猜测写成事实 |
| `empty-tool-call-id` | `assistant/message` 的 `tool-call` 或 `tool/call` 的 id 为空（#5182） | 文件能打开，下次模型请求永久 400 | inspect 定位；**不编** callId |
| `unknown-type` | type 不在本 build 词表且无 ignorable | 可能拒载 | 保留，标出来 |
| `packed-surface-skip` | 没展开 packed 行看到的假跳号 | 健康 | inspect 必须先展开 |

### 1.1 每条判据只在自己的代际上成立

装载一份文件会从它自己的代际起，依次跑**每一道**上游迁移（v0 走 v0→v1→v2→v3→v4，v2 只走 v2→v3→v4），所以：

- 属于阶段 N 的判据，只对**代际 ≤ N** 的文件成立；
- 代际比 N 新的文件根本不会经过那道闸门，拿它去判就是**假阳性**。

`migrationRefusalIssues(events, fileVersion)` 按这张表收口：`v0-preset-extra-member` / `v0-descriptor-version` / `v0-plugin-source-form` / `v0-inbox-inserted-message` 到 v0，`v0-chunk-provenance` 到 v1（v0→v1 与 v1→v2 两道边都拒），`v0-retired-source-kind` 到 v2（v0 闸门没有 kind 白名单，实测 `instruction-hint` 在 v0→v1 上通过）。

这条不是理论问题：本机两份真实 v3 会话带着 `@deepseek-ai/dsh-system-prompt` 的 `{form:"snapshot", sections}` 来源（完全合法），却被报成 `v0-plugin-source-form`，`planRepair` 给出 `mustWrite: true` —— 用户一旦 `--apply`，健康文件就被重写一遍。同类错在 v4 侧已经踩过（配对/表面/PTC 三条都按 `fileVersion >= 4` 收口），这里是把 v0 家族补齐。

---

## 2. repair 步骤（按顺序，每步可关）

对单个 session 文件：

### 2.1 解码

1. 按帧切开 `session.jsonl.zstd`
2. 第 1 帧 → header。失败则停
3. 后续完整帧 → JSONL 行
4. 每行 `JSON.parse` + 展开 packed 行（对齐 `decodeStorageRecord`）
5. 得到逻辑事件数组 `events[]`，期望 `events[i].seq === i`

若未知事件是结构完整的官方 Alpha `model/selection`，repair 可只给事件 envelope 加
`ignorable: true`。官方将它定义为 log-only、不会进入派生模型历史，因此 rc.2 跳过它
不会改变对话内容。其他未知类型（尤其插件事件）不套用此规则。

### 2.2 torn-tail

若最后一帧不完整：

- 保留该帧里已经是完整行、且能展开的事件
- 丢掉帧尾垃圾字节
- 记 `truncateTo = 该帧起点`

这是官方 `commitRepair` 的前半段。我们可以在 dsh 没起来时替它做。

### 2.2b zero-fill-tail（#9372）

崩溃落在 `write()` 与 `fsync()` 之间时，**文件长度先落盘、帧数据没落盘**，那段读回来全是 `0x00`（NTFS `ValidDataLength`、XFS/ext4 延迟分配）。官方扫描器在第一个零字节处判坏魔数并整条拒载（`invalid frame magic at byte <已提交长度>`），所以一条**已提交前缀完全完好**的会话打不开。

- 判据要窄：`scanZstdFrames` 只在「从某个 offset 到 EOF **全是 0**」时返回 `zeroTailAt`；非 0 垃圾（含「零区后面还有真帧」）照旧抛 `invalid frame magic`，不做猜测
- 零区不贡献任何事件，所以 repair 丢掉的只有那串 0；已提交的帧、事件、seq 一个不动（测试断言修复前后 `events` 深度相等）
- 与 `torn-tail` 的区别：torn 是**帧结构读到一半就 EOF**（有合法魔数、声明长度超出文件）；零区是**连魔数都没有**
- raw（`compression: 'none'`）日志不走这条路径，同形状只报告

### 2.3 seq-gap / overlap（核心）

官方规则：缺陷一旦出现，再看到 `turn/end` 就整段拒载。

我们的策略：

1. 找到第一个 `event.seq !== index` 的位置 `i`
2. 向后看是否还有 `turn/end`
3. **有**（committed gap）：
   - 先看 committed 前缀是否以官方崩溃恢复闭包结尾（`interrupted-tool-result-*` / `turn/end interrupted` / 可选 `session/end-seed`），且 overflow 从同一 seq 连续续写（还活着的写者，#1586）：
     - **丢掉那几条合成闭包，保留 live 分支**。seq 已经对得上，不发明序号。
   - 否则回退到 `i` 之前最后一个 `turn/end`（含这条），丢掉之后全部事件
   - 认不出 live 写者时，这是「保住已经提交的轮次，放弃崩溃后的脏尾」
   - packed 行从已提交 seq 往回重叠、连续接到当前游标、且重叠前缀与已提交事件一致（#5151）：**丢掉已经提交的前缀成员，收下尚未提交的后缀**。前缀对不上就当普通 seq gap。后面如果还有真正的空洞，仍然按上面裁切。
4. **没有**（只是尾巴乱）：
   - 丢掉 `i` 及之后
   - 走 2.5 补 closer
5. overlap（后写的 seq ≤ 已接受的 lastSeq）：
   - 视为崩溃重放，丢掉从这条开始的尾巴
   - 不要尝试 merge 两条重放流

不要在 committed 中间「补缺失 seq」。缺的事件没有原文，补了是在伪造历史。

### 2.4 lone-surrogate

扫描每个事件的字符串（以及 header）：

- 孤立高代理或低代理 → 替换为 `U+FFFD`（或删除，二选一，默认替换）
- 只动字符串内容，不动 seq / type
- 修完必须还能 JSON.stringify 并被官方 parse
- 判定必须报出**位置**（`seq N (类型)` + `seqs`）：文件本身照常加载，用户只看到 `DeepSeek Messages request failed (400)`，定位就是这条诊断的全部价值（#8466）
- **header 里的代理只报告、不改写**：header 的 `cwd` 写着这份日志所在的目录，就地改写会让日志离开命名它的目录（Windows 目录名可以带不成对代理，所以可达）。这种情况要说清「只报告」，不能留下「inspect 说坏、repair 说没事」的死角

### 2.4b llm-retry-chain（#9163）

关系折叠 `Relationships.retry` 的规则（0.1.7-rc.2 / 桌面 0.2.0-rc.2 同形）：

- 链身份 = `(turn, step, provider, policyKey)` 四元组（`===` 逐个比；`policyKey` 不是原始值时这条规则永远不成立，我们 refuse）
- `llm/retry`：`retry` 必须是**同一链上一条**的 `retry + 1`，链首为 1
- `llm/retry`：链首那条的 `retryId` 不能已经被**任何**更早的 retry 用过；链内其余各条必须与链首同一个 `retryId`
- `llm/retry-started`：必须配到一条**更早**的 `llm/retry`（按 `(retryId, retry)` 查找），且 `turn`/`step` 一致；同一个 `(retryId, retry)` 不能配两次

两个值都从日志里还原，不是猜：**次数 = 该链内的顺序**，**id = 该链第一个 `retryId`**。`llm/retry-started` 用「原 `(retryId, retry)` → 新 `(retryId, retry)`」的配对表跟着改（原配对表在链内必须唯一，否则 refuse）。

refuse 的情形：链身份含对象、`retryId` 不是非空字符串、`retry` 不是正整数、新链复用了更早出现过的 id、链内 `(retryId, retry)` 重复、started 配不上/坐标不一致/重复配对。**已经合规的链一个字节都不改**（`fixed: 0`），所以健康会话仍然 `mustWrite: false`。

### 2.5 合成 closer

对仍未闭合的尾巴，对齐 `interruptedTurnClosers(events)`：

1. 每个「只有 assistant 请求、没有 `tool/call`」→ 合成 `TOOL_NOT_STARTED` 结果
2. 每个「有 `tool/call`、没有 `tool/result`」→ 合成 `TOOL_OUTCOME_UNKNOWN`
3. 若有未闭合 `step/start` → `step/end`
4. 若有未闭合 `turn/start` → `turn/end`，reason = interrupted
5. 新事件的 `seq` 从 `events.length` 接着编
6. `time` 复用最后一条真事件

只在尾巴上追加，不插入中间。

### 2.6 重编码

1. 再跑一遍展开 + seq 连续检查，失败则拒绝 `--apply`
2. 写 header 帧
3. 其余事件按批打成 zstd 帧（week 1 可以「每 N 条一帧」；不必复刻 200ms 窗口）
4. 原子替换：写 `session.jsonl.zstd.tmp` → fsync（Windows 上只读句柄的 `EPERM` 视为 best-effort，不中止 `--apply`）→ rename

---

## 3. compact / export（不是 repair）

- `compact --keep-last-turns N`：丢掉前面的 turn，保留最近 N 个完整 turn（**不是**收成摘要 —— 摘要要走 `compaction/*`，本工具不插）。产出必须仍是合法 session 文件。seq 不连续 / 官方会拒读时 refuse，不要在第二个写者还活着时重排 seq。先停写者、先 repair。
- 切片必须整体重编号，released fold 是逐条比对的：`turn/start` 必须带**下一个** turn 号、`step/start` 必须带该 turn 的**下一个** step 号（`Relationships.accept` 的 `turn/start does not open the expected turn` / `step/start does not match the open turn and next step`），所以 turn/step 都从 1 重排，`assistant/message` / `tool/call` / `tool/result` 的 `data.turn`/`data.step` 跟着改。
- 按 seq 指向别的事件的成员要跟着平移 `-from`（实测清单：事件级的 `surfaceOp`（`{op:"replace",startSeq,endSeq}`）、`sourceEventSeqs`；`data` 里的 `shadowedSeqs`、`shadowedRange`、`headerSeq`、`messageSeqs`、`throughSeq`（delivery）、`sourceEventSeq`（command/done）、`protectedHead`）。指到被丢掉的事件时没有唯一答案 → refuse（保留原文件）。
- 有继承前缀（`isSeeded` 或 v0/v1 的 `seedLength > 0`）时 refuse：丢掉前缀没有定义好的语义。
- header 原样保留：`seedLength` 是 v0/v1 字段，v2+ 的 header 闸门只认 `version/id/createdAt/isSeeded/delegationDepth`（可选 `cwd/parentSession/origin/agentPreset`），**不许**出现 `seedLength`（早先的 compact 就是在这里写出过加载器拒读的文件）。
- `export --redact`：默认剥 `sk-*`、PEM、绝对 home 路径；`--no-redact` 必须显式。

#317 那种「文件合法但大到加载爆栈」，走 compact，不要在 repair 里静默丢历史。

---

## 3b. 关系折叠的拒读形状（已实现，只报告）

用「假阴性扫描」量出来的（把一份真实 4376 事件 v4 会话逐条做语义变异，再逐条比对发布包的折叠判定）：**下面这些变异官方折叠会拒读，而我们当时仍报 `ok`** —— 假阴性比崩溃更隐蔽，用户会以为文件没问题。现在 `src/pairing.mjs` 覆盖这一族，两个健康码：

- `turn-step-mismatch` —— turn/step 编号不再续上 walker 的状态机
- `tool-result-invalid` —— `tool/result` 的身份（`toolCallId` / `surfaceOp`）不成立

| 变异 | 官方折叠 | 健康码 |
|---|---|---|
| `turn/start.data.turn + 1` | `turn/start does not open the expected turn` | `turn-step-mismatch` |
| `step/start.data.step + 1` / `data.turn + 1` | `step/start does not match the open turn and next step` | `turn-step-mismatch` |
| `assistant/message.data.turn + 1` | `assistant/message does not match an open turn and step` | `turn-step-mismatch` |
| `turn/end.data.turn + 1` | `turn/end does not match the open turn with no open step` | `turn-step-mismatch` |
| `tool/result.message.toolCallId` 改掉 | `tool/result other-id has no advertised tool lifecycle` | `tool-result-invalid` |
| `tool/result.message.toolCallId` 删掉 | `tool call id requires a nonempty string` | `tool-result-invalid` |
| `tool/result.surfaceOp` 删掉 | `tool/result surfaceOp requires an object` | `tool-result-invalid` |

判据是**照抄 walker 的状态机**（`nextTurn`/`nextStep` 都从 1 起；`turn/start` 必须开出预期回合；`step/start` 必须是开着回合的下一步；每个 step 事件必须带开着的那一对；`turn/end` 必须对上开着、且没有开着 step 的回合；`tool/result` 必须点名日志通告过的调用，且 `message.toolCallId === message.source.callId`）。v0→v1 阶段与 v4 读盘折叠用的是同一套规则，所以两条 walker 的判据一致。两条边界：

- **只对 v4 工件判定**。旧代际会先被各自的迁移阶段**归一化**再校验：实测一份真实 v3 会话里 `tool/result` 的调用 id 在 `content[0].toolCallId`、`message.role` 是 `user`，v3→v4 阶段会把它抬进 `message.toolCallId`；按 v4 规则直接判原始 v3 行会报出加载器根本看不到的违例 —— 本模块第一版就这么误报过一条真实会话，是真实库回归扫出来的，不是单测。
- **不重复报 #7824 的形状**：继续一个已关闭回合的行留给 `step-after-turn-end`，`turn/end` 跨开着 step 留给 `turn-end-while-step-open`；两个新码的优先级排在它们前面，因为编号错位才是根因，级联出来的形状不该抢徽标。

每一条在工件里都**没有唯一修复答案**（中途的 turn 重编号是 `compact` 在切片边界做的事 —— 那里"切点"定义了答案；这里意图不可知；`tool/result` 答的是哪个调用，一旦错了也恢复不出来），所以只报告，repair 不动文件。

### 第二族：surface 替换链（`surface-replacement-invalid`）

同一份扫描换一族再跑，命中在**一份真实会话的 44 条 `tool/result` 替换**上：

| 变异 | v4 折叠 | seed 构造 |
|---|---|---|
| `surfaceOp.startSeq` 移出 surface | `tool/result replacement range is not on the current surface` | `surface replace: start seq <n> not found in surface` |
| `surfaceOp.endSeq` 移出 surface | 同上 | 同上 |
| `sourceEventSeqs` 不再列出被遮蔽的行 | `replacement sourceEventSeqs omit a shadowed surface node` | `sourceEventSeqs must not be empty` |
| `sourceEventSeqs` 整个删掉 | `replacement sourceEventSeqs requires an array` | 同一句 |

判据照抄 `foldSurface`：`surfaceOp: "append"` 推入 surface；否则 `surfaceOp` 必须是对象、`startSeq`/`endSeq` 必须是**早于本行**且**当前就在 surface 上**的坐标、`sourceEventSeqs` 必须恰好列出被遮蔽的那些行、不能遮蔽受保护的 system 头（`system/message` 在 surface 非空而 `protectedHead` 为空时单独拒）。

**走查在第一条违例处停下**（`surfaceHits` 返回单元素数组）：折叠本身在那里 abort，后面的下标全部失去意义，继续走只会造级联命中 —— 这一条与另外两个走查器不同，是刻意的。

两条**从 seed 闸门学到的**、文档里没有的规则（搭 fixture 时被逐条拒出来的）：

- 遮蔽 surface 的替换行是 **`tool/result`** —— `assistant/message` 会被拒：`assistant/message embeds its source stream and cannot carry sourceEventSeqs`（真实库里 44 条替换也全是 `tool/result`）。
- 替换行 **只能改 content**：`tool/result surface replacement may change only content`，message 的 `id` 必须与被遮蔽的那行一致（技能文档里记过这条，这是它在 seed 侧的第二次现形）。

只报告：`startSeq`/`endSeq` 一旦指不动了，它本来想遮蔽哪一段在工件里恢复不出来；`sourceEventSeqs` 是对 surface 的断言，surface 自己无法证实它。

### 第三族：**故意不报**的流比对（2026-10-14 实测，别再追）

同一份扫描的下一族探到三处 `assistant/message` 变异 —— `data.stream` 截短、`data.message.content` 改文本、`data.usage` 改数字 —— 官方有一道闸门专门拒它们：

```
seed assistant/message at index N content disagrees with its embedded stream
seed assistant/message at index N usage disagrees with its embedded stream
seed assistant/message at index N replay state disagrees with its embedded stream
```

（`dsh-session-persistence-jsonl` 的 `assertCurrentAssistantStreams`：对每条 `assistant/message`/`assistant/attempt` 用 `BlockAssembler` 重放 `data.stream`，再与 `message.content`/`usage`/`message.source.replayState` 深比；`timed.length === 0` 时 `continue` —— 这就是「`stream: []` 两道闸门都收」的来源。）

**但它在打开一份已存会话时不跑。** 唯一调用点在 `verifyCurrentGeneration` 里，而那个函数只被 `verifyCurrentFile` 用，`verifyCurrentFile` 的两个调用点（`:2079` / `:2102`）都在**迁移/发布**流程里（`sourcePath`/`staged`/`expectedPrefix`）；worker.cjs 里同一函数的注释写得更直白：*"Fully replay embedded streams only inside isolated current-generation verification"*。普通打开走的是 `readStoredLog` → 关系折叠 + `Session.fromRestore`，**两者都接受**上面三种变异（本轮逐条实测）。

所以**报它们就是假阳性**：这三行不进探测器，不进 `HEALTH_RANK`。只有当一个文件要**被迁移**（代际提升）时那道闸门才会碰它 —— 那时它是迁移前置校验的事，不是「这份日志打不开」的事。同样处理的还有 `tool/result.message.content` 里塞进 released `tool-result` wrapper：关系折叠与 seed 都接受，不进探测器。

**教训**：判「某变异官方拒读」之前，先确认**哪条路径会跑那道闸门**。同一个包里有两套校验（打开 vs 迁移），只有打开路径的拒绝才属于本工具的合同。

### 第四族：PTC 子调用身份（`ptc-dispatch-invalid`）

`run_code` 的子调用 id 是 `<父 callId>:ptc:<n>`，**两半都能在同一会话里重复**：provider 在助手重复一次调用时重发父 id，`n` 每次 `execute()` 从 1 重来。子调用活过它所在的 step（轮询后台任务最典型）就正好凑出这个形状 —— #9677 的真实 3569 事件会话因此永久打不开。

本机真实库里有**一对**真实 dispatch（`session-e1c86df5`：`tool/ptc-dispatch-start` + `tool/ptc-dispatch`），拿它做变异：

| 变异 | v4 折叠 | seed 构造 | 健康码 |
|---|---|---|---|
| 第二条 start 重复已结算的 `subCallId` | 同族拒（本机这份先撞 `PTC dispatch changes its rootCallId`） | **accept** | `ptc-dispatch-invalid` |
| dispatch 复用已结算的 id | 同上 | **accept** | 同上 |
| dispatch 的 `name` 与 start 不同 | `PTC dispatch does not match its start` | **accept** | 同上 |
| `rootCallId` / `subCallId` 清空 | `PTC rootCallId requires a nonempty string` / `PTC subCallId …` | **accept** | 同上 |
| `parentCallId` 不属于 rootCallId | `PTC parentCallId does not belong to rootCallId` | **accept** | 同上 |

**注意 seed 那一列全是 accept** —— PTC 身份**只有关系折叠在查**，这是本文件里第一次出现这种分工（前三族都是两道闸门一起拒）。折叠正是打开一份已存日志时跑的那道闸门，所以拒读依然成立；但**别拿 `Session.fromRestore` 当判据**。

判据照抄 `dispatch()`：`requireTurn`；三个 id 必须是非空字符串；已知 id 的 `rootCallId` 不能变；`parentCallId` 必须属于 root；start 不能重复；dispatch 必须有自己的 start（且未结算），并且 `rootCallId`/`parentCallId`/`name`/`arguments` 与 start 逐项深比相同（用官方的 `isDeepStrictEqual`）。

**走查在第一条违例处停下**，与 surface 同因。

**可修的子集：重复的 subCallId（2026-10-16 实现为 `repairPtcSubCallIds`）。** 这一族里只有「重复」这一种在工件里还留着答案 —— 错的只有**键**。改法是把**后一次**出现（它自己的 `tool/ptc-dispatch-start`，加上它到「下一个同名 start」之间所有点名该 id 的行）改名，**第一次的 id 绝不动**：那个 id 可能已经被某个子调度写进 `parentCallId`，必须继续解析得到。这个方案来自 `argszero` 在 #9677 里指出的 `@argszero/dsh-ptc-subcall-guard`（它在交给会话工厂的 seed 上做同一件事）；我们把它落到**磁盘上的文件**，所以对每一个读端都生效，而不只是跑过那个守卫的进程。新 id = 旧 id + 最小的空闲 `::r<k>` 后缀，**空闲**指全文件范围内既没被用作 `subCallId` 也没被用作 `parentCallId`。

实测（真实 4376 事件会话，带一对 dispatch）：造出 #9677 形状后折叠报 `PTC dispatch repeats subCallId`、seed 放行；改名后**两道闸门都接受**、`health=ok`、再跑 `planRepair` 不再写（幂等），**4376 行里只动了 2 行**。健康会话 `mustWrite=false`。除重复以外的行（`name` 与 start 不符、`rootCallId` 清空、`parentCallId` 不属于 root）仍然 refuse —— 改完必须重跑 `ptcHits`，仍不干净就整体 refuse，不允许用改名去遮一个「因为它坏」的行。

**加探测器时先跑扫描**：新探测器一上线就用同一份变异矩阵回归，别只写单测 —— `producer-source-invalid` 就是因为两个测试都直接调探测器函数、没走 `decode.mjs` 的接线，才带着一个永远为假的闸门发布出去（`scanner.finish()` 不返回 `header`）。这一轮同一份扫描又抓到了上面那条 v3 误报，而它在两个「有 runtime」的环境里都测不出来。

---

## 4. 验收

合成 fixture（`fixtures/synthetic/`，week 1 补齐）：

| 文件 | 期望 |
|---|---|
| `torn-tail.session.jsonl.zstd` | dry-run 报 torn-tail；apply 后 load 成功，有合成 turn/end |
| `zero-fill-tail.session.jsonl.zstd` | 官方形状的扫描器在已提交长度处拒读（复现缺陷）；inspect 报 `zero-fill-tail` 且读到全部已提交事件；apply 后丢零区、事件逐条不变 |
| `seq-gap-committed.session.jsonl.zstd` | 停在 gap 前最后一个 turn/end；之后的 turn 消失 |
| `lone-surrogate.session.jsonl.zstd` | 不再含孤立代理；header/seq 不变 |
| `orphan-tmp/` | scan 列出来，repair 不把它当正本 |
| 本机健康会话 `session-6b29…` | dry-run 0 处必须修改（允许提示 packed 已展开） |

对照测试（dev only）：同一输入上，我们的 closer 与官方 `interruptedTurnClosers` 逐条相等。

---

## 5. 明确不修

- 中间完整帧 checksum 失败（没有原文）
- 未来 format version
- header 缺 `delegationDepth` / 带退役字段（形状已经不是 v0）
- 用插件去改正在跑的 live writer（官方：一个 session 同时只能有一个 writer）
- 空 `callId` / 空 `tool_calls[].id`：不编假 id。根因是引擎出栈过滤（#5182）；inspect 只标位置
- 悬空 `tool/call`（step/turn 已闭合、`tool/result` 从未落盘）：`tool/result` 只能写在还开着的 step 里，事后追加会与日志自相矛盾；`fixtures/probes/dangling-tool-call.json` 实测了这条分叉（0.1.7-rc.1 与 0.1.7-rc.2 上一致）—— v0→v1 与 v3→v4 的 **migration stage 接受**，`restoreReleasedV2Artifact` / `restoreReleasedV4Artifact`（0.1.7 发布 v3→v4 迁移时会走）**以 `step/end leaves unresolved tool call` 拒读**，而**读一份已经是当前代际（v4）的已存日志同样拒收**（`SessionLogScanner.finish()` → `assertReleasedV4Relationships`，外面再包一层 `SessionPersistenceCorruptionError: stored log is corrupt`）。inspect 只报 `dangling-tool-call`，不补事件。**判据要按 step 边界收窄**：折叠只在 `step/end` 才要求配对（`assertNoUnresolvedTools(toolLifecycles, "step/end")`），所以「step 还开着、日志就到尾了」是普通崩溃形状 —— 引擎自己的 `interruptedTurnClosers()` 会在 resume 时写结果，实测一份 2970 事件的真实 v4 日志（尾部 step 未闭合 + 未配对调用）被桌面 0.2.0-rc.2 的验证器接受；只有「step 已闭合仍无结果」才是拒载那一类，空的 callId 则在 call 本身上就被拒（不受 step 状态影响）。上游同立场：`rejected/simplification/2026-06-20-truncate-interrupted-turns.md` 写明恢复功能应当做成显式的用户界面，而不是往正史里静默插入合成事件
- 已经是 v4 的日志里还留着退役的 `{kind:"plugin", plugin}` 消息来源（#7772）：v4 准入要求 **producer 自己的 kind**（`format v4 message requires a producer-owned source kind`），而 producer kind 是从包名推导的（改名表、固定 released 集合、`plugin:<pkg>` 兜底），对未知插件没有唯一答案。实测（0.1.7-rc.1）：同一行写成 `kind:"plugin:dsh-mnemon"` 时官方读盘通过，写成 `plugin` 包装时**整份日志在读盘路径被拒**（`stored log is corrupt: … requires a producer-owned source kind`）。**能修**（2026-10-07 更正：上一版说「没有唯一答案」是错的）：官方 v3→v4 stage 的 `producerKind(plugin, role)` 是**全函数** —— 改名表 `RENAMED_PRODUCERS`（compact→compact-checkpoint、tools-code-mode/tools-ptc→ptc-mode、dsh-compaction-basic→compact-basic、`@deepseek-ai/dsh-system-prompt`→runtime-context）、`RELEASED_SAME_NAME_PRODUCERS`（25 个同名字面量）、role 敏感特例（`@deepseek-ai/dsh-system-prompt` + role `system` → `system-prompt`）、兜底 `plugin:<name>`；这四段在 **0.1.7-rc.2 与桌面 0.2.0-rc.2 的包里逐字节相同**（md5 逐个比过）。注意这张改写表**只在 v3→v4 迁移里运行**（`rewriteV3MessageSource` 全包仅一个调用点，在 stage 的 `transformRun` 内）：**读盘路径不做改写** —— 读一份已经是 v4 的日志走 `assertReleasedV4Relationships` → `assertV4MessageSources` → `source()`，所以同一行写 `plugin:<pkg>` 能读、写 `plugin` 包装在读盘是硬拒；「先改写后校验」和「`plugin` 一律拒」两句都对，因为说的是两条路。另外各槽位「只认某种 kind」（system→`system-prompt`、assistant→`model`、tool/result→`tool`）由 `@deepseek-ai/dsh-session` 的 `assertMessageEventShape` **按事件类型**分派，与 `producerKind` 的 role 分支是两条规则，不要混为一谈。`rewritePluginSource` 也只改 `kind`、删 `plugin`、**保留其余成员**（#6559 里 `automationId`/`runId`/`scheduledFor` 就是这么留下来的）。所以 repair 照抄这个函数：inspect 报 `v4-literal-plugin-source`（仅当本文件 header 已是 v4；更低代际由 v3→v4 stage 自己改写），repair 写回官方推出的 kind；`plugin` 不是字符串的 source 不动（官方在那里抛）。覆盖槽位跟官方 `mapEventMessages` 对齐：`user/message`、**`developer/message`、`system/message`**、`assistant/message`、`tool/result`，以及 `agent/inbox/spliced.inserted` / `session/title-llm-request.messages`
- 回合已经 `turn/end`、同一回合的 step 事件还在继续（#7824）：官方关系校验在**转换后的工件**上重跑 v0→v1 的 `assertReleasedArtifactRelationships`（v1→v2 stage 调用它；v3→v4 的 walker 检查同一对），于是整份拒读 `assistant/message does not match an open turn and step`（step 起头的变体是 `step/start … does not match the open turn and next step`），外层由 orchestrator 包成 `refuses the transformed artifact`。`turn/end` 落在 step 还没 `step/end` 时是同一家族的另一种形状：`turn/end <n> crosses an open step`（写者侧 `dsh-session/lib/invariant.js` 同一条规则）。实测（0.1.7-rc.2 发布包）：健康对照通过，`turn/end` 之后再来 `assistant/message` 被 `restoreReleasedV2Artifact` 以报告者的原话拒读。合并这个回合 / 拆成两个回合在工件里没有唯一答案，拆分还要重编号后面所有 seq 与声明范围 —— inspect 只报 `step-after-turn-end` / `turn-end-while-step-open`，repair 不动文件
- 行还在、类型还在，但**释放版 v0 清单要求的成员没了**（截断/半写日志的典型样子，`v0-missing-member`）：`turn/end` 缺 `reason`、`assistant/message` 缺 `turn`/`step`/`message`/`message.content`、`user/message` 缺 `id`/`role`/`content`/`source`、`tool/call` 缺 `arguments`、`tool/result` 缺 message、`permission/preset` 缺 `preset`、`agent/inbox/spliced` 缺 `target`/`start`/`inserted`、`goal/change` 缺 `kind`/`version`/`operation`，以及整行没有 `data`。v0→v1 的 payload 闸门为**一行**就拒整条会话，报 `… lacks required member "reason"`。必需集是**对着发布包做消融实验**量出来的（逐个删成员，只有闸门拒删的才留下）—— 发布包自己还声明了一份清单（`RELEASED_V0_EVENT_DISPOSITIONS`，51 类，闸门泛化地按它校验），本表每一条都与它一致，但**声明不能直接拿来用**：它要求 `assistant/chunk` 必须有 `chunk`，而闸门对这类行**根本不校验**（缺 `chunk` 通过，连多一个未知成员也通过）。所以覆盖范围故意保持不全，块级成员也跳过（随块类型变化）。只在 v0 工件上检查（`fileVersion === 0`）—— 那条闸门本来就只对 v0 跑。成员内容在工件里恢复不出来 —— **只报告，不补**。本机 12 份日志 0 命中（含一份实测 v0 fixture 仍报 `ok`），新探测器在 140k 事件上约 4ms
- `subagent/descriptor` 的 `data.version` 不是 3（#7995 / #6151）：v0→v1 的 payload 闸门判 `!== 3` 就拒（`dsh-session-format-v0-to-v1/lib/index.js:1584` 判、`:1586` 抛，`literalValue(data["version"], [3])` 在 `:1290`；这条闸门在 **0.1.5-rc.3 与 0.1.7-rc.2 的发布包里逐行一致**，而写者只发 `version: 2`）。**爆炸半径不止一条会话**：persistence observer 把每条已存 v0 会话都喂进这条闸门，一个坏工件会让**所有** session-search 查询失败（`SESSION_QUERY_PERSISTENCE_FAILED`），所以先用 `index`（逐会话 health；`scan` 只读 header，看不到这类）整库枚举再修。修复只把 `data.version` 2→3（两版成员集相同，其余字段不动）：构造样本实测修前 `unsupported descriptor version 2`、修后 accepted
- `subagent/descriptor` 进不了子目录（#7995）：v3→v4 的 `historicalChildCatalogSource`（`:871`）把子会话自己的描述符交给 `childCatalogFact`（`:900`），后者是**唯一读 `mode` 的地方**——`provider` 不是字符串就拒；`version ≠ 1` 时 `mode ∉ {continuable, one-shot}` 就拒（`has an invalid subagent descriptor mode`）；再经 `catalogFact`（`:927`）要求**有效 mode 为 `continuable` 时 `label` 必须是字符串**（version 1 会被归一成 `continuable`，所以**每一行 version 1 都必须带 label**）；`label` 非字符串同样拒。判据不是读出来的，是**对着发布函数跑 12 组形状的矩阵**逐条对齐的（双方对同一批输入给出同一结论）。`mode` 是真实属性、`label` 是自由文本 —— **只报告，不补**。两条诚实的边界：只在 **v1–v3** 上检查（已是 v4 的日志不再走这条迁移），且只对**未继承前缀**的子代理子会话下判定 —— 目录按 `seq >= inheritedEventCount` 计数，而这个切点是运行时状态，盘上任何 header 都不带（`assertReleasedV4Header` 的允许集是 version/id/createdAt/isSeeded/delegationDepth/cwd/parentSession/origin/agentPreset）。只有一个方向是钉死的：`assertReleasedV2Artifact` 的 `if (!header.isSeeded && cut !== 0) throw` ⇒ **未继承 ⇒ 切点为 0**，整个文件就是计数范围；继承过的子会话**跳过而不是猜**
- `assistant/message` / `assistant/attempt` 的**结算字段**（`turn` / `step` / `stream`）不合法（#8084）：seed/restore 闸门 `assertAssistantSettlementShape`（`dsh-session` 构造 `Session` 时校验它拿到的事件，**读一份已存日志**也会经 `Session.fromRestore` 走到）要求 `turn`/`step` 是**非负安全整数**（`-0` 也算非法）且 `stream` 是**数组**，为一行就拒整条会话，报 `seed assistant/message at index 4002 has invalid settlement fields`。**实测而非读码**：取一份真实 v4 日志（3805 事件，`health: ok`）当 seed 构造 `Session` —— 原样通过；删掉某一行的 `stream`、或把 `stream` 设成 `null`、或把 `turn` 设成 `-0`、或删掉 `turn`，构造都**抛出报告者的原话**。写入侧 `Session.append` 只校验 `validateSessionEventData` + `surfaceManager.validateNext`，**不校验这三个字段**，所以坏行能静默落盘、要到下次加载才暴露（#8084 里 @Mide69 的定位）。`stream` 承载流式分块（实测健康行都是非空数组，5–26 项），分块本身已经丢了、补不回来 —— 但**这一行可以修**（上一版写「只报告」是错的，实测推翻了它）：`assertCurrentAssistantStreams`（persistence-jsonl `lib/index.js:1833`）把 `stream` 展开后，**只要展开为空就 `continue`**，在比对 `message.content` / `usage` / `message.source.replayState` 之前就跳过了，所以**空数组在两道闸门上都合法**；反过来，`stream` 被删或为 `null` 时两道闸门都拒（结算闸门抛 `invalid settlement fields`，展开器抛 `stream is not iterable`）。因此 `stream: []` 是唯一被接受的值，而它不丢任何**可恢复**的东西：正文在 `message.content` 里、原样不动，`usage` 与 replayState 也不动。`turn`/`step` 是另一回事，**根本不是猜**：日志本身就写明该 seq 处开着哪个 turn/step，而那正是这行所属的值，直接写进去；若该 seq 处什么都没开（行落在任何 turn 之外），就**不写**，报 `settlement-unresolved`。端到端验过而不是论证过：7 种坏形状（`stream` 删/`null`/字符串、`turn` 删/`-0`/小数、以及两者同时坏）在修前都被 `Session.fromRestore` 拒、修后都能构造；一份真实 v4 日志修完后能构造，其余 579 行 assistant 的 content 比对**全部照旧通过**。`-0` 那次是在健康行上改的，修完恢复的正是该行原本的值 —— 这是「推导出真值、而不只是推出一个合法值」的证据。报告会点明**哪一行、哪个成员**不合法，官方报错不带这层信息。**只在 v1 以上检查**：释放版 v0 的 `assistant/message` 根本不允许带 `stream`（v0→v1 的 payload 闸门把 `stream` 当 unexpected member 拒掉），v0 交给 `v0-missing-member`。本机 7 份真实日志（v3 + v4）0 命中，140k 事件上约 1.6ms
- **丢掉末尾整帧**看不见（#8010）：日志是独立 zstd 帧的拼接，末尾若干**整帧**丢失后，剩下的前缀每一帧校验都通过、seq 从 0 连续，官方读盘返回一个**更短但完全合法**的会话 —— 没有任何错误，一个被截短的记录与"本来就结束得早"的会话无法区分。surgeon 同样看不见：`torn-tail` 只在 EOF 落进帧中间时报（`scanZstdFrames` 返回 `tornStart`），**帧整帧没了就从未进过帧列表**（`decode.mjs` 的 `tornStart` 判据同源）。唯一在盘的见证是投影缓存（`<home>/storages/session_projcache/sessions/<id>.json` 的 `rows[*].seq` 水位；官方文档说明它只能落后、不能领先日志；**而且实践中它是侧边栏会话列表的权威** —— #9611：整份缓存缺失时桌面端显示「No sessions yet」，689 个会话的日志一份没少，把记录拷回去就恢复 → 对它**只读不删**），但**我们故意不对它下判定**，三条理由都是实测的：(1) 只有**当前代际**那份日志可比 —— 一个 session 目录可以同时留着旧代际的 `session.vN` 文件，拿错那份就是假违例（本机实测：同一会话 v3 文件 `lastSeq=22` < 缓存 23 看着像丢尾，而 v4 文件 `lastSeq=23` 正好相等）；(2) 缓存**落后是合法的**（本机 6 份当前代际日志：5 份精确相等、1 份落后 2），所以只能单向比较；(3) 任何**合法把日志改短**的路径都会让它误报 —— 本机 repair 的 `seq-gap-committed` 就是「截断到缺口前最后一个 `turn/end`」，刚修完的日志天然短于缓存水位。按合同（不下无法证明的判定）我们只报 `torn-tail` 这一类，整帧丢失**明确不报**：要判定它需要官方显式记录总数（#8010 的结论），不是离线能推出来的
