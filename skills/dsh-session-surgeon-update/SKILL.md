---
name: dsh-session-surgeon-update
description: |
  Self-iterate dsh-session-surgeon from community feedback. Use immediately when the user says 更新, 更新插件, 更新一下插件, 自我迭代, 逛逛社区, 再看看社区, 查社区然后更新, 补扫社区, 看多一点, update the plugin, absorb community feedback, or asks you to scan DeepSeek Harness discussions and update this plugin without spelling out the steps — including "我半个月没看了" style backlog sweeps where the scan has to cover every mention since a given date. Also use when they want you to reply on relevant threads, changelog, and push to origin/main. Do not use for repairing a specific local session file, copying a session ID, or unrelated DSH bugs (sandbox, models, Feishu).
---

# 更新插件 — dsh-session-surgeon 自我迭代

加载方式：DSH 技能目录里有就直接 `skill`；没列出（或报 unknown）就让 agent 直接 `read skills/dsh-session-surgeon-update/SKILL.md` —— 本仓库的更新流程就是这么跑通的，纯 markdown，不需要注册。

用户只说「更新」或「更新插件」时，不要再问流程。加载本技能后直接执行：扫社区 → 判断该不该改代码 → 改 / 测 / 写 CHANGELOG → 对口回复 → 用 px 推 `origin/main` → 用中文汇报。

仓库：当前 checkout（本机 `/Users/ming/data/project/dsh/dsh-session-surgeon`；技能里出现的 `/home/ming/...` 是旧机器路径，不要照抄）
远程：`xiaoshenming/dsh-session-surgeon` `main`
安装：`dsh plugin --profile web add "github:xiaoshenming/dsh-session-surgeon#main"`

默认简体中文。危险操作用 `danger-full-access`。PTC 模式只从 `run_code` 调工具。

## 触发词（任一即跑整条，不必用户再解释）

更新 / 更新一下 / 更新插件 / 更新一下插件 / 自我迭代 / 逛逛社区 / 再看看社区 / 补扫社区 / 看多一点 / 查社区然后更新 / update the plugin / absorb community feedback

用户说「半个月没看了 / 很多人 @ 我」时＝**加宽扫描**：通知 `all=true` 全量、Discussions 三个关键词搜索 + 按更新时间近 30 天、npm 版本线，全部跑一遍。

## 合同（不可破）

修磁盘上官方 loader 拒读的 `session.jsonl.zstd`。默认 dry-run；`--apply` 先 `.bak.<utc>`。

**永不：**

- 发明缺失 seq、空 callId、假 `tool/result`
- 给未知插件事件盖 `ignorable`
- 发明区间外的 seq（`[start,end]` 展开成包含端点的密集整数是允许的，因为这些序号已经在磁盘上）
- 在认不出签名时任意双写选边
- 上传真实 `~/.dsh/sessions`
- 把 `@deepseek-ai/*` 打进 runtime dependencies
- 刷屏式硬广；只回真正对口、尚未说过的帖
- 改官方 React 菜单；只 DOM 注入
- 把 TUI Admission / dsh-ecosystem-spec 当成官方 web 插件 ABI

**营销主路径**仍是会话 ⋯ → 复制会话 ID；repair 是第二条。

## 工作流（按序，不要跳）

### 0. 先看仓库自身状态（30 秒）

```bash
git -C <checkout> status --short && git log --oneline -3
gh run list -R xiaoshenming/dsh-session-surgeon -L 3     # 上次 CI 是否绿
```

工作区可能带着用户自己的未提交改动（本轮就是 dev 依赖 pin + README 本地开发段）：**不要 `git add -A` 一把混进功能 commit**。先 `git diff --stat` 看清哪些是自己的，用户的单独提一个 commit（必要时用 `git apply --cached` 按 hunk 拆）。CI 上次如果是红的，先弄清是不是自己上一轮造成的。

### 1. 目标

若当前会话还没有同一目标，`create_goal`：扫社区、吸收对口反馈、必要时代码+测试+CHANGELOG、回复、px 推送。不要为闲聊建目标。

### 2. 扫社区（先读，再改）

Token：优先用 `gh`（keyring 里的 xiaoshenming 账号，scopes 有 repo/workflow，足够 GraphQL、发评论、PATCH 通知）。`~/.git-credentials` **本机不存在**，只有 gh 缺失时才去找它。所有请求都带上代理：`export https_proxy=http://127.0.0.1:7897 http_proxy=$https_proxy`。

