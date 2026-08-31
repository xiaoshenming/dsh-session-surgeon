# DSH session 磁盘格式（0.1.0-rc.6）

对照官方实现整理，不是猜测：

- `@deepseek-ai/dsh-session-persistence-jsonl`
- `@deepseek-ai/dsh-session`（`packChunkRuns` / `decodeStorageRecord` / `interruptedTurnClosers`）

本机实测根：`~/.dsh/sessions/--home-ming--/`。

---

## 1. 目录

```
<DSH_HOME>/sessions/                  # 默认 ~/.dsh/sessions
  --<normalized-cwd>--/               # projectKey(cwd)，有损
    <encodeSegment(sessionId)>/
      session.jsonl.zstd              # compression 默认 zstd
      session.jsonl                   # 仅 compression: none
```

规则：

- 一个 root 只允许一种编码。同目录出现另一种后缀，官方直接抛 encoding mismatch。
- 旧的扁平 `<project>/<id>.jsonl*` **拒载**，没有迁移。
- `list()` 只读 header 帧，不解析全文。
- session id 是未校验的 branded string，进路径前必须 `encodeSegment`（`~` → `~007E`，隔离 `../`）。
- cwd 分组是有损的：分隔符变 `-`，超长截断。不同 cwd 可能进同一个 project 目录，靠 session id 区分。

本机例子：

| 目录 | 含义 |
|---|---|
| `--home-ming--/session-6b29ed49-…` | 顶层，cwd=`/home/ming`，preset=standard |
| `--home-ming--/2a04844e-…` | 子代理，`parentSession` 指回 6b29，depth=1，preset=liangshen |

---

## 2. 物理层：独立 zstd 帧拼接

默认产物是 **标准 Zstandard 独立帧拼接**，不是「整文件一次 compress」。

1. **第 1 帧**：只装 header 那一行（含末尾 `\n`），带 checksum。listing 只解这一帧。
2. **之后每一帧**：一次 write-behind 追加批次（默认 200ms 合并窗口），同样 checksum。
3. Node 内置 `zlib.zstdCompress` / `zstdDecompressSync`，没有 level 旋钮。
4. 追加失败会把文件截回原来的字节长度。
5. 首次物化走临时文件 + POSIX `link()` 不覆盖发布（Windows 是 write-through rename）。

读的时候：

- 完整帧 checksum / 解压失败 = 整文件拒载。
- 最后一帧结构不完整 = torn tail：保留该帧里已经解出的完整 JSONL 行，从该帧起点截断，再把这些行和合成 closer 重新编码追加。
- 完整帧里面若夹着半截 JSONL 行 = 官方视为 corruption。

week 0 CLI 用 magic `28 B5 2F FD` 切帧。这和官方解码器等价到「独立帧」这一层；checksum 细节 week 1 再对齐官方 decoder。

---

## 3. 逻辑层：header + storage record

### Header（第 1 行，不可变）

```json
{
  "type": "session",
  "version": 0,
  "id": "session-6b29ed49-540f-4778-bdff-172942d8c879",
  "createdAt": 1786939415611,
  "cwd": "/home/ming",
  "parentSession": "…",
  "seedLength": 0,
  "origin": "subagent",
  "delegationDepth": 0,
  "agentPreset": "standard"
}
```

硬约束：

- `version` 必须是当前 `SESSION_FORMAT_VERSION`（现在是 0）。别的版本要报「升级 harness」，不要报「corrupt」。
- `delegationDepth` 必填，非负整数。缺了拒载。
- `origin` 只能缺省或 `"subagent"`。
- header 里如果出现已退役的 `sandboxMode` / `approvalPolicy`，拒载。
- `agentPreset` 必须保留：恢复时工具集得对得上，否则历史重放模型做不了原来的事。

### 之后每一行

要么是一条 `SessionEvent` 原文，要么是 packed chunk 行。

事件信封：`{ type, seq, time, data, … }`。  
解码展开后必须 `events[i].seq === i`（从 0 连续）。

