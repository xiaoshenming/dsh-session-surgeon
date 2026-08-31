---
name: dsh-session-surgeon-update
description: |
  Self-iterate dsh-session-surgeon from community feedback. Use immediately when the user says 更新插件, 更新一下插件, 自我迭代, 逛逛社区, 再看看社区, 查社区然后更新, update the plugin, absorb community feedback, or asks you to scan DeepSeek Harness discussions and update this plugin without spelling out the steps. Also use when they want you to reply on relevant threads, changelog, and push to origin/main. Do not use for repairing a specific local session file, copying a session ID, or unrelated DSH bugs (sandbox, models, Feishu).
---

# 更新插件 — dsh-session-surgeon 自我迭代

用户只说「更新插件」时，不要再问流程。加载本技能后直接执行：扫社区 → 判断该不该改代码 → 改 / 测 / 写 CHANGELOG → 对口回复 → 用 px 推 `origin/main` → 用中文汇报。

仓库：`/home/ming/data/Project/DSHProject/dsh-session-surgeon`
远程：`xiaoshenming/dsh-session-surgeon` `main`
安装：`dsh plugin --profile web add "github:xiaoshenming/dsh-session-surgeon#main"`

默认简体中文。危险操作用 `danger-full-access`。PTC 模式只从 `run_code` 调工具。

## 触发词（任一即跑整条，不必用户再解释）

更新插件 / 更新一下插件 / 自我迭代 / 逛逛社区 / 再看看社区 / 查社区然后更新 / update the plugin / absorb community feedback

## 合同（不可破）

修磁盘上官方 loader 拒读的 `session.jsonl.zstd`。默认 dry-run；`--apply` 先 `.bak.<utc>`。

**永不：**

- 发明缺失 seq、空 callId、假 `tool/result`
- 给未知插件事件盖 `ignorable`
- 把 Alpha `sourceEventSeqs` 区间展开成 rc.2 扁平整数（伪迁移）
- 在认不出签名时任意双写选边
- 上传真实 `~/.dsh/sessions`
- 把 `@deepseek-ai/*` 打进 runtime dependencies
- 刷屏式硬广；只回真正对口、尚未说过的帖
- 改官方 React 菜单；只 DOM 注入
- 把 TUI Admission / dsh-ecosystem-spec 当成官方 web 插件 ABI

**营销主路径**仍是会话 ⋯ → 复制会话 ID；repair 是第二条。

## 工作流（按序，不要跳）

### 1. 目标

若当前会话还没有同一目标，`create_goal`：扫社区、吸收对口反馈、必要时代码+测试+CHANGELOG、回复、px 推送。不要为闲聊建目标。

### 2. 扫社区（先读，再改）

用 `~/.git-credentials` 里 github.com 的 `x-access-token`（写入 `/tmp/dsh-gh.token`，用完删）。GraphQL 在 git://github.com 挂掉时仍可用。

必看：

1. participating + unread notifications（`deepseek-ai/deepseek-harness` 与本仓库）
2. 我们回过的帖的新评论 / 回复：至少 #1586 #1497 #5151 #5160 #5142 #5103 #4178 #1452 #4819 #4767 #4127
3. 官方 Discussions 按更新时间，关键词：`seq gap` `corrupt session` `session.jsonl` `message.id` `tool/call` `无法加载` `历史加载失败` `拒读` `torn` `zstd` `surgeon` `会话医生` `callId` `sourceEventSeqs` `start Match`
4. 本仓库 Issues / 评论

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

质量门槛（自我 review ≥95 才推）：

- 全绿；无 TODO/FIXME；无 secrets；零 runtime deps
- 新模块保持小；`src/decode.mjs` 等核心文件尽量 ≤300 行
- GUI 文案：`plugin/client.js` 的 HEALTH 映射要覆盖新 health code
- 不扩 scope 到 compact 插入 `compaction/summary`、编假 callId、改官方菜单

CHANGELOG.md 记用户可见变化，链到 Discussion 编号。README / README.zh.md / REPAIR-SPEC 只在行为变化时改。

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

提交说明写清行为和 Discussion 号。作者已是 Small明 则不要改 git user。

推完核对 `git rev-parse HEAD origin/main` 一致。

### 6. 收尾汇报（中文，短）

- 扫了哪些帖 / 通知
- 吸收了什么（commit SHA + 测试）
- 回复了哪些链接
- 故意没改什么
- 本地 `link:` 要重启 `dsh web`；`github:…#main` 要再 add 一次

把相关 DSH 通知 PATCH 已读。删除 `/tmp/dsh-gh.token`。目标完成才 `update_goal complete`。

## 已知形状（已实现，不要当新 bug 重做）

- 缺 `message.id` → 只补 id
- 悬空 `tool/call` → inspect 警告，不编结果
- #5182 空 `tool_calls[].id` → inspect `empty-tool-call-id`，不编 callId（根因是引擎出栈过滤）
- Windows bak `fsync` EPERM → `fsyncBestEffort`
- #1586 live-writer-tail：丢掉崩溃恢复闭包，保住还活着的写者
- #5151 packed-overlap-suffix：前缀必须与已提交事件一致才接下后缀
- #5160 newer-format-ranges：Alpha 区间 refuse，不伪迁移
- compact：seq 不连续 / 官方拒读则 refuse
- `team/*` 在 known-types

## 本机事实

- GitHub token：`~/.git-credentials` `x-access-token`
- 推送代理：`px` → `127.0.0.1:7897`
- 用户 checkout 常是 `link:`；overlay 文案要重启 web 才更新