可直接复用的命令：

```bash
# 1) 全部通知（含已读，近 30 天）
gh api notifications -X GET -f all=true -f per_page=100 --paginate \
  -q '.[] | "\(.updated_at[0:16])\t\(.reason)\t\(.repository.full_name)\t\(.subject.title)"'
# 2) 谁提到我们（Discussions 搜索）
gh api graphql -f query='query{search(query:"dsh-session-surgeon repo:deepseek-ai/deepseek-harness", type:DISCUSSION, first:40){nodes{... on Discussion{number updatedAt title comments(last:1){totalCount nodes{author{login}}}}}}}'
#    另外两个关键词：xiaoshenming、会话医生
# 3) 近两周更新的帖（第一页 100 条，本地按关键词/标题过滤）
gh api graphql -f query='query{repository(owner:"deepseek-ai",name:"deepseek-harness"){discussions(first:100,orderBy:{field:UPDATED_AT,direction:DESC}){nodes{number updatedAt title comments(last:1){totalCount nodes{author{login} createdAt}}}}}}'
# 4) 版本线
npm view @deepseek-ai/dsh dist-tags --json
```

判断「这条帖要不要回」的判据：**最后一条评论不是我们**，且帖里 @ 了我们 / 点了工具名 / 问的问题我们能给出实测答案。已经有人答过同样内容就跳过（#7455/#7546 是例子）。

必看：

1. 全部通知（`all=true`，不只未读）：mention / comment / review_requested；本仓库的 ci_activity 也要看（CI 红了要立刻修）
2. 我们回过的帖的新评论 / 回复：至少 #1586 #1497 #5151 #5160 #5142 #5103 #4178 #1452 #4819 #4767 #4127 #6559 #6348 #6144 #4549 #4425 #6757 #7654
3. 官方 Discussions 按更新时间，关键词：`seq gap` `corrupt session` `session.jsonl` `message.id` `tool/call` `无法加载` `历史加载失败` `拒读` `torn` `zstd` `surgeon` `会话医生` `callId` `sourceEventSeqs` `start Match` `迁移` `migration` `v3` `v4`
4. 本仓库 Issues / 评论（`gh issue list -R xiaoshenming/dsh-session-surgeon --state all`）
5. 新版本发布：`npm dist-tags` + 需要时 `npm pack @deepseek-ai/dsh-session-format-*@<版本>` 解包，直接 grep 闸门是否还在（比读讨论可靠）

对每条命中分类：

| 类 | 动作 |
|---|---|
| A 新的磁盘拒读形状，我们还不会修，且不违反合同 | 写测试 + 最小修复 + CHANGELOG + 回复 |
| B 已会修，帖里还没说清或用户追问 | 只回复，不改代码 |
| C 引擎根因 / 备份插件 / handbook / 前端折叠 | 最多一句边界，不推销安装命令 |
| D 刷屏、邮箱误贴、Dependabot、飞书、模型、沙盒 | 忽略 |

同一家族帖不要复制粘贴同一段安装命令。没有 A/B 也要跑完扫描，汇报「无可吸收更新」。

### 3. 改代码（仅 A）

对照 `docs/REPAIR-SPEC.md`。健康会话 repair 必须 no-op（`mustWrite=false`）。

测试：`node --test test/*.test.mjs`（允许 skip official `scanZstdFrames` 未导出）。`scripts/check-no-secrets.sh` 必须过。

**必须跑两种环境**（本机装了 devDependency、CI 没装，行为会分叉；这轮就是这样断过一次 CI）：

```bash
node --test test/*.test.mjs                     # 有 runtime：格式版本 4
NODEBIN=$(dirname "$(command -v node)")
env -u NODE_PATH PATH="/usr/bin:/bin:$NODEBIN" "$NODEBIN/node" --test test/*.test.mjs   # 等效 CI：fallback 版本 0
```

测试里凡是依赖「本机装了什么」的分支，两边都要断言（例如 v3/v4 header：有 runtime 走 round-trip，没 runtime 必须是 `foreign-version` → "upgrade the harness"）。

质量门槛（自我 review ≥95 才推）：

