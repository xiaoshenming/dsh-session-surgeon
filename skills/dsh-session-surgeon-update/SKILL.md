---
name: dsh-session-surgeon-update
description: |
  Self-iterate dsh-session-surgeon from community feedback. Use immediately when the user says 更新, 更新插件, 更新一下插件, 自我迭代, 逛逛社区, 再看看社区, 查社区然后更新, 补扫社区, 看多一点, update the plugin, absorb community feedback, or asks you to scan DeepSeek Harness discussions and update this plugin without spelling out the steps — including "我半个月没看了" style backlog sweeps where the scan has to cover every mention since a given date. Also use when they want you to reply on relevant threads, changelog, and push to origin/main. Do not use for repairing a specific local session file, copying a session ID, or unrelated DSH bugs (sandbox, models, Feishu).
---

# 更新插件 — dsh-session-surgeon 自我迭代

加载方式：DSH 技能目录里有就直接 `skill`；没列出（或报 unknown）就让 agent 直接 `read skills/dsh-session-surgeon-update/SKILL.md` —— 本仓库的更新流程就是这么跑通的，纯 markdown，不需要注册。
**桌面端的技能索引不扫已装插件的包内目录**：`@deepseek-ai/dsh-skill-filesystem` 的根按 rank 排：`<project>/.dsh/skills`（100）、`<project>/.agents/skills`（200）、`customSkillDirs`（300）、`$DSH_HOME/skills`（本机 `~/.dsh/skills`，400）、`~/.agents/skills`（500）、`bundledSkillDir`/`$DSH_BUNDLED_SKILL_DIR`（600）。`includeDefaultRoots` 默认 **true**（`z.boolean().default(true)`），写 `false` 才一次性关掉项目根、用户根和 `DSH_BUNDLED_SKILL_DIR` 默认值。**更常踩的是「一个根读失败 → 整份 provider 不贡献」**（#8649：桌面端 `cordis` preset 那行只有 `customSkillDirs` 指向 app.asar 内）：`FileSystemSkillProvider.list()` 是 `for (const root of roots) for (const skill of await discoverRoot(root, …))`，**没有逐根 try/catch**，`discoverRoot` 只吞「路径不存在」那一类（ENOENT/ENOTDIR/FS_NOT_FOUND/FS_NOT_DIRECTORY）；rank 300 一抛，后面的 400/500 根本走不到，上一层 `SkillRegistry.listLayerCandidates` 再 catch 掉**整个 provider**（`skill provider "filesystem" skipped: …`），连已收好的候选一起丢，并把 `cacheable=false` 带到 `snapshot.complete`；`dsh-tool-skill` 的 `agent/pre-step` 判定里 `if (!snapshot.complete) return decision`（0.2.0-rc.2 `:216`）就**不再发布技能目录**（而且 `complete:false` 的观测永远不进 `collectCache`，所以每次请求都重跑、重复打同一条 warn）—— 表现是「所有文件系统技能消失、模型侧也看不到任何技能」，而不是少几个。所以往 `~/.dsh/skills` 做链接**救不了**这种配置；要修就得让那个坏根能被 host 文件服务解析（落成真实目录，或改用 `bundledSkillDir`）。**别只看症状推断配置**：我上一轮凭「整份失效」推断那行写了 `includeDefaultRoots: false`，被报告者用归档里抠出的 preset YAML + 哈希自证顶回来 —— `true` 和 `false` 在症状上不可分，只有代码可分。所以桌面端要"被索引到"有两条路：① 让 agent 直接读装好的那份 `~/.dsh/profiles/desktop/node_modules/dsh-session-surgeon/skills/dsh-session-surgeon-update/SKILL.md`；② 把它链进用户技能根（更新后自动跟随，不用重拷；前提是 300 那条 `customSkillDirs` 不炸、默认根没被关）：
`ln -sfn ~/.dsh/profiles/desktop/node_modules/dsh-session-surgeon/skills/dsh-session-surgeon-update ~/.dsh/skills/dsh-session-surgeon-update`

用户只说「更新」或「更新插件」时，不要再问流程。加载本技能后直接执行：扫社区 → 判断该不该改代码 → 改 / 测 / 写 CHANGELOG → 对口回复 → 用 px 推 `origin/main` → 用中文汇报。

