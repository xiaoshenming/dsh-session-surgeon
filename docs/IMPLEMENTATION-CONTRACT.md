# dsh-session-surgeon 实现合同（多智能体共享）

仓库：`/home/ming/data/Project/DSHProject/dsh-session-surgeon`
兼容：`@deepseek-ai/dsh@0.1.0-rc.6`
对照源码（只读，禁止复制进 dependencies）：
- `/home/ming/.nvm/versions/node/v22.19.0/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-session/lib/types/chunk-rows.js`
- `/home/ming/.nvm/versions/node/v22.19.0/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-session/lib/types/repair.js`
- `/home/ming/.nvm/versions/node/v22.19.0/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-session/lib/types/known-event-types.js`
- `/home/ming/.nvm/versions/node/v22.19.0/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-session-persistence-jsonl/lib/index.js`（scanZstdFrames / SessionLogScanner）

## 硬约束

1. ESM only（`"type":"module"`），Node `^22.19.0 || >=24`。
2. **零 runtime dependencies**。`@deepseek-ai/*` 只允许出现在 peerDependencies / optional 注释，禁止放进 dependencies。
3. 单文件 ≤300 行；已有文件 >200 行先拆再加功能。
4. 默认只读。写路径必须 `--apply`，先写 `session.jsonl.zstd.bak.<utc>`。
5. 禁止把 `~/.dsh/sessions` 原文提交进 git。
6. 测试用 Node 内置 `node:test` + `node:assert/strict`，不要加 vitest/jest。
7. 不要改官方 dsh 源码。插件热插拔。
8. 用 `write`/`edit` 工具写文件，不要用 cat/heredoc 覆盖大文件。
9. 只写自己被分配的文件。不要改别人的文件。
10. 所有用户可见字符串：中英均可，CLI help 中英各一行。

## 文件所有权（禁止越界）

| 文件 | owner |
|---|---|
| `src/zstd-frames.mjs` | zstd |
| `src/header.mjs` | header |
| `src/packed.mjs` | packed |
| `src/known-types.mjs` | packed |
| `src/closers.mjs` | closers |
| `src/decode.mjs` | decode |
| `src/scanner.mjs` | decode |
| `src/encode.mjs` | encode |
| `src/scan.mjs` | scan |
| `src/inspect.mjs` | inspect |
| `src/repair.mjs` | repair |
| `src/compact.mjs` | compact |
| `src/redact.mjs` | export |
| `src/export.mjs` | export |
| `src/format.mjs` | cli |
| `src/find.mjs` | scan |
| `bin/dsh-session-surgeon.mjs` | cli |
| `plugin/index.mjs` | plugin-host |
| `plugin/client.mjs` | plugin-client |
| `plugin/settings-card.mjs` | plugin-client |
| `cordis.patch.yml` | plugin-host |
| `package.json` | cli（可加 scripts / dsh / files / exports；不要加 dependencies） |
| `fixtures/synthetic/build.mjs` | fixtures |
| `fixtures/synthetic/*.session.jsonl.zstd` | fixtures |
| `fixtures/synthetic/orphan-tmp/**` | fixtures |
| `test/*.test.mjs` | 对应 tester |
| `.github/workflows/ci.yml` | fixtures |

现有 `src/zstd-frames.mjs` / `src/scan.mjs` / `bin/dsh-session-surgeon.mjs` 由对应 owner **整文件重写**（先 read 再 write）。

## 语义（必须对齐官方，不是猜测）

### Zstd

- Magic LE uint32 = `4247762216`（字节 `28 B5 2F FD`）。
- `scanZstdFrames(buf)` 必须按官方结构扫描：descriptor、content size、dict、blocks、checksum。
- 中间帧 magic 非法 / reserved bit / reserved block type → throw。
- 最后一帧结构不完整 → `{ frames, tornStart }`，不要 throw。
- 完整帧用 `zstdDecompressSync`；失败 = 该帧 corrupt。
- torn 前缀用 `zstdDecompress` + `finishFlush: zlib.constants.ZSTD_e_flush` 尽量救出完整 JSONL 行。
- 写回：`zstdCompress` + `params: { [ZSTD_c_checksumFlag]: 1 }`。

### Header

`isHeaderLine`：
- object, `type==="session"`
- `version` number, `id` string, `createdAt` 非负安全整数（拒绝 -0）
- `delegationDepth` 非负安全整数（拒绝 -0）
- `origin` 缺省或 `"subagent"`
- `agentPreset` 缺省或 string
- 有 `sandboxMode` / `approvalPolicy` → 当作退役字段，拒载

`version !== 0` → `foreign-version`，不修，提示升级。

### Packed

移植官方 `decodeStorageRecord` / `packChunkRuns`：
- tags: `text-chunks` / `reasoning-chunks` / `tool-call-chunks`
- 精确 key 集合，畸形行 **必须 throw**（不能当普通事件）
- `MIN_RUN = 3`
- 展开：`seq = seq0+k`，`time = time0 + sum(dt[0..k))`

### 扫描器（decode）

