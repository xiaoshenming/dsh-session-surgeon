# 修复规格（对齐官方 loader）

目标：`repair --apply` 之后的文件，必须能被 `@deepseek-ai/dsh-session-persistence-jsonl@0.1.0-rc.6` 的 `load()` 接受，并且重放后 turn/step/tool 闭合。

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
| `failed-middle-frame` | 中间完整帧解压失败 | 整文件拒载 | 不自动修；报告帧号 |
| `unparsable-line` | 某行不是 JSON / packed 行畸形 | 若之后有 turn/end → 拒载 | 丢掉该行及之后，或停在上一 turn/end |
| `seq-gap-committed` | 展开后 seq 不连续，且之后有 turn/end | **拒载**（#1497/#1586） | 主修复路径；若能证明是崩溃恢复闭包 vs 还活着的写者，丢掉闭包、保留 live 分支 |
| `packed-overlap-suffix` | packed 行从已提交 seq 往回重叠、后缀连续且前缀与已提交事件一致 | **拒载**（#5151） | 丢掉已提交前缀成员，收下尚未提交的后缀 |
| `newer-format-ranges` | `sourceEventSeqs` 含 `[start,end]` 区间（Alpha #3048，version 仍为 0） | 当前 rc.2 `foldSurface` 拒载（#5160）；npm 上没有可升级版本 | **展开**成包含端点的密集整数；不发明区间外的 seq |
| `forward-event-shim` | Alpha `model/selection` 降级后 rc.2 不认识 | `SessionFormatUnsupportedError` | 仅在官方结构校验通过时加 `ignorable: true`；保留 type/data/seq/time |
| `seq-overlap-replay` | 同一 seq 出现两次（崩溃重放） | 表现为 gap/overlap | 保留先写的，丢掉重放尾 |
| `lone-surrogate` | 用户文本含孤立 UTF-16 代理 | 可能永久 HTTP 400（#436） | 剥掉或替换 U+FFFD |
| `orphan-tmp` | 旁边有 `.tmp` | 不管 | 列出；不自动当正本 |
| `open-tail` | 缺 tool/step/turn 闭合，但 seq 连续 | 官方补 closer | 复用同一语义 |
| `huge-history` | 事件/token 过多 | 加载 stack overflow（#317） | compact / 切片，不叫 repair |
| `empty-tool-call-id` | `assistant/message` 的 `tool-call` 或 `tool/call` 的 id 为空（#5182） | 文件能打开，下次模型请求永久 400 | inspect 定位；**不编** callId |
| `unknown-type` | type 不在本 build 词表且无 ignorable | 可能拒载 | 保留，标出来 |
| `packed-surface-skip` | 没展开 packed 行看到的假跳号 | 健康 | inspect 必须先展开 |

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

扫描 `user/message` / 文本类 payload 的字符串：

- 孤立高代理或低代理 → 替换为 `U+FFFD`（或删除，二选一，默认替换）
- 只动字符串内容，不动 seq / type
- 修完必须还能 JSON.stringify 并被官方 parse

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

- `compact --keep-last-turns N`：前面的 turn 收成摘要，保留最近 N 个完整 turn。产出必须仍是合法 session 文件。seq 不连续 / 官方会拒读时 refuse，不要在第二个写者还活着时重排 seq。先停写者、先 repair。
- 切片：每个切片自己有 header，seq 从 0 重排，`seedLength` / `parentSession` 视情况填写。
- `export --redact`：默认剥 `sk-*`、PEM、绝对 home 路径；`--no-redact` 必须显式。

#317 那种「文件合法但大到加载爆栈」，走 compact，不要在 repair 里静默丢历史。

---

## 4. 验收

合成 fixture（`fixtures/synthetic/`，week 1 补齐）：

| 文件 | 期望 |
|---|---|
| `torn-tail.session.jsonl.zstd` | dry-run 报 torn-tail；apply 后 load 成功，有合成 turn/end |
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