仓库：当前 checkout（本机 `/Users/ming/data/project/dsh/dsh-session-surgeon`；技能里出现的 `/home/ming/...` 是旧机器路径，不要照抄）
远程：`xiaoshenming/dsh-session-surgeon` `main`
安装 / 更新（用户 2026-09-29 起改用 **DSH Desktop**）：profiles 在 `~/.dsh/profiles/desktop`，`package.json` 里是 `dsh-session-surgeon: github:xiaoshenming/dsh-session-surgeon#main`，装出来的是一份**没有 `.git` 的拷贝**（`node_modules/dsh-session-surgeon`，pnpm 从 `codeload.github.com/.../tar.gz/<commit>` 解出来的）。
→ 所以「用户侧更新」＝**桌面端「插件」页对本插件点更新**（官方 in-process manager 走 pnpm 重新解析 `#main` 到新 commit），或在 profile 目录里 `pnpm update dsh-session-surgeon`；**不需要重启 `dsh web`，也不需要再 add 一次**。agent 侧只负责推到 `origin/main` 并让 CI 绿。
本地开发仍是 `~/.dsh-surgeon-dev` + `link:` + 重启 `dsh web`（见 README「本地开发」）。

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
- **GUI 结构跟主体对齐（2026-09-29 起）**：侧边栏行 + 中栏页面走壳的原生座位（`ctx.slots.inject("sidebar.panellist")` 注册行、`inject("main")` 注册页面，`ctx.get("layout").selectPanel(id|null)` 切页），别再 DOM 注入侧边栏/整屏浮层——没有 seats 的老壳才退回 `mountOverlay`。**取 slots/layout 一律用 `ctx.get(name)`**（`ctx.<service>` 未声明就抛，见本机事实）；样式只用 `--dsw-*` token（`plugin/ui.css` 里不允许硬编码颜色）。`node --test test/ui.test.mjs` 会断言座位注册、overlay 兜底、token 与「直接读抛异常的 ctx 下按钮仍可用」
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
- 推出去了以后用户怎么更新：**桌面端「插件」页 → 本插件 → 更新**（等价于 `cd ~/.dsh/profiles/desktop && pnpm update dsh-session-surgeon`，会重新解析 `github:…#main` 到新 commit）；本地 `link:` 的 dev 环境才需要重启 `dsh web`

把相关 DSH 通知 PATCH 已读（含自己仓库的 ci_activity），命令是 `gh api -X PATCH notifications/threads/<id>`。不要留 `/tmp` 临时文件（回复稿、验证脚本用完删）。目标完成才 `update_goal complete`。

回复前先自查一遍：同一帖里别人是不是已经答过同样内容（别刷屏）；回复里引用的实测结论是不是真的跑过（没跑过就标明「未验证」）。发错帖要立刻 `deleteDiscussionComment` 删掉。

## 已知形状（已实现，不要当新 bug 重做）