- 全绿；无 TODO/FIXME；无 secrets；零 runtime deps
- 新模块保持小；`src/decode.mjs` 等核心文件尽量 ≤300 行
- GUI 文案：`plugin/client.js` 的 HEALTH 映射要覆盖新 health code（zh/en/nl 三份）
- 新形状的探测**只认能无损修的子集**：成员超出 released 形状的一律只报告、不猜
- 不扩 scope 到 compact 插入 `compaction/summary`、编假 callId、改官方菜单

改完顺手用官方包实测，别只信讨论里的转述（`node --input-type=module` 直接 import `node_modules/.pnpm/.../dsh-session-format-*/lib/index.js`，先跑「修前拒」再跑「修后过」）。

CHANGELOG.md 记用户可见变化，链到 Discussion 编号。README / README.zh.md / REPAIR-SPEC 只在行为变化时改；版本线变了要顺手刷新 README 的兼容行、REPAIR-SPEC 的目标 loader、`docs/SESSION-FORMAT.md` 的代际注释。

### 4. 回复

对口、短、中文（英文帖可双语）。写清：会做什么、不会做什么、先停写者、先 dry-run、不要对已裁文件连 apply。安装命令只在对方还没装、或需要拉 `#main` 时给一次。

### 5. 推送（px）

`px` 是 zsh 函数，对命令套 `http://127.0.0.1:7897`。在 bash/`run_code` 里等价于：

```bash
export http_proxy=http://127.0.0.1:7897 https_proxy=http://127.0.0.1:7897
export HTTP_PROXY="$http_proxy" HTTPS_PROXY="$https_proxy"
git -c http.version=HTTP/1.1 push origin main
```

先测 `curl -sS -m 8 -x http://127.0.0.1:7897 https://api.github.com/zen`。7897 不通就找用户当前代理，不要死磕 7890（clash 配置里有、进程常没起）。

git push SSL EOF 时：Contents API PUT 到 `xiaoshenming/dsh-session-surgeon`（会拆 commit），然后 `git fetch` + `rebase --onto origin/main <old> main` 对齐。不要 force-push 覆盖别人的 Contents 历史。

提交说明写清行为和 Discussion 号。作者：仓库历史全是 `Small明 <11856687+BFSYRGZbfsyrgz@user.noreply.gitee.com>`，而全局 config 是 `xiaoshenming <1181584752@qq.com>` —— 用 `git -c user.name=... -c user.email=...` 逐条传仓库作者，**不要改全局配置**。

推完核对 `git rev-parse HEAD origin/main` 一致，并看 CI：

```bash
gh run list -R xiaoshenming/dsh-session-surgeon -L 3
gh run view <id> -R xiaoshenming/dsh-session-surgeon --log-failed   # 红了的第一个动作
```

CI 红必须当轮修掉再推一次（测试分叉是常见原因，见第 3 步）。

### 6. 收尾汇报（中文，短）

- 扫了哪些帖 / 通知
- 吸收了什么（commit SHA + 测试）
- 回复了哪些链接
- 故意没改什么
- 本地 `link:` 要重启 `dsh web`；`github:…#main` 要再 add 一次

把相关 DSH 通知 PATCH 已读（含自己仓库的 ci_activity），命令是 `gh api -X PATCH notifications/threads/<id>`。不要留 `/tmp` 临时文件（回复稿、验证脚本用完删）。目标完成才 `update_goal complete`。

回复前先自查一遍：同一帖里别人是不是已经答过同样内容（别刷屏）；回复里引用的实测结论是不是真的跑过（没跑过就标明「未验证」）。发错帖要立刻 `deleteDiscussionComment` 删掉。

## 已知形状（已实现，不要当新 bug 重做）