对齐 `SessionLogScanner.consumeEventLine`：
1. JSON.parse / decodeStorageRecord 失败 → issue `unparsable-line`
2. 展开后 `event.seq !== events.length`：回滚本行已 push 的事件。本行或后续行出现 `turn/end` → issue `seq-gap-committed`；否则 issue `seq-gap-tail`
3. issue 之后若出现 `turn/end` → committed 缺陷，记录并停止接受（tail 升级为 committed）
4. issue 之后再无 `turn/end` → 只保留 committed prefix，尾巴当脏尾
5. 未知 type（不在 KNOWN 且无 `ignorable`）→ 标 `unknown-type`，**保留**

### Closers

对齐 `interruptedTurnClosers`：
- 扫 openTurn / openStep / pendingCalls
- assistant/message 的 tool-call block 登记 pending
- tool/call 补 callSeq
- tool/result 删除 pending
- 对每个 pending：合成 tool/result（started → TOOL_OUTCOME_UNKNOWN，否则 TOOL_NOT_STARTED）
- 再 step/end（若 open），再 turn/end reason=interrupted
- seq 从 last.seq+1，time 复用 last.time
- 合成 message：role=user, source.kind=tool, 一个 tool-result block

### Repair 顺序（每步可关，默认全开）

1. torn-tail：保留不完整帧里已解出的完整行
2. seq-overlap：后写 seq ≤ lastAccepted → 丢掉从这条起的尾巴
3. seq-gap-committed：回退到 gap 前最后一个 turn/end（含）
4. 若 gap 后没有 turn/end：丢掉 i 及之后，走 closer
5. lone-surrogate：字符串里孤立代理 → U+FFFD
6. 合成 closer
7. 重跑 decode，seq 必须连续，否则拒绝 --apply
8. header 解不出 → 只报告不写
9. 中间完整帧解压失败 → 不自动修，报告帧号

### Compact

- `--keep-last-turns N`（N≥1）
- v0.1 走更稳妥路径：前面完整 turn 整段删除，从保留的第一个 turn/start 起重排 seq 从 0，`header.seedLength = 0`。不插入 `compaction/summary`
- 中间坏帧 / header 非 header-ok 时 refuse
- 产出必须是合法独立 session 文件（自己的 header + 连续 seq）

### Export

- 默认 redact：`sk-[A-Za-z0-9]{10,}`、PEM 头、`/home/<user>` 换成 `~ `
- `--no-redact` 必须显式
- 输出 JSONL 文本到 stdout 或 `--out`

### CLI

```
dsh-session-surgeon scan [root] [--format json|text]
dsh-session-surgeon inspect <id> [root] [--format json|text]
dsh-session-surgeon repair <id> [root] [--dry-run|--apply] [--format json|text]
dsh-session-surgeon compact <id> [root] --keep-last-turns N [--dry-run|--apply]
dsh-session-surgeon export <id> [root] [--no-redact] [--out file]
dsh-session-surgeon index [root] [--format json|text]
```

- repair 默认 dry-run
- `index` = scan + parent/depth/preset/turns/goal/health 表
- 退出码：成功 0，用法错 2，找不到/不可修 1

### 插件

形态对齐 `@linxin666/dsh-live-stats` / `dsh-ssh`：
- `package.json` 增加：
  ```json
  "exports": { ".": "./plugin/index.mjs", "./client": "./plugin/client.mjs", "./package.json": "./package.json" },
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" }, "client": { "inject": ["@deepseek-ai/dsh-client-runtime","@deepseek-ai/dsh-client-ui-settings"], "platform": "web" } }
  ```
- `cordis.patch.yml`：
  ```yaml
  - insert:
      - id: session-surgeon
        name: dsh-session-surgeon
  ```
- host：`defineTool` 注册 `session_scan` / `session_inspect` / `session_repair`（repair 默认 dryRun=true，apply 必须显式）
- `@deepseek-ai/dsh-tools` 只放 peerDependencies
- 若 host 环境没有 defineTool（单元测试），plugin 仍应能被 import（把 defineTool 包在 try 或延迟注册）
- client：settings.plugins.tab 只放 CLI / 工具说明（v0.1 不拉实时健康列表）；**不要**抢 aionui details 右栏，不要 DOM 补丁
- 插件不监听端口、不改 profile、不访问网络

### 测试黄金样例

| fixture | 期望 |
|---|---|
| torn-tail | inspect 报 torn-tail；repair --apply 后 decode seq 连续且有合成 turn/end |
| seq-gap-committed | 停在 gap 前最后一个 turn/end |
| seq-gap-tail | 保留空洞前连续前缀，不截到上一 turn/end |
| lone-surrogate | 不再含孤立代理；seq 不变 |
| orphan-tmp | scan 列出来，repair 不把它当正本 |
| healthy packed | inspect 展开后 seq 连续，dry-run 0 处必须修改 |

对照：同一事件数组上，我们的 closer 与官方 `interruptedTurnClosers` 逐条 type/seq/data.reason 相等（官方包可动态 import 作对照，失败则跳过对照、不 fail CI）。

### package.json scripts

```
"test": "node --test test/*.test.mjs",
"scan": "node bin/dsh-session-surgeon.mjs scan",
"inspect": "node bin/dsh-session-surgeon.mjs inspect",
"build-fixtures": "node fixtures/synthetic/build.mjs"
```

不要加 dependencies 字段。