- 缺 `message.id` → 只补 id
- 悬空 `tool/call` → inspect `dangling-tool-call`，不编结果（为什么只能报警见下面那条）。**判据要按 step 边界收窄（2026-10-04 用真实库体检发现的假阳性）**：折叠只在 `step/end` 要求配对（`assertNoUnresolvedTools(toolLifecycles, "step/end")`），所以「尾部 step 还开着、调用没结果」是普通崩溃形状 —— 引擎的 `interruptedTurnClosers()` 会在 resume 时补结果。实测本机一份 2970 事件的真实 v4 会话（尾部未闭合 step + 未配对调用）被桌面 0.2.0-rc.2 验证器**接受**，而我们当时报 `dangling-tool-call`；现在只在「step 已闭合仍无结果」时报，空 callId 例外（call 本身上就被拒，不看 step）。**教训：每轮除了扫社区，也要拿真实库跑一遍 `inspect` 找假阳性**，合成 fixture 永远不会暴露这种
- #5182 空 `tool_calls[].id` → inspect `empty-tool-call-id`，不编 callId（根因是引擎出栈过滤）
- Windows bak `fsync` EPERM → `fsyncBestEffort`
- #1586 live-writer-tail：丢掉崩溃恢复闭包，保住还活着的写者
- #5151 packed-overlap-suffix：前缀必须与已提交事件一致才接下后缀
- #5160 newer-format-ranges：仅当本机 harness **没有** `decodeSeqRanges`（rc.2）时展开；0.1.2-rc.1+ 原生能读，不改文件
- 0.1.5 迁移拒绝家族（#6151/#6175/#6189/#6194，src/migrate.mjs）：`v0-preset-extra-member` 只留 preset、`v0-descriptor-version` 2→3、`v0-plugin-source-form` 补 form 或去展示成员、`v0-chunk-provenance` 改引用磁盘分块 seq（**v0→v1 与 v1→v2 两道边都会因它拒读**；#7824 的形状是声明范围把 `session/end-seed` 之类非分块事件扫了进来，报错是 `chunk references are not one complete ordered attempt`，在 v0 工件上表现为「历史加载失败」）。仅当本机 format ≥ 1；未知类型（session/imported、插件消息）迁移连 ignorable 都拒，我们只报告不删
- #5909 duplicate-tool-call-id：同一步重复通告的 callId；仅当本机 format version ≥ 1（0.1.3 迁移会拒读）时给后面的 id 加 `#n`。**v4 上只改 `source.callId` 会写出一个加载器拒读的文件**（0.2.1 就是这样，被 Renzishi 的 PR #6 顶回来）：关系折叠读的是 `message.toolCallId`，两边不一致就报 `format v4 tool/result at seq <n> requires toolCallId matching its tool source`；`data.stream` 也必须跟着改——验证器把流重新拼一遍再跟 `message.content` 比，不一致报 `content disagrees with its embedded stream`。三种带 id 的记录都要覆盖：`tool-call-chunks`、`block-end`（`assemble()` 原样返回 `partial.block`）、以及 `name === ""` 时没并进 run 的裸 `tool-call-delta`。替换行要用被替换行拿到的 id，否则 `replacement may change only content`。映射不完整 → 整体 refuse，不猜。判定入口是官方 `worker.cjs`（一次跑关系折叠 + `Session.fromRestore` + 流比对），0.1.7-rc.2 与桌面 0.2.0-rc.2 行为一致。v2 文件名是 `session.vN.jsonl.zstd`
- **#8653 v4 空 tool-call id 死锁（只报告，已覆盖）**：模型/provider 吐出 `tool-call-delta {id: ""}` + `block-end {block:{type:"tool-call",id:""}}`（`dsh-llm` 的 BlockAssembler 对 id 没有空串守卫，`name` 有；`assemble()` 又因 `if (partial.block) return partial.block` 原样放行）。空 id 落盘 → `assertV4ToolResultMessage` 拒任何 `toolCallId: ""` 的收尾 → `interruptedTurnClosers()` 合成的收尾用同一个 id 又被拒 → **每次 resume 都死在同一个 seq，会话永久卡死**（应用内没有回滚/截断）。我们的 `empty-tool-call-id`（`tool/call.callId` 为空、`assistant/message` 里 `tool-call.id` 为空）本来就能定位；官方修法是 llm 侧兜底成 `call-${index}`，**我们没替它改 id**（编 id 违反合同；要救得把空 id 归一化或截断到最后一个 `turn/end`，都还没做）
- **#8812 空闲修剪器的尾巴（已实现为 `prune-tail-outside-turn`，可修）**：tool-result 修剪器在**没有开着回合**时改写旧结果 —— 追加 `compaction/prune` 行 + replacement `tool/result`（`surfaceOp: {op:"replace",startSeq,endSeq}` + `sourceEventSeqs`）。两个已发布读端都让非 append 的 `tool/result` 要求开着回合：0.1.7-rc.2 / v3-to-v4 包里是 `Relationships.tool()` 的 `if (event.type === "tool/result" && event["surfaceOp"] !== "append") { this.requireTurn(event.type); return; }`（`requireTurn` → `"tool/result is outside an open turn"`），**0.2.0-rc.2 的 worker.cjs 把这段重写成了 switch**，条件等价：`case "tool/result": if (surfaceOp === "append") { requireOpenStep… } else if (openTurn === null) throw "tool/result replacement is outside an open turn"` → **写者自己产出读端拒收的日志**，整条会话打不开，应用内无救。**为什么这条能修**（而 #7824 不能）：replacement 是纯 surface 元数据 —— `foldSurface` 自己要求 `sourceEventSeqs` 恰好列出被遮蔽的 surface 节点，那些节点都还在盘上，所以裁回它跟随的那个 `turn/end` 就是恢复修剪前的 surface，消息/回合/工具结果一个不丢。判据：切点之后**每一行**都得是修剪器的（`compaction/prune` + replacement `tool/result`），且 `sourceEventSeqs` 全部 ≤ 切点；有别的行（user/message、新回合、插件事件）、`turn/end` 不存在 → refuse 并说明。裁完还要复查 `turnStepImbalances` / `prunePassHits` 都为空（replacement 行带着已关闭回合的 `data.turn`，所以它同时会命中 `step-after-turn-end`；健康码优先级把这条可修的排在前面）。实测：raw 输出被桌面 0.2.0-rc.2 的 `worker.cjs` 拒（关系折叠 + seed + 流比对一次跑），修完 VERIFIED。**投影缓存**：报告者实测还要删 `<home>/storages/session_projcache*/sessions/<id>.json` 让投影重建（我们只在 CHANGELOG/回复里提示，不代删）。另外 v4 的 `surfaceOpOf` 对 surface-eligible 类型**强制要求 surfaceOp**（`:2687` `requires a surfaceOp marker`）→ 所以「没有 surfaceOp 的 tool/result」不可能出现在合法 v4 文件里，探测只认对象形态的 replace
- #5694/#5909 legacy-replay-state：扁平 `{kind,...}` replayState 包成 `{response,blocks}`；仅 format ≥ 1 时改写
- Alpha → rc.2 `model/selection`：结构校验通过后只加 `ignorable: true`；保留 type/data/seq/time
- compact：seq 不连续 / 官方拒读则 refuse
- #6559 家族（0.1.7-rc.1 与 0.1.5-rc.3 都在）：退役来源字面量 `instruction-hint` → 同名后继 `plugin`（键集相同，v2→v3 `SOURCE_KINDS` 不认）；`agent/inbox/spliced` 的 `inserted[]` 消息缺 `id`/`role`（v0→v1 `messageValue` 拒读）→ 补 id 与校验器实参写死的 `user`。成员超出 released 形状的一律不碰
- 悬空 `tool/call` 共**五条路径**（`fixtures/probes/run.mjs` 五行，0.1.7-rc.1 与 rc.2 实测一致）：v0→v1 与 v3→v4 的 **migration stage 接受**；`restoreReleasedV2Artifact` / `restoreReleasedV4Artifact` **拒**（`step/end leaves unresolved tool call`）；**读一份已经是当前代际（v4）的已存日志也拒**（`readStoredLog` → `SessionLogScanner.finish()` → `assertReleasedV4Relationships`，外层包成 `SessionPersistenceCorruptionError: stored log is corrupt`）。更老的代际读盘先走迁移，所以拒收发生在 publish/restore；两条路径内层错误串一样，只有外层包装能区分入口。**事后补 `tool/result` 会落在已闭合的 step 外**，离线只能 `dangling-tool-call` 报警，不能补。有人要证据时给 `fixtures/probes/run.mjs` 的链接（跑通打印五行，漂移即 exit 1）
- 官方 `restore.decodeRow()` **原地改写传入的行对象**（#6559 有人复现）→ 任何"修前判一次、修后判一次"的验证必须每遍重新 `JSON.parse`，复用同一批对象会得到静默错误的结论。surgeon 自身不调官方 decoder（只在自己 src 里实现），风险在探针与测试侧：`fixtures/probes/run.mjs` 已改成每个入口点各自 `JSON.parse` 一份
- #7824「回合关了还在继续」：`turn/end` 之后同一回合的 step 事件继续写 → 官方在**转换后的工件**上重跑 v0→v1 的 `assertReleasedArtifactRelationships`（v1→v2 stage 调用它；v3→v4 的 walker 检查同一对），整份拒读 `assistant/message does not match an open turn and step`（step 起头的变体是 `step/start … does not match the open turn and next step`），外层 orchestrator 包成 `refuses the transformed artifact`。同一家族的另一种：`turn/end` 落在 step 还没 `step/end` 时 → `turn/end <n> crosses an open step`（写者侧 `dsh-session/lib/invariant.js:37` 同规则）。实测（0.1.7-rc.2 发布包）：健康对照通过，`turn/end` 后接 `assistant/message` 被 `restoreReleasedV2Artifact` 以报告者原话拒读；本机 6 条真实会话 0 命中。已实现为 inspect 的 `step-after-turn-end` / `turn-end-while-step-open`，**只报告不修**（合并 / 拆分在工件里没有唯一答案，拆分还要重编号后面所有 seq 与声明范围）。**探针注意**：单跑 `createStage` 不触发关系断言（v0→v1 stage 不校验关系），要打 `restoreReleasedV2Artifact`；判据要窄（只在事件带的 turn 已经 turn/end 过时才报），否则一堆省略 `step/start` 的最小 fixture 会误报
- **#7995 `subagent/descriptor` 分支的爆炸半径**：v0→v1 payload 闸门判 `data["version"] !== 3` 就拒（`dsh-session-format-v0-to-v1/lib/index.js:1584` 判、`:1586` 抛；`literalValue(data["version"], [3])` 在 `:1290`）。这条闸门在 **0.1.5-rc.3 与 0.1.7-rc.2 的发布包里逐行一致**（不是 0.1.5 的回归），而写者 27/27 会话只发 `version: 2`。真正的杀伤不在"一条会话打不开"：**persistence observer 把每条已存 v0 会话都喂进这条闸门，于是一个坏工件让*所有* session-search 查询失败**（`SESSION_QUERY_PERSISTENCE_FAILED`，不是只坏它自己）。我们的 `v0-descriptor-version` 已能修（只改 `data.version` 2→3，两版成员集相同）；构造样本实测：修前 `unsupported descriptor version 2`、修后 accepted。整库枚举要用 `index`（逐会话 health），`scan` 只读 header 看不到这类
- **producer-owned source kind 是写时闸门（#7999 / #7800 / #7772）**：`encodeCurrentEvent` 在**落盘前**就拒 `{kind:"plugin"}`，事件从未写入 → **没有日志可 grep**（报告者说的"无法诊断"是真的）。我们能覆盖的是**已经在盘上**的那类：v4 日志里留着 `{kind:"plugin", plugin}` 会在**读盘**整份被拒（`stored log is corrupt: … requires a producer-owned source kind`），报 `v4-literal-plugin-source`（带 seq 与 plugin 名）。accepted 字面量：`plugin:<pkg>` / `<pkg>`；被拒：`plugin`。未知插件的 producer kind 在工件里没有唯一答案 → 只报告、不改写。#7800 已由报告者自解：`dsh-vision-router@2.2.2` 有 11 处调用点写 `{kind:"plugin"}`，升到 2.2.3（认 v4）即修
- **丢掉末尾整帧看不见（#8010）**：日志末尾若丢了**整帧**，剩下的前缀每帧校验都通过、seq 从 0 连续 → 官方读盘给出一个更短但**完全合法**的会话，没有任何报错（`readZstdPrefix` 只对"帧内撕裂"零容忍；帧整个没了就从未进过 `scanZstdFrames` 的列表）；surgeon 的 `torn-tail` 同源，也看不见。唯一在盘的见证是投影缓存水位（`<home>/storages/session_projcache/sessions/<id>.json` 的 `rows[*].seq`），但**别对它下判定**：只有**当前代际**那份日志可比（本机同一会话 v3 文件 `lastSeq=22` < 缓存 23 看着像丢尾，而 v4 文件 `lastSeq=23` 正好相等 —— 拿错代际就是假违例）、缓存落后是合法的（本机 6 份当前代际：5 份精确、1 份落后 2，只能单向比较）、且任何合法把日志改短的路径都会误报（我们自己的 `seq-gap-committed` 就是截断到缺口前最后一个 `turn/end`）。结论：整帧丢失**只说明、不判定**，要判定得等官方显式记录总数
- **扫描方法（自己踩过的坑）**：关键词搜（`dsh-session-surgeon` / `xiaoshenming` / `会话医生`）**抓不到同家族但没提我们的帖** —— #7995 / #7999 / #7800 三条全是这么漏掉的，是 #7824 的评论里提到 #7995 才发现的。每轮必须再拉 `discussions(first:30, orderBy:{field:UPDATED_AT, direction:DESC})`，按 `updatedAt >= 近 3 天` 过滤逐条看标题，才算扫完
- **自己代码的体检方法（每轮除了扫社区，也该跑一遍）**：
  - **性能先量再谈**：构造 140k 事件日志实测，`decodeSessionBuffer` 272ms，而全部探测器加起来只 27ms（10%）—— "合并遍历/缓存"是伪需求，不要做。要优化就先建大日志、逐函数计时，别凭感觉。
  - **崩溃面用"畸形行"测试扫**：截断行（类型在、成员没了）喂 `decode` + `planRepair`。`closers.mjs` 就因为 `event.data.message.content` 没防护，让 `inspect` / `repair` 双双 `TypeError` 崩掉 —— 工具死在它本该诊断的坏文件上。修法：成员访问一律 `?.` + `Array.isArray` 判断。
  - **假阴性比崩溃更隐蔽**：官方 payload 闸门为一行就拒整条会话，我们却报 `ok`。查法是对发布包做**消融实验**：`assertReleasedV0Keys` 的调用点逐个删成员，只有闸门拒删的才算必需集，据此建表（`src/released-shape.mjs`，部分覆盖，只在 `fileVersion === 0` 上跑）。扩展表也用同一方法，别照抄讨论里的转述。
  - **别信自己的 fixture**：`test/message-id.test.mjs` 那份合成日志本身就被官方闸门拒（`assistant/message` 缺 `turn`/`step`），却断言 `health === "ok"`。新探测器一上线就把它抓了出来 —— 凡是要断言 `ok` 的工件，先让发布包接受它。
  - **声明 ≠ 执行（这轮最值钱的一条）**：`dsh-session-format-v0-to-v1` 自己声明了清单 `RELEASED_V0_EVENT_DISPOSITIONS`（51 类，`disposition([必需],[可选])`，闸门在 `assertReleasedEventPayload` 里泛化地按它校验），看起来可以直接抄进我们的表 —— **不能**。它要求 `assistant/chunk` 必须有 `chunk`，而实测这类行**完全不校验**：缺 `chunk` 通过，多一个未知成员也通过（对照 `assistant/message` 加同样成员会被拒）。抄声明就会报出「加载器其实接受」的行。**结论：必需集只能靠消融实验量**（建一个闸门接受的基线，逐个删成员，只有拒删的才留下），声明只用来交叉核对。本轮据此把 `agent/inbox/spliced`（`target`/`start`/`inserted`）与 `goal/change`（`kind`/`version`/`operation`，注意它的 `goal`/`cleared` 是分支可选、不是必需）补进表里，10 条全部与声明一致
  - **下游白名单也能证伪上游**：判「上游该不该放宽」时，去看后面的阶段怎么想。descriptor 版本这条：v1→v2 与 v2→v3 **完全不碰** `subagent/descriptor`，而 v3→v4 的 `childCatalogFact` 白名单是 **`[1,2,3]`**（还专门给 version 1 特判）—— 只有 v0 闸门认为「3 才是唯一合法值」，所以放宽它和链路其余部分是一致的；同时 2 与 3 在该函数里处理完全相同，证明我们 2→3 的归一化对下游无损