本机顶层会话见过的 type（节选）：

`permission/preset` `sandbox/mode` `approval/policy` `session/end-seed` `agent-preset/selected` `agent/inbox/spliced` `turn/start` `turn/end` `step/start` `step/end` `user/message` `assistant/chunk` `assistant/message` `tool/call` `tool/result` `tool/code-dispatch` `goal/change` `todo/write` `compaction/prune` `session/title` `request/header` `request/context` `team/member` `team/task` `team/message/queued` `team/message/delivered`

子代理另外有 `subagent/descriptor`。

未知 type：官方 persistence 若该事件没有 `ignorable` 标记会拒载（防止新版本日志被旧 harness 静默读残）。surgeon 诊断时要单独标 `unknown-type`，修复时默认保留，不要删。

---

## 4. Packed 行（不是事件）

连续 ≥3 条同块 `assistant/chunk` delta 会收成一行，大约能把逻辑日志缩小 60%。

| type | 锚点 | payload |
|---|---|---|
| `text-chunks` | `seq0` `time0` | `data.texts[]` + `dt[]` + turn/step/index |
| `reasoning-chunks` | 同上 | 同上 |
| `tool-call-chunks` | 同上 | `data.id` + `args[]` + 可选统一 `name` |

展开规则：成员 `k` 的 seq = `seq0 + k`，time = `time0 + sum(dt[0..k))`。`dt` 允许负数（挂钟回拨）。

这些 tag **没有斜杠**，故意不进 `SessionEventMap`。读的时候必须先 `decodeStorageRecord`，再看 seq。week 0 inspect 把 packed 行当「表面跳号」是误报，week 1 必须展开。

畸形 packed 行要响亮失败，不能当成普通事件——否则整段 token 会丢。

---

## 5. 官方 loader 何时说 corrupt

来自 `SessionLogScanner.consumeEventLine`：

1. 某一行 `JSON.parse` / `decodeStorageRecord` 失败 → `unparsable committed event at line N`
2. 展开后 `event.seq !== events.length` → `seq gap in committed region (expected X, got Y)`，并且回滚这一行已经 push 的事件
3. 上述 issue 产生之后，如果同一行或后续行里出现 `turn/end` → **立刻 throw**。意思是：最后一个已提交 turn 之前的缺陷不可恢复
4. issue 之后如果再也没有 `turn/end`，官方只保留 committed prefix，尾巴当 torn 处理

所以「表面 seq 跳号」有两种完全不同的情况：

- packed 行：健康
- 崩溃重放把旧 seq 再写一遍，或中间缺号且后面还有 `turn/end`：这才是 #1497 / #1586

---

## 6. 官方自己会修什么，不会修什么

官方 `load` / `commitRepair` 只处理 **torn tail**：

1. 截断到最后一个完整帧
2. 把该不完整帧里解出的完整事件写回去
3. 追加 `interruptedTurnClosers()`：先给未完成 tool 合成错误结果（`TOOL_NOT_STARTED` / `TOOL_OUTCOME_UNKNOWN`），再 `step/end`，再 `turn/end`（reason=interrupted）。seq 接着日志走，时间戳复用最后一条真事件

官方 **不会**：

- 修 committed region 里的 seq gap（有 `turn/end` 就整段拒载）
- 剥孤立 UTF-16 代理码元（#436，永久 HTTP 400）
- 收拾孤儿 `.tmp`
- 把 20 万 token 的历史切成可加载段（#317 家族）
- 救已经写坏、被拒载的文件

这就是 surgeon 的地盘。详见 [REPAIR-SPEC.md](./REPAIR-SPEC.md)。

---

## 7. 和 goal / 任务 ID

goal 不是独立文件。它是同一条 JSONL 里的 `goal/change` 事件。  
session id 才是 resume 句柄。详见 [LEARNING-TASKS.md](./LEARNING-TASKS.md)。