- 缺 `message.id` → 只补 id
- 悬空 `tool/call` → inspect `dangling-tool-call`，不编结果（为什么只能报警见下面那条）
- #5182 空 `tool_calls[].id` → inspect `empty-tool-call-id`，不编 callId（根因是引擎出栈过滤）
- Windows bak `fsync` EPERM → `fsyncBestEffort`
- #1586 live-writer-tail：丢掉崩溃恢复闭包，保住还活着的写者
- #5151 packed-overlap-suffix：前缀必须与已提交事件一致才接下后缀
- #5160 newer-format-ranges：仅当本机 harness **没有** `decodeSeqRanges`（rc.2）时展开；0.1.2-rc.1+ 原生能读，不改文件
- 0.1.5 迁移拒绝家族（#6151/#6175/#6189/#6194，src/migrate.mjs）：`v0-preset-extra-member` 只留 preset、`v0-descriptor-version` 2→3、`v0-plugin-source-form` 补 form 或去展示成员、`v0-chunk-provenance` 改引用磁盘分块 seq（**v0→v1 与 v1→v2 两道边都会因它拒读**；#7824 的形状是声明范围把 `session/end-seed` 之类非分块事件扫了进来，报错是 `chunk references are not one complete ordered attempt`，在 v0 工件上表现为「历史加载失败」）。仅当本机 format ≥ 1；未知类型（session/imported、插件消息）迁移连 ignorable 都拒，我们只报告不删
- #5909 duplicate-tool-call-id：同一步重复通告的 callId；仅当本机 format version ≥ 1（0.1.3 迁移会拒读）时给后面的 id 加 `#n`。不编空 id。v2 文件名是 `session.vN.jsonl.zstd`
- #5694/#5909 legacy-replay-state：扁平 `{kind,...}` replayState 包成 `{response,blocks}`；仅 format ≥ 1 时改写
- Alpha → rc.2 `model/selection`：结构校验通过后只加 `ignorable: true`；保留 type/data/seq/time
- compact：seq 不连续 / 官方拒读则 refuse
- #6559 家族（0.1.7-rc.1 与 0.1.5-rc.3 都在）：退役来源字面量 `instruction-hint` → 同名后继 `plugin`（键集相同，v2→v3 `SOURCE_KINDS` 不认）；`agent/inbox/spliced` 的 `inserted[]` 消息缺 `id`/`role`（v0→v1 `messageValue` 拒读）→ 补 id 与校验器实参写死的 `user`。成员超出 released 形状的一律不碰
- 悬空 `tool/call` 共**五条路径**（`fixtures/probes/run.mjs` 五行，0.1.7-rc.1 与 rc.2 实测一致）：v0→v1 与 v3→v4 的 **migration stage 接受**；`restoreReleasedV2Artifact` / `restoreReleasedV4Artifact` **拒**（`step/end leaves unresolved tool call`）；**读一份已经是当前代际（v4）的已存日志也拒**（`readStoredLog` → `SessionLogScanner.finish()` → `assertReleasedV4Relationships`，外层包成 `SessionPersistenceCorruptionError: stored log is corrupt`）。更老的代际读盘先走迁移，所以拒收发生在 publish/restore；两条路径内层错误串一样，只有外层包装能区分入口。**事后补 `tool/result` 会落在已闭合的 step 外**，离线只能 `dangling-tool-call` 报警，不能补。有人要证据时给 `fixtures/probes/run.mjs` 的链接（跑通打印五行，漂移即 exit 1）
- 官方 `restore.decodeRow()` **原地改写传入的行对象**（#6559 有人复现）→ 任何"修前判一次、修后判一次"的验证必须每遍重新 `JSON.parse`，复用同一批对象会得到静默错误的结论。surgeon 自身不调官方 decoder（只在自己 src 里实现），风险在探针与测试侧：`fixtures/probes/run.mjs` 已改成每个入口点各自 `JSON.parse` 一份
- #7824「回合关了还在继续」：`turn/end` 之后同一回合的 step 事件继续写 → 官方在**转换后的工件**上重跑 v0→v1 的 `assertReleasedArtifactRelationships`（v1→v2 stage 调用它；v3→v4 的 walker 检查同一对），整份拒读 `assistant/message does not match an open turn and step`（step 起头的变体是 `step/start … does not match the open turn and next step`），外层 orchestrator 包成 `refuses the transformed artifact`。同一家族的另一种：`turn/end` 落在 step 还没 `step/end` 时 → `turn/end <n> crosses an open step`（写者侧 `dsh-session/lib/invariant.js:37` 同规则）。实测（0.1.7-rc.2 发布包）：健康对照通过，`turn/end` 后接 `assistant/message` 被 `restoreReleasedV2Artifact` 以报告者原话拒读；本机 6 条真实会话 0 命中。已实现为 inspect 的 `step-after-turn-end` / `turn-end-while-step-open`，**只报告不修**（合并 / 拆分在工件里没有唯一答案，拆分还要重编号后面所有 seq 与声明范围）。**探针注意**：单跑 `createStage` 不触发关系断言（v0→v1 stage 不校验关系），要打 `restoreReleasedV2Artifact`；判据要窄（只在事件带的 turn 已经 turn/end 过时才报），否则一堆省略 `step/start` 的最小 fixture 会误报
- 已经是 v4 的日志里留着退役的 `{kind:"plugin", plugin}` 消息来源（#7772）：v4 准入要 producer 自己的 kind，producer kind 由包名推导（改名表 / released 集合 / `plugin:<pkg>` 兜底）→ 离线没有唯一答案。inspect 只报 `v4-literal-plugin-source`（**仅当本文件 header ≥ v4**；更低代际由 v3→v4 stage 自己改写，所以别在 v0–v3 上报），repair no-op。实测：`kind:"plugin:dsh-mnemon"` 读盘通过、`kind:"plugin"` 包装整份被拒（0.1.7-rc.1）
- `session/title-llm-request.messageSeqs` 指向已消费 `assistant/chunk`（v1→v2 `mapOne` 拒）：改成哪个 seq 没有唯一答案 → 只报告不修
- 代际：header v0–v4 都能 inspect/repair；比本机新的代际走 `foreign-version` → refuse 文案必须是「upgrade the harness」（`planRepair` 里这条检查在 `!header` 之前）
- `team/*` 在 known-types