- **结算字段闸门（#8084，已实现为 `invalid-settlement-fields`）**：`assertAssistantSettlementShape`（`dsh-session` 里，`0.1.7-rc.2` 在 `lib/index.js:1126`、`0.2.0-rc.1` 在 `:1166`）要求 `assistant/message` / `assistant/attempt` 的 `turn`/`step` 是**非负安全整数**（`-0` 也拒）且 `stream` 是**数组**，为一行就拒整条会话：`seed assistant/message at index 4002 has invalid settlement fields`。它由 `assertCurrentLlmShape`（`0.1.7-rc.2:1101`）从 `assertSessionEventEnvelope`（`:1070`）调用，而后者在 **`Session` 构造函数的 seed 循环**里跑（`0.1.7-rc.2:1289`，`static fromRestore`）→ **读一份已存日志也会走到**（persistence-jsonl `:1824` 调 `Session.fromRestore`）。**复现方法（照这个做，别只读码）**：把一份真实 v4 日志的事件数组当 seed 传 `Session.fromRestore(id, events, header, 0, "detached", [])` —— 原样通过；`delete data.stream` / `stream = null` / `turn = -0` / `delete data.turn` 四种改法都抛报告者原话。**注意合成 fixture 的两个坑**：`assistant/message` 事件要带 `surfaceOp: "append"`（否则报 `is surface-eligible and requires a surfaceOp`，那是 fixture 的错不是闸门的），`message.source` 要 `{kind:"model", provider, model}`（否则报 `message must have model source`）。写入侧 `Session.append` 只校验 `validateSessionEventData` + `surfaceManager.validateNext`，**不校验这三个字段**（#8084 里 @Mide69 的定位）→ 坏行静默落盘、下次加载才暴露。`stream` 是流式分块（实测健康行非空，5–26 项）。**能修，别再说「只报告」—— 上一版就是错在这里（我公开说过两次，被社区 #8084 的 xiaoyuyu6420 用一份可用的手工配方顶回来，实测他对我错）**：第二道闸门 `assertCurrentAssistantStreams`（persistence-jsonl `lib/index.js:1833`）展开 `stream` 后**只要展开为空就 `continue`**，在比对 `message.content`/`usage`/`replayState` **之前**跳过 → **`stream: []` 两道闸门都收**；`stream` 删掉或 `null` 则两道都拒。所以 `stream: []` 是唯一合法值且不丢可恢复信息（正文在 `message.content`，原样不动）。`turn`/`step` 更不是猜：日志写明该 seq 处开着哪个 turn/step，就是这行所属的值；该 seq 处没开东西才**不写**、报 `settlement-unresolved`。**验证方式**：7 种坏形状修前 `Session.fromRestore` 拒、修后构造；真实 v4 日志修完能构造且其余 579 行 content 比对照旧通过；`-0` 改健康行后修回原值（说明推出的是真值）。**只在 v1 以上检查**：v0 的 `assistant/message` 不允许带 `stream`（v0→v1 闸门当 unexpected member 拒）
- **子目录闸门（#7995 的追问，已实现为 `descriptor-catalog-fact`）**：v3→v4 的 `historicalChildCatalogSource`（v3-to-v4 `lib/index.js:871`）把子会话自己的描述符交给 `childCatalogFact`（`:900`）—— 后者是**唯一读 `mode` 的地方**。消融出来的完整判据：`count !== 1 || version ∉ [1,2,3]` → **早返回，不拒**（注意 `:904-908` 的白名单是 return 不是 throw）；`provider` 非字符串 → 拒；`version !== 1` 且 `mode ∉ {continuable, one-shot}` → 拒（`has an invalid subagent descriptor mode`）；再经 `catalogFact`（`:927`）**有效 mode 为 `continuable` 时 `label` 必须是字符串**（version 1 被归一成 `continuable` ⇒ **每行 version 1 都要 label**），`label` 非字符串也拒（`requires a supported versioned catalog fact`）。**12 组形状矩阵对发布函数 0 分歧**（`test/catalog-fact.test.mjs`）。两条边界：只在 **v1–v3** 检查（v4 不走这条迁移）；只对 **`isSeeded === false`** 的子代理子会话判定 —— 目录按 `seq >= inheritedEventCount` 计数，该切点是运行时状态，**盘上任何 header 都不带**（`assertReleasedV4Header` 允许集 = version/id/createdAt/isSeeded/delegationDepth/cwd/parentSession/origin/agentPreset），只有 `assertReleasedV2Artifact` 的 `if (!header.isSeeded && cut !== 0) throw` 钉死一个方向：未继承 ⇒ 切点 0。继承过的子会话**跳过不猜**
- **两个测试陷阱（这轮踩了，别重犯）**：① `readStoredLog` **不跑**结算闸门 —— 它走 `decodeStoredLog` → `validateStoredEvents`（从别的包 import 进来的，不含该闸门），所以拿 `readStoredLog` 当「能不能加载」的判据会得出**假的通过**（`stream` 删掉也照样 LOADS）；真正会跑闸门的是 `verifyCurrentGeneration`（persistence-jsonl `:1798`，内部 `Session.fromRestore` + `assertCurrentAssistantStreams`）→ 判据要用 `Session.fromRestore` + 自己复刻那道 content/usage/replayState 比对。② 走 `encodeSession` 往返会**把 `-0` 洗成 `0`**（`JSON.stringify(-0)` 就是 `"0"`），所以「删/改 `-0` 再 encode→decode」测不到 `-0`；`-0` 只能在内存里改事件、直接喂 `planRepair`。③ 想让 `readStoredLog` 真读到文件，临时目录要复刻 `<root>/<projDir>/<id>/session.vN.jsonl.zstd`，其中 `projDir` 是从 header `cwd` 推出来的 `--` + cwd（`/`→`-`）+ `--`，且 header `id` 必须等于目录名（改名会先撞 `delivery marker names the wrong Session`）
- **官方写者造不出缺 `stream` 的 assistant 行（#8084 的根因排除法）**：`dsh-agent-loop` 里 5 处 `session.append("assistant/message"|"assistant/attempt", …)` 全部传 `stream: live.stream`，而 `get stream()` 是 `return [...this.accumulator.snapshot()]` —— **永远是数组**（可能空），在 `0.1.5-rc.3` / `0.1.7-rc.1` / `0.1.7-rc.2` 三版里逐行相同（0.1.5-rc.3 用 `npm pack` 拉的 tarball 比对）。另外 v0/v1/v2 的日志**也报不出结算字段那条错**：v0→v1 确实只发 `turn,step,message`（无 stream），但 v2→v3 的 `contentArray(data["stream"], …)` 会先拒（`… .stream: content must be an array`）→ 所以报结算字段错 ⇒ 文件是 **v3 或 v4** ⇒ 坏行来自官方 agent loop 之外的写入方（插件/provider 适配器直接调 `session.append`），且与 subagent / 工具调用无关。**我们自己的 repair 也不是嫌疑人**：5 份真实 v4 日志、925 行 assistant/message，走完整 decode → plan → encode 后 `stream` 数组全部保留（补 id 那条路只 spread 行、替换 `message`）
- 已经是 v4 的日志里留着退役的 `{kind:"plugin", plugin}` 消息来源（#7772）：v4 准入要 producer 自己的 kind，producer kind 由包名推导（改名表 / released 集合 / `plugin:<pkg>` 兜底）→ 离线没有唯一答案。inspect 只报 `v4-literal-plugin-source`（**仅当本文件 header ≥ v4**；更低代际由 v3→v4 stage 自己改写，所以别在 v0–v3 上报），repair no-op。实测：`kind:"plugin:dsh-mnemon"` 读盘通过、`kind:"plugin"` 包装整份被拒（0.1.7-rc.1）
- `session/title-llm-request.messageSeqs` 指向已消费 `assistant/chunk`（v1→v2 `mapOne` 拒）：改成哪个 seq 没有唯一答案 → 只报告不修
- 代际：header v0–v4 都能 inspect/repair；比本机新的代际走 `foreign-version` → refuse 文案必须是「upgrade the harness」（`planRepair` 里这条检查在 `!header` 之前）
- `team/*` 在 known-types