## 本机事实

- GitHub：用 `gh`（keyring，账号 xiaoshenming，scopes `gist, read:org, repo, workflow`）；`~/.git-credentials` 本机不存在
- 推送代理：`127.0.0.1:7897` 实测可用（`px` 就是给它套代理）；`git -c http.version=HTTP/1.1 push` 直接过
- git 作者：全局 config 是 `xiaoshenming <1181584752@qq.com>`，仓库历史是 `Small明 <11856687+BFSYRGZbfsyrgz@user.noreply.gitee.com>` → 提交时用 `-c` 传仓库作者
- CI：GitHub Actions 只跑 `node fixtures/synthetic/build.mjs` + `node --test test/*.test.mjs` + secrets 检查，**不装依赖**（所以本机有 node_modules 时测试行为和 CI 可能分叉）
- 用户 checkout 常是 `link:`；overlay 文案要重启 web 才更新
- 2026-09 版本线：npm `latest`=0.1.5-rc.3、`next`=**0.1.7-rc.2**（格式 v4，也是本仓库 devDependency 的 pin，见 `package.json`）、`alpha`=0.1.7-alpha.2。rc.1 / rc.2 上 v0→v1/v2→v3 的闸门都在（descriptor / inserted / SOURCE_KINDS 无 `instruction-hint`），五行的悬空 call 表两版一致；行号以 tarball 为准：`dsh-session-format-v0-to-v1` 的 `subagentDescriptorValue` 声明 `:1289`、`literalValue(data["version"],[3])` 在 `:1290`、`data["version"] !== 3` 在 `:1584`、抛在 `:1586`（同一版本已安装副本与 tarball 字节一致）。升 pin 的方法：改 `package.json` 后 `pnpm install`，`pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude` 列表会跟着出现整片换行号——那是正常的重装产物，跟着一起提交即可
- 格式代际：header v0–v4 都能 inspect/repair；`session.vN.jsonl.zstd` 由官方迁移，surgeon 不改代际
- 会话根解析：`$DSH_SESSION_ROOT` → `$DSH_HOME/sessions` → `~/.dsh/sessions`；本机两个 home（`~/.dsh-surgeon-dev` 有会话且装了插件，`~/.dsh` 空且没装）
- 面板「会话根」下拉：`GET /api/session-surgeon/roots` 按 home 形态自动发现（`profiles`/`.anonymous-user-id`/`.credentials.yaml`/`settings.yaml*` 任一 + `sessions/`），带会话数，支持手输任意路径（`~` 会展开）；所有单会话请求都带 `root`，切根后 inspect/repair/export 才落在正确的库上
- 「面板一条会话都没有」的第一诊断：`curl -s http://127.0.0.1:<port>/api/session-surgeon/scan`，看返回的 `root`/`error`（host 的 `DSH_HOME` 决定默认根）；`/roots` 列全部候选