## 本机事实

- GitHub：用 `gh`（keyring，账号 xiaoshenming，scopes `gist, read:org, repo, workflow`）；`~/.git-credentials` 本机不存在
- 推送代理：`127.0.0.1:7897` 实测可用（`px` 就是给它套代理）；`git -c http.version=HTTP/1.1 push` 直接过
- git 作者：全局 config 是 `xiaoshenming <1181584752@qq.com>`，仓库历史是 `Small明 <11856687+BFSYRGZbfsyrgz@user.noreply.gitee.com>` → 提交时用 `-c` 传仓库作者
- CI：GitHub Actions 只跑 `node fixtures/synthetic/build.mjs` + `node --test test/*.test.mjs` + secrets 检查，**不装依赖**（所以本机有 node_modules 时测试行为和 CI 可能分叉）
- **桌面端（2026-09-29 起用户的主环境）**：`/Applications/DeepSeek Harness.app`（Electron；本地 server 只监听 `127.0.0.1`，根路径要 token 才给，直接 curl 是 401）。它自带 `@deepseek-ai/dsh-web-frontend@0.2.0-rc.2`（比仓库 devDependency 的 0.1.7-rc.2 新一个 minor，但 `SESSION_FORMAT_VERSION` 仍是 4）；前端包和 `dsh-client-ui-*` 都在 `app.asar` 里（`/dsh/node_modules/@deepseek-ai/…`），要看真实样式/座位就从 asar 里解。
- 桌面端插件装在 `~/.dsh/profiles/desktop/node_modules/dsh-session-surgeon`（pnpm 按 `github:…#main` 解出的一份**没有 `.git` 的拷贝**；profile 的 `pnpm-lock.yaml` 里钉着具体 commit tarball）。**更新**＝插件页点更新，或 `cd ~/.dsh/profiles/desktop && pnpm update dsh-session-surgeon`；**不需要重启 `dsh web`**，也不要在那份拷贝里 `git pull`（它没有 `.git`）。
- **客户端座位 ABI（0.1.7-rc.2 与 0.2.0-rc.2 都有）**：`ctx.slots.inject('sidebar.panellist', …)` 交一行给壳（`{id, order, label}` + 图标组件，壳自己画行、管高亮/收起），`ctx.slots.inject('main', …)` 交 `{key}` 对应的页面；切换面板用 `layout.selectPanel(id|null)`（`null` 回会话）。原生行要 `data-dsh-panel-entry` 标记（皮肤 L2 契约）。老壳没有 slots 时走 `plugin/client.js` 里的 `mountOverlay` 兜底。
- **取服务的唯一稳妥写法是 `ctx.get(name)`（2026-10-02 实测 cordis 4.0.4）**：`ctx.<service>` 只有在插件自己的 `inject` 里声明过才合法，否则**直接抛** `cannot get property "layout" without inject` —— 即使服务确实已经提供。`dsh-client-ui-layout` 走 `ctx.reflect.provide("layout", …)`（不装 accessor），所以 0.2.0 上 `ctx.layout` 必抛：0.2.1 的「返回会话 / ⋯ → 用会话医生查看」两个按钮就是这么静默失效的。`ctx.get(name)` 是官方 optional lookup，声明与否都能拿到，缺服务时返回 `undefined` 而不抛。**不要为了用 `ctx.<service>` 就往 inject 里加**：inject 是**必需**服务（`ctx.get` 拿不到的会被 fiber 挂起等待，插件根本不激活），加了 slots/layout 就等于放弃老壳的 overlay 兜底。宿主半边（`plugin/index.mjs`）的 `inject = ["tools","webServer"]` 是声明过的，那里可以直接读。
- **客户端半边是 bundle factory（`window.__ModuleLoader__.load` + `factory(require)`），不是动态沙盒**：`require('react')` 是真模块表、`setTimeout` 等浏览器全局可用。动态沙盒（agent 现场写的包，`dsh-cordis-client-runner`）才会把 `setTimeout`/`fetch`/`require` 换成会抛的 teaching trap，并要求 `inject: ['timer']`。
- **不打扰用户就能验证「跑着的桌面端到底加载了什么」**（2026-10-03 实测）：① 宿主路由不需要 token —— `lsof -nP -iTCP -sTCP:LISTEN | grep DeepSeek` 拿端口，`curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:<port>/api/session-surgeon/scan` 返回 **200** 就说明宿主半边活着、路由注册了；② client bundle 走 `/plugins/??<id>/client.js&rev=<rev>`（combo 形式，**路径里必须有 `??`**，不带就 404），`rev = sha1("plugin-artifact"+"\0"+ 每段 `${byteLength}:${part}`)[:12]`，三段是 `String(mtimeMs)`/`String(ctimeMs)`/`String(size)`（`framedHash`/`artifactRevision`，来自 `dsh-client-modules/lib/index.js`）—— 拿 `statSync(<profile>/node_modules/dsh-session-surgeon/plugin/client.js)` 自己算一遍 rev 去 curl，返回的源码里 grep 新符号（如 `serviceOf`）就能证明「app 正在供修好的那一版」，而不是靠用户截图。
- 用户 checkout 常是 `link:`（`~/.dsh-surgeon-dev`）；本地改前端要重启 `dsh web` 才刷新。
- 2026-09-28 版本线：npm `latest`=**0.1.7-rc.2**（2026-09-27 从 `next` 提上来的）、`next`=0.1.7-rc.2（格式 v4，也是本仓库 devDependency 的 pin，见 `package.json`）、`alpha`=0.1.7-alpha.2。**提上 `latest` 不等于闸门消失**：从 0.1.5-rc.2 到 0.1.7-rc.2 三条闸门只有行号位移（`v2-to-v3:125` 照抛、`v0-to-v1:1584` 照拒 `!== 3`、`:278`+`:283` 照把 `user` 写死），所以回帖时**别把「升级到最新版」当解法**。rc.1 / rc.2 上 v0→v1/v2→v3 的闸门都在（descriptor / inserted / SOURCE_KINDS 无 `instruction-hint`），五行的悬空 call 表两版一致；行号以 tarball 为准：`dsh-session-format-v0-to-v1` 的 `subagentDescriptorValue` 声明 `:1289`、`literalValue(data["version"],[3])` 在 `:1290`、`data["version"] !== 3` 在 `:1584`、抛在 `:1586`（同一版本已安装副本与 tarball 字节一致）。升 pin 的方法：改 `package.json` 后 `pnpm install`，`pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude` 列表会跟着出现整片换行号——那是正常的重装产物，跟着一起提交即可
- 2026-09-29 版本线（新增）：npm 出现 **`next` = `0.2.0-rc.1`**（新 minor 线，`latest` 仍是 0.1.7-rc.2，`alpha` = 0.1.7-alpha.2）；`@deepseek-ai/dsh-session` / `-format` / `-persistence-jsonl` 都发了 0.2.0-rc.1。**但 `SESSION_FORMAT_VERSION` 在 0.1.7-rc.2 与 0.2.0-rc.1 里都是 4**（两版 `lib/index.js:56`）→ **代际没变**，不需要新的迁移分支；0.2.0 线上那些帖（#8181/#8182/#8183/#8184/#8186/#8187/#8189/#8190）目前都在 v4 的同一套闸门下
- 2026-10-03 版本线：`latest` = `next` = **0.2.0-rc.2**，新出现 **`alpha` = `0.2.1-alpha.1`**（`@deepseek-ai/dsh-session` / `-format-v3-to-v4` / `-persistence-jsonl` 都有）。**`npm pack @deepseek-ai/dsh-session@0.2.1-alpha.1` 解包实测 `SESSION_FORMAT_VERSION = 4`**（`lib/index.js:56`）→ 代际仍未变，不需要新分支；真要动 pin 时注意 `pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude` 会整片换行号
- **桌面端 0.2.0 还有一类「插件作者必读」的静默失效（#8438）**，与本仓库的磁盘合同无关但会咬前端：设置面从 `ctx.inject(['settings'])` + `settings.register(ns, schema)` 改成**导出 `Config`**（字段必须 `.volatile()`，否则 `volatileForm` 逐个丢、丢空后整个命名空间消失）；客户端从 `settingsScope.bind()` 改成 `ctx.configForms.get(ns)`；卡片插槽从 `settings.plugin.item` 改成 `plugins.item` / `settings.plugins.tab`；`dsh.client.inject` 必须声明用到的客户端模块，否则 apply 可能根本不执行（零报错）。我们自己的 `settingsCopy`（两个半边都导出的那段文案）在 0.2.0 已经**无人消费**，是旧契约的残留；`dsh.client.inject` 里那四个模块名（slots / layout / sidebar / settings）在 0.2.0-rc.2 包内都存在，已核
- 格式代际：header v0–v4 都能 inspect/repair；`session.vN.jsonl.zstd` 由官方迁移，surgeon 不改代际
- 会话根解析：`$DSH_SESSION_ROOT` → `$DSH_HOME/sessions` → `~/.dsh/sessions`；本机两个 home：`~/.dsh`（**桌面端主库**，有会话、profile 里装了本插件）与 `~/.dsh-surgeon-dev`（本地 `link:` 开发库，也有会话和插件）
- **目录层级**：`listSessionFiles` 要求 `<root>/<project>/<session-dir>/session[.vN].jsonl.zstd` **两层**，直接放 `<root>/<session-dir>/` 会被静默跳过（`scan` 报 `count: 0`）。造 fixture 验证 CLI 时先摆对层级
- **CLI 参数位置**：`scan [root]` / `inspect <id> [root]` / `repair <id> [root]` —— root 是**位置参数**，没有 `--root`（写成 `--root X` 会被当成路径，报 `cannot read session root --root`）
- 面板「会话根」下拉：`GET /api/session-surgeon/roots` 按 home 形态自动发现（`profiles`/`.anonymous-user-id`/`.credentials.yaml`/`settings.yaml*` 任一 + `sessions/`），带会话数，支持手输任意路径（`~` 会展开）；所有单会话请求都带 `root`，切根后 inspect/repair/export 才落在正确的库上
- 「面板一条会话都没有」的第一诊断：`curl -s http://127.0.0.1:<port>/api/session-surgeon/scan`，看返回的 `root`/`error`（host 的 `DSH_HOME` 决定默认根）；`/roots` 列全部候选
