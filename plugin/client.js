window.__ModuleLoader__.load({
  id: "dsh-session-surgeon",
  factory: (require) => {
    const API = "/api/session-surgeon";
    const ACTIVE = "data-dsh-surgeon-active";
    const EVENT = "dsh-panel-activate";
    const PANEL_ID = "session-surgeon";
    const PANEL_ORDER = -10;
    // dsh-i18n local patch: UI copy now follows the app locale (zh / en / nl).
    // Texts are looked up through T()/H() below; the module subscribes to the
    // locale service and re-renders live on switch.
    const COPY = {
      zh: {
        s: {
          "panel.title": "会话医生",
          "panel.sub": "点一条就能看对话。有 session- 前缀和没有前缀是同一种文件，不是两种会话。",
          "scan": "刷新列表",
          "close": "关闭",
          "page.back": "返回会话",
          "pickHint": "点左边一条看对话。每个工作区各自存一套会话；有 session- 前缀和没有前缀只是新旧 ID 写法不同。",
          "repairHint": "只有打不开时，才需要「先看会改什么 / 修好」。",
          "emptyScan": "还没有扫描结果",
          "scanRoot": "扫描目录",
          "emptyHint": "会话不在这个目录时：插件按本机 harness 的 DSH_HOME 找会话（默认 ~/.dsh/sessions），也可以用 DSH_SESSION_ROOT 指定。",
          "rootLabel": "会话根",
          "sessionUnit": "会话",
          "rootMissing": "目录不存在",
          "rootOther": "其它目录…",
          "rootPrompt": "输入会话目录（绝对路径或 ~/…）",
          "rootSwitched": "默认根没有会话，已切到 {root}（{n} 条）",
          "loadingChat": "正在读对话…",
          "chatFail": "读对话失败：",
          "chatEmpty": "这个文件里还没有可读的用户/助手消息。",
          "omitted": "更早的 {n} 条已省略。",
          "whoUser": "你",
          "whoAssistant": "助手",
          "cwd": "工作区：",
          "copyIdBtn": "复制这个 ID",
          "actInspect": "用人话检查",
          "actRepair": "先看会改什么",
          "actApply": "修好这个会话",
          "actExport": "导出备份",
          "busy": "处理中…",
          "detailDefault": "下面是这个会话里的对话。",
          "tech": "技术细节",
          "techEmpty": "还没有详细结果",
          "busyScan": "正在列出本机会话",
          "busyInspect": "正在检查",
          "busyRepairPreview": "先看会改什么",
          "busyRepairApply": "正在写回文件",
          "busyExport": "正在导出备份",
          "exported": "已下载备份 ",
          "reqFail": "请求失败：{msg}。若是 not found，先重启 dsh web。",
          "toast.pickFirst": "先在左边选一个会话",
          "toast.noCopyId": "没有可复制的会话 ID",
          "toast.copied": "已复制 ",
          "toast.noId": "读不到会话 ID",
          "confirm.apply": "将改写这个会话文件，并先留一份 .bak 备份。确定？",
          "explain.error": "出错了：",
          "explain.refuse": "现在不能修：",
          "explain.wrote": "已经写回磁盘（先留了 .bak）。",
          "explain.willDo": "还没改文件。若点「修好这个会话」，会做：",
          "explain.rewrite": "- 重写文件",
          "explain.noFix": "检查过了，这个文件不用修。",
          "explain.sessions": "点左边一条就能看对话。有 session- 前缀和没有前缀是同一种会话。",
          "explain.title": "标题：",
          "explain.count": "共 {n} 条可读消息。",
          "workspaceUngrouped": "未分组",
          "sidebar.aria": "会话医生",
          "sidebar.title": "查看会话内容，或修好打不开的会话",
          "menu.copyId": "复制会话 ID",
          "menu.view": "用会话医生查看",
          "hint.default": "把右侧技术细节发给我。",
          "settings.title": "Session surgeon / 会话医生",
          "settings.description": "点开一条看对话；会话打不开时再检查和修好磁盘文件。",
          "settings.body": "会话医生：有 session- 前缀和没有前缀是同一种会话。\n最常用：会话 ⋯ → 复制会话 ID。\n安装 / 更新：DSH 桌面端「插件」页添加或更新 github:xiaoshenming/dsh-session-surgeon#main，不用重启。\nAgent tools: session_scan / session_inspect / session_repair (apply defaults to false)."
        },
        h: {
          "ok": ["正常", "文件完好，日常聊天不用动。"],
          "header-ok": ["正常", "文件头完好，日常聊天不用动。"],
          "raw-jsonl": ["未压缩", "明文日志，一般仍能打开。"],
          "orphan-tmp": ["残留临时文件", "有 .tmp，没有正式会话文件。"],
          "header-frame-corrupt": ["文件头损坏", "官方会拒绝打开。通常只能找备份。"],
          "header-frame-multiline": ["首帧把正文也装进去了", "整份日志被压成了一帧，表头行只是那一帧的第一行。内容一条没丢，但读取端第一件事就是断言「首帧恰好只有一行表头」，整条会话打不开（#10440 里 13 个坏会话有 12 个是这个形状，来自离线补标题脚本的重写）。修复把表头行单独写回第一帧，正文逐行原样保留 —— 不动任何事件、seq 与内容。"],
          "header-parse-error": ["文件头读不懂", "第一帧不是合法的 header 行。官方会拒绝打开，修复不会猜它原本写的是什么。"],
          "foreign-version": ["代际比本机新", "文件是比本机 harness 更新的格式版本。升级 harness，本工具不会替你降级或改写代际。"],
          "retired-fields": ["文件头带退役字段", "header 里有官方已移除的策略字段。修复不猜该保留哪些，只报告。"],
          "no-zstd-frame": ["空文件", "里面没有完整数据。"],
          "failed-middle-frame": ["中间一帧坏了", "工具不会瞎补，避免越修越坏。"],
          "seq-gap-committed": ["中间缺了一段", "官方打不开。崩溃恢复短闭包会丢掉并保住后面真内容；packed 行前缀一致则接上后缀；否则裁到上一完整回合。"],
          "seq-gap-tail": ["结尾不完整", "写入中断了。修复会丢掉脏尾巴。"],
          "torn-tail": ["尾帧撕裂", "最后一帧写到一半就断了。修复丢掉这半帧，保住前面已提交的内容。"],
          "zero-fill-tail": ["尾部全是 0 字节", "崩溃落在 write() 与 fsync() 之间：文件长度落盘了、帧数据没落盘，那段读回来全是 0（NTFS ValidDataLength / XFS、ext4 延迟分配）。官方读盘会整条判 corrupt 报 invalid frame magic，其实前面每一帧都完好（#9372）。修复丢掉这些 0 字节，已提交内容一个不动。"],
          "packed-overlap-suffix": ["packed 行重叠", "丢掉已提交且与原文一致的前缀，保住后面连续内容。"],
          "newer-format-ranges": ["区间格式", "sourceEventSeqs 被压成 [start,end]。本机 harness 还不会展开，修复会写成密集整数。0.1.2-rc.1 起官方已能直接打开，不必改文件。"],
          "unparsable-line": ["有一行读不懂", "修复会丢掉读不懂的尾巴。"],
          "message-missing-id": ["消息缺 ID", "官方会整段拒读。修复只补 id，不丢内容。"],
          "llm-retry-chain": ["重试链编号断了", "同一条 policy 链（turn/step/provider/policyKey）里的 llm/retry 必须逐次 +1，且一条链只用一个 retryId。写入方丢失链状态时会每条都写 retry: 1 加一个新 id，官方校验器整份拒读（`llm/retry skips its policy attempt sequence`，表现为 stored session is corrupt，而且写入时静默、要等下次打开才暴露，#9163）。两个值都能从日志本身还原：次数是该链内的顺序，id 是该链第一个 id —— 修复照这个重编号，还原不出来时拒绝写。"],
          "lone-surrogate": ["孤立代理字符", "历史里有不成对的 UTF-16 代理字符（典型来源：把二进制按 utf16le 解码）。JSON.stringify 把它写成 \\udXXX 转义，服务端解析请求体直接 400 —— 之后每一轮请求都失败，而文件本身照样能加载，所以界面上看不到原因（#8466）。修复把每个孤立代理换成 U+FFFD，正文其余部分与 seq 不动；若代理出现在 header 里则只报告（header 写着这份日志所在的目录，不能就地改写）。"],
          "empty-tool-call-id": ["空工具调用 ID", "文件能打开，但下次请求会 400（id cannot be empty）。只定位，不会编假 callId。根因在引擎出栈过滤。"],
          "duplicate-tool-call-id": ["重复工具调用 ID", "同一步里多次通告同一个 callId。0.1.3 起 v0→v1 迁移会拒读（#5909）。修复只给后出现的 id 加 #n 后缀，不编空 id。"],
          "legacy-replay-state": ["旧 replayState", "pi-ai 把 {kind,...} 写在 replayState 根上。0.1.3 迁移只认 {response,blocks}（#5694/#5909）。修复只把原字段挪进 response，不编内容。"],
          "v0-preset-extra-member": ["权限事件多余字段", "旧版写入的 permission/preset 带了 origin 等多余成员，0.1.5 迁移拒读（#6189）。修复只保留 preset，权限设置不变。"],
          "v0-descriptor-version": ["子代理描述版本", "subagent/descriptor 的 version 不是 3，0.1.5 迁移拒读（#6151）。两种版本字段相同，修复改成 3。"],
          "v0-plugin-source-form": ["插件消息来源形态", "插件消息来源的 summary/sections 与 form 不匹配，0.1.5 迁移拒读（#6194）。修复只补 form 或去掉展示用的 summary，不改正文。"],
          "v0-chunk-provenance": ["分块溯源不完整", "assistant/message 引用的分块不是同一轮的完整有序一段：v0→v1 与 v1→v2 两道迁移都会拒读（#6175 / #7824，最常见的是声明范围把 session/end-seed 之类的非分块事件也扫了进去）。修复改成引用磁盘上已有的分块序号，不发明。"],
          "v0-retired-source-kind": ["退役的来源类型", "消息 source.kind 是已退役的字面量（如 instruction-hint），0.1.5 的 v2→v3 迁移按未分类拒读（#6559）。键集与新的 plugin 形态相同，修复只改名。"],
          "v0-inbox-inserted-message": ["插入消息缺字段", "agent/inbox/spliced 插入的消息缺 id/role，v0→v1 转换器拒读（#6559）。修复补 id 与校验器自己写死的 user 角色，正文不动。"],
          "v0-missing-member": ["缺必需成员", "事件类型还在，但释放版 v0 清单要求的成员没了 —— 截断或半写日志留下的典型样子。v0→v1 的 payload 闸门为一行就拒整条会话，报「… lacks required member \"x\"」。成员内容在工件里恢复不出来 —— 只报告，不补。"],
          "invalid-settlement-fields": ["结算字段非法", "assistant/message 或 assistant/attempt 的 turn/step 不是非负安全整数（-0 也算非法）或 stream 不是数组：seed/restore 闸门（dsh-session 构造 Session 时校验它拿到的事件，读一份已存日志也会走到这里）为一行就拒整条会话，报「seed assistant/message at index N has invalid settlement fields」（#8084）。写入侧当时不校验这三个字段，所以坏行要到下次加载才暴露。**可以修**：turn/step 不是猜的 —— 日志本身就写明该 seq 处开着哪个 turn/step，而那正是这行所属的值；stream 承载的流式分块已经丢了，补不回来，但空数组是唯一被接受的值（assertCurrentAssistantStreams 展开为空就跳过 content/usage/replayState 的比对），正文、usage 与 replayState 都不动。"],
          "descriptor-catalog-fact": ["子代理描述符进不了目录", "v3→v4 的子目录路径只认一个自己的 subagent/descriptor，且要求 provider 是字符串、version≠1 时 mode ∈ {continuable, one-shot}、有效 mode 为 continuable 时（含所有 version 1 的行）label 必须是字符串，否则整条会话拒读（#7995）。mode 是真实属性、label 是自由文本，离线都补不出来 —— 只报告。只在 v1–v3 上检查（v4 不再走这条迁移），且只对未继承前缀的子代理子会话下判定（继承切点不在盘上，猜不得）。"],
          "producer-source-invalid": ["消息来源不合规", "消息 source 缺失/不是对象，或 kind 缺失、为空、不是字符串、与该槽位要求的 kind 不符（system/message 要 system-prompt、assistant/message 要 model、tool/result 要 tool）。v4 准入会因此整份拒读，而正确值在工件里没有唯一答案 —— 只报告，不猜。"],
          "v4-literal-plugin-source": ["v4 插件来源字面量", "消息 source 还是退役的 {kind:\"plugin\"} 包装；v4 要求 producer 自己的 kind，官方读盘会整份拒收（#7772）。修复写入官方 v3→v4 阶段为该包名推出的 kind（改名表 + plugin:<名> 兜底），其余成员原样保留；plugin 不是字符串的 source 不动。"],
          "dangling-tool-call": ["悬空工具调用", "它的 step 已经闭合却没有 tool/result。下次模型请求会永久 400；在 0.1.7 上整条会话可能根本打不开 —— v3→v4 的 restore 与读一份已存的 v4 日志都会因此拒收。结果只能补在还开着的 step 里，离线补不了 —— 只定位，不编假 tool/result。"],
          "prune-tail-outside-turn": ["空闲压缩尾巴", "工具结果修剪器在空闲时（没有开着回合）追加了 replacement tool/result，官方读盘会在 requireTurn() 上整份拒读：「tool/result is outside an open turn」（#8812）。这些行只是遮蔽既有 surface 节点的元数据，修复裁回它跟随的那个 turn/end，不丢消息、回合或工具结果。"],
          "step-after-turn-end": ["回合关了还在继续", "turn/end 之后同一回合的 step 事件还在写入（replacement tool/result 例外：官方折叠对它只查「有没有开着回合」，不比对 turn/step）：官方关系校验（v1→v2 对转换后的工件跑 v0→v1 的 assertReleasedArtifactRelationships）会整份拒读，报「<类型> does not match an open turn and step」（#7824）。合并还是拆分这个回合在工件里没有唯一答案，拆分还要重编号后面所有 seq —— 只报告，不改文件。"],
          "turn-step-mismatch": ["回合/步骤配对不连续", "turn/start、step/start、step 事件或 turn/end 携带的 turn/step 不是官方 walker 期望的那一对：walker 要求 turn/start 开出预期的下一回合、step/start 是开着回合的下一步、每个 step 事件都带开着的那一对、turn/end 对上开着的回合且没有开着的 step。读一份已存的 v4 日志会整份拒读，报「<类型> does not match an open turn and step」（或 turn/start、step/start、turn/end 各自的说法）。中途重编号在工件里没有唯一答案（compact 能重编号，是因为切片边界定义了答案），而且还要重编号后面所有 seq 与声明范围 —— 只报告，不改文件。"],
          "title-references-invalid": ["标题引用的消息对不上", "session/title 的 messageSeqs 有两条折叠规则：**用户标题必须留空**（原文 session/title messageSeqs must be empty exactly for a user title），其余标题的每条引用都必须是**更早、去重、由真人发出的** user/message（data.source.kind 必须是 user，runtime-context / team-message 都不算；原文 must cite distinct earlier human user/message events）。两条任一不满足，整条会话读盘即拒（#10440 变体 C：离线补标题脚本按「离标题最近的若干事件」凑引用，10 条指到了 step/start）。修复只做确定的事：用户标题的引用清空，指向不了真人消息的引用逐条丢掉；非用户标题一条合法引用都不剩时，它究竟来自哪些消息无法重建 —— 只报告。"],
          "ptc-dispatch-invalid": ["PTC 子调用身份不成立", "`run_code` 的子调用 id 是 `<父 callId>:ptc:<n>`，**两半都可以在同一会话里重复**：provider 会在助手重复一次调用时重发父 id，而 n 每次 `execute()` 都从 1 重来。子调用活过了它所在的 step（轮询后台任务最典型）就正好凑出这个形状 —— 同一个父 id、计数器回到 1、第二条 `tool/ptc-dispatch-start` 落在一个已经结算的子调用 id 上（#9677：真实 3569 事件的会话从此永久打不开）。写入侧不拦，读盘时由关系折叠整份拒读（「PTC dispatch repeats subCallId」「PTC dispatch does not match its start」「PTC rootCallId requires a nonempty string」「PTC parentCallId does not belong to rootCallId」等），而读盘是全有或全无 —— 重复一次赔掉整条会话。id 本该怎么写恢复不出来 —— 只报告，不改文件。"],
          "surface-replacement-invalid": ["surface 替换链断了", "带 surfaceOp 但不是 append 的 surface 行（system/user/developer/assistant/message、tool/result）必须点名一段**当前就在 surface 上**的范围、用 sourceEventSeqs 恰好列出它遮蔽的那些行，也不能遮蔽受保护的系统头。官方读盘在第一条不满足的行就整份拒读（「<类型> replacement range is not on the current surface」「replacement sourceEventSeqs omit a shadowed surface node」，seed 侧同一条行报「surface replace: start seq <n> not found in surface」）。startSeq/endSeq 一旦指不动了，它本来想遮蔽哪一段在工件里恢复不出来 —— 只报告，不改文件。"],
          "tool-result-invalid": ["工具结果对不上调用", "tool/result 的 message.toolCallId 不是非空字符串、与 message.source.callId 不一致、不在本步通告过的调用里，或者它的 surfaceOp 不是对象（replacement 形态）。官方 walker 会整份拒读，报「tool/result <id> has no advertised tool lifecycle」「tool call id requires a nonempty string」或「tool/result surfaceOp requires an object」。结果对应哪个调用在工件里恢复不出来 —— 只报告，不改文件。"],
          "turn-end-while-step-open": ["回合结束时有 step 未关", "turn/end 落在某个 step 的 step/end 之前：官方校验报「turn/end <n> crosses an open step」，写者侧 dsh-session/lib/invariant.js 是同一条规则（#7824）。只报告，不改文件。"],
          "unknown-type": ["未知事件类型", "会报告，不会删行，也不会盖 ignorable。"]
        }
      },
      en: {
        s: {
          "panel.title": "Session surgeon",
          "panel.sub": "Click a session to read the conversation. Files with and without the session- prefix are the same kind of file, not two kinds of sessions.",
          "scan": "Refresh list",
          "close": "Close",
          "page.back": "Back to chat",
          "pickHint": "Click a session on the left to read it. Each workspace keeps its own set of sessions; with or without the session- prefix is just an old/new ID spelling.",
          "repairHint": "Only when a session will not open do you need the “preview repair / repair” actions.",
          "emptyScan": "Nothing scanned yet",
          "scanRoot": "Scanned root",
          "emptyHint": "If your sessions live elsewhere: the plugin follows the host's DSH_HOME (default ~/.dsh/sessions); set DSH_SESSION_ROOT to point somewhere else.",
          "rootLabel": "Session root",
          "sessionUnit": "sessions",
          "rootMissing": "missing",
          "rootOther": "Other directory…",
          "rootPrompt": "Session directory (absolute or ~/…)",
          "rootSwitched": "The default root had no sessions; switched to {root} ({n})",
          "loadingChat": "Reading conversation…",
          "chatFail": "Could not read the conversation: ",
          "chatEmpty": "This file has no readable user/assistant messages yet.",
          "omitted": "{n} earlier messages omitted.",
          "whoUser": "You",
          "whoAssistant": "Assistant",
          "cwd": "Workspace: ",
          "copyIdBtn": "Copy this ID",
          "actInspect": "Inspect in plain words",
          "actRepair": "Preview what would change",
          "actApply": "Repair this session",
          "actExport": "Export backup",
          "busy": "Working…",
          "detailDefault": "Below is the conversation in this session.",
          "tech": "Technical details",
          "techEmpty": "No detailed result yet",
          "busyScan": "Listing local sessions",
          "busyInspect": "Inspecting",
          "busyRepairPreview": "Previewing changes",
          "busyRepairApply": "Writing file back",
          "busyExport": "Exporting backup",
          "exported": "Downloaded backup ",
          "reqFail": "Request failed: {msg}. If it says not found, restart dsh web first.",
          "toast.pickFirst": "Select a session on the left first",
          "toast.noCopyId": "No session ID to copy",
          "toast.copied": "Copied ",
          "toast.noId": "Could not read the session ID",
          "confirm.apply": "This will rewrite the session file and keep a .bak backup first. Continue?",
          "explain.error": "Error: ",
          "explain.refuse": "Cannot repair right now:\n",
          "explain.wrote": "Written back to disk (a .bak was kept first).",
          "explain.willDo": "No file change yet. If you click “Repair this session”, it will:\n",
          "explain.rewrite": "- rewrite the file",
          "explain.noFix": "Checked: this file needs no repair.",
          "explain.sessions": "Click a session on the left to read it. With and without the session- prefix is the same session.",
          "explain.title": "Title: ",
          "explain.count": "{n} readable messages in total.",
          "workspaceUngrouped": "Ungrouped",
          "sidebar.aria": "Session surgeon",
          "sidebar.title": "View session content, or repair sessions that will not open",
          "menu.copyId": "Copy session ID",
          "menu.view": "View with session surgeon",
          "hint.default": "Send me the technical details on the right.",
          "settings.title": "Session surgeon / 会话医生",
          "settings.description": "Click a session to read it; check and repair disk files when a session will not open.",
          "settings.body": "Session surgeon: files with and without the session- prefix are the same kind of session.\nMost used: session ⋯ → Copy session ID.\nInstall / update: on DSH Desktop the Plugins page adds or updates github:xiaoshenming/dsh-session-surgeon#main; no restart needed.\nAgent tools: session_scan / session_inspect / session_repair (apply defaults to false)."
        },
        h: {
          "ok": ["OK", "File is intact; daily chat needs no action."],
          "header-ok": ["OK", "File header is intact; daily chat needs no action."],
          "raw-jsonl": ["Uncompressed", "Plain-text log; usually still opens."],
          "orphan-tmp": ["Leftover temp file", "A .tmp exists with no real session file."],
          "header-frame-corrupt": ["Corrupt file header", "The official loader will refuse it. Usually only a backup can help."],
          "header-frame-multiline": ["The header frame swallowed the body", "The whole log was compressed into a single frame, so the header line is only that frame's first line. Nothing was lost, but the reader's first check is that the first frame is exactly one header line, and it refuses the entire session over that boundary (12 of 13 damaged sessions in #10440 came from an offline retitle script). Repair writes the header line into its own frame and keeps every body line byte-for-byte — no event, seq or content is touched."],
          "header-parse-error": ["Unreadable file header", "The first frame is not a valid header line. The official loader refuses it, and repair does not guess what it used to say."],
          "foreign-version": ["Newer than this harness", "The file is a format version newer than the installed harness. Upgrade the harness; this tool does not downgrade or rewrite the generation."],
          "retired-fields": ["Header carries retired fields", "The header has policy fields the official build removed. Repair does not guess which to keep; it only reports."],
          "no-zstd-frame": ["Empty file", "No complete data inside."],
          "failed-middle-frame": ["Broken middle frame", "The tool will not invent data, to avoid making it worse."],
          "seq-gap-committed": ["Gap in the middle", "The official loader cannot open it. Crash-recovery short closers are dropped while the real tail is kept; packed rows with a matching prefix get their suffix stitched on; otherwise it truncates to the last complete turn."],
          "seq-gap-tail": ["Incomplete ending", "The write was interrupted. Repair drops the dirty tail."],
          "torn-tail": ["Torn final frame", "The last frame stopped mid-write. Repair drops that half frame and keeps everything already committed."],
          "zero-fill-tail": ["Zero-filled tail", "The crash landed between write() and fsync(): the file's length reached disk but the frame data did not, so that region reads back as zeros (NTFS ValidDataLength, XFS/ext4 delayed allocation). The official reader calls the whole log corrupt (invalid frame magic) even though every committed frame before it is intact (#9372). Repair drops the zeros and touches nothing else."],
          "packed-overlap-suffix": ["Overlapping packed row", "Drops the committed prefix that matches the original and keeps the continuous content after it."],
          "newer-format-ranges": ["Range format", "sourceEventSeqs was packed into [start,end]. This harness cannot expand them; repair writes dense integers. 0.1.2-rc.1+ opens the file natively — leave it alone."],
          "unparsable-line": ["Unreadable line", "Repair drops the unreadable tail."],
          "message-missing-id": ["Message missing ID", "The official loader rejects the whole section. Repair only fills ids; nothing is dropped."],
          "llm-retry-chain": ["Retry chain out of sequence", "Inside one policy chain (turn/step/provider/policyKey) every llm/retry must be the previous attempt + 1, and the chain keeps one retryId. A writer that loses the chain state stamps retry: 1 with a fresh id each time, and the official validator refuses the whole log (`llm/retry skips its policy attempt sequence`, surfacing as stored session is corrupt — silently, only when the session is next opened, #9163). Both values come back out of the log: the attempt is the row's position in its chain and the id is the chain's first id. Repair renumbers accordingly and refuses when they are not recoverable."],
          "lone-surrogate": ["Lone surrogate", "The history carries an unpaired UTF-16 surrogate (typically binary decoded as utf16le). JSON.stringify writes it as a \\udXXX escape and the provider rejects the whole request body with 400, so every later request fails while the file itself still loads — which is why the UI shows no reason (#8466). Repair replaces each lone surrogate with U+FFFD and leaves the rest of the text and the seqs untouched; a surrogate in the header is only reported, because the header names the directory this log lives in."],
          "empty-tool-call-id": ["Empty tool-call ID", "The file opens, but the next request 400s (id cannot be empty). Only located, no fake callId is invented. Root cause is in the engine's stack filtering."],
          "duplicate-tool-call-id": ["Duplicate tool-call ID", "The same callId is advertised twice in one step. 0.1.3+ v0→v1 migration refuses the session (#5909). Repair suffixes later ids with #n; empty ids are never invented."],
          "legacy-replay-state": ["Legacy replayState", "pi-ai stored {kind,...} at the replayState root. 0.1.3 migration only admits {response,blocks} (#5694/#5909). Repair moves existing keys under response; nothing is invented."],
          "v0-preset-extra-member": ["Extra permission member", "Legacy permission/preset events carry extra members like origin; the 0.1.5 migration refuses them (#6189). Repair keeps only preset — the effective permission is unchanged."],
          "v0-descriptor-version": ["Subagent descriptor version", "subagent/descriptor data.version is not 3, which the 0.1.5 migration refuses (#6151). Both versions share the same member shape; repair sets 3."],
          "v0-plugin-source-form": ["Plugin source form", "A plugin message source pairs summary/sections with the wrong form; the 0.1.5 migration refuses (#6194). Repair adds the matching form or drops the display-only member — body text is untouched."],
          "v0-chunk-provenance": ["Incomplete chunk provenance", "An assistant/message cites chunks that are not one complete ordered attempt; both the v0→v1 and the v1→v2 migration refuse it (#6175 / #7824 — typically a declared range swallowed a non-chunk event such as session/end-seed). Repair cites the chunk seqs already on disk — nothing invented."],
          "v0-retired-source-kind": ["Retired source kind", "A message source.kind is a retired literal (e.g. instruction-hint); the 0.1.5 v2→v3 migration refuses it as unclassified (#6559). The member set matches the current plugin shape, so repair renames the kind only."],
          "v0-inbox-inserted-message": ["Inserted message fields", "An agent/inbox/spliced inserted message lacks id/role, which the v0→v1 converter refuses (#6559). Repair fills an id and the validator's own user role; body text is untouched."],
          "descriptor-catalog-fact": ["Subagent descriptor cannot join the catalog", "The v3→v4 child-catalog path accepts exactly one own subagent/descriptor, and requires a string provider, a mode of continuable or one-shot when version is not 1, and a string label whenever the effective mode is continuable (which includes every version 1 row); otherwise the whole session is refused (#7995). The mode is a real property and the label is free text, so neither can be invented offline — reported only. Checked on v1–v3 only (a stored v4 log no longer runs that migration), and only for an unseeded subagent child: the inherited cut is not on disk, so it is never guessed at."],
          "v0-missing-member": ["Missing required member", "The event type survived but a member the released v0 inventory requires did not — the shape a truncated or half-written log leaves behind. The v0→v1 payload gate refuses the whole session over one such row, naming it as \"… lacks required member \\\"x\\\"\". The member cannot be recovered from the artifact — reported only, never filled in."],
          "invalid-settlement-fields": ["Invalid settlement fields", "An assistant/message or assistant/attempt row carries a turn/step that is not a non-negative safe integer (-0 counts as invalid) or a stream that is not an array. The seed/restore gate (dsh-session validating the events a Session is built from, which an ordinary read of a stored log reaches) refuses the whole session over one such row with \"seed assistant/message at index N has invalid settlement fields\" (#8084). The writer did not check these three at append time, so the row only surfaces on the next load. **It is repairable**: turn/step is not a guess — the log states which turn and step are open at that seq, and that is the value the row belongs to; the streamed blocks behind stream are already gone, but an empty array is the one admissible value (assertCurrentAssistantStreams expands it to nothing and skips its content/usage/replayState comparison), and the message, usage and replay state are left untouched."],
          "producer-source-invalid": ["Message source the reader refuses", "The message source is missing or not an object, or its kind is absent, empty, not a string, or not the kind the slot demands (system/message wants system-prompt, assistant/message wants model, tool/result wants tool). Format v4 admission refuses the whole log over this, and the correct value has no unique successor inside the artifact — reported only, never guessed."],
          "v4-literal-plugin-source": ["v4 plugin source literal", "A message source still carries the retired {kind:\"plugin\"} wrapper. Format v4 requires a producer-owned kind and this harness refuses the whole log on read (#7772). The repair writes the kind the released v3→v4 stage derives for that package name (its rename table plus the plugin:<name> fallback) and keeps every other member; a source whose plugin is not a string is left alone."],
          "dangling-tool-call": ["Dangling tool call", "The call's step closed without a tool/result. The next model request will 400 forever, and on 0.1.7 the session may not open at all: both the v3→v4 restore and an ordinary read of a stored v4 log refuse it. The result can only be written while the step is open, so an offline tool reports it and never invents one."],
          "prune-tail-outside-turn": ["Idle prune pass outside a turn", "The tool-result pruner appends replacement tool/result rows while no turn is open, and the released reader routes every non-append tool/result through requireTurn(), so it refuses the whole log with \"tool/result is outside an open turn\" (#8812). Those rows only shadow surface nodes that are still in the log, so the repair cuts back to the turn/end the pass followed and loses no message, turn or tool result."],
          "step-after-turn-end": ["Step continues a closed turn", "Step-scoped events keep writing into a turn that already emitted turn/end (a replacement tool/result is exempt: the released folds only ask whether any turn is open, never compare its own turn/step). The released relationship walker (the v1→v2 stage runs v0-to-v1's assertReleasedArtifactRelationships over the transformed artifact) refuses the whole session with \"<type> does not match an open turn and step\" (#7824). Merging or splitting that turn has no unique answer inside the artifact, and splitting renumbers every later seq — reported only, never edited."],
          "turn-step-mismatch": ["Turn/step pairing does not continue", "The turn/step a turn/start, step/start, step-scoped event or turn/end carries is not the pair the released walker expects: it requires turn/start to open the next expected turn, step/start to be the next step of the open turn, every step-scoped row to carry the open pair, and turn/end to match the open turn with no step open. Reading a stored v4 log refuses the whole session with \"<type> does not match an open turn and step\" (or the turn/start, step/start and turn/end variants). Renumbering a mid-log turn has no unique answer inside the artifact — compact can renumber only because the slice boundary it is given defines the answer — and it would renumber every later seq and declared range. Reported only, never edited."],
          "title-references-invalid": ["The title cites messages it cannot name", "A session/title event carries messageSeqs and the fold enforces two clauses: a user title must keep the list empty (\"session/title messageSeqs must be empty exactly for a user title\"), and every other title must cite distinct, earlier, human user/message rows (\"must cite distinct earlier human user/message events\" — a runtime-context or team-message row does not count). Failing either refuses the whole log on read (#10440 variant C: an offline retitle script collected \"the events nearest the title\" and pointed 10 refs at step/start). Repair only does what is determined: a user title's list is emptied, and refs that name no human message are dropped. A non-user title left with no valid citation cannot be reconstructed — reported only."],
          "ptc-dispatch-invalid": ["PTC sub-call identity does not hold", "A `run_code` sub-call id is `<parent callId>:ptc:<n>`, and both halves can repeat inside one session: the provider re-issues the parent id when the assistant repeats a call, and `n` restarts at 1 for every `execute()`. A sub-call that outlives its step — polling a background job is the natural one — produces exactly that: the same parent id, the counter back at 1, and a second `tool/ptc-dispatch-start` for an id that is already settled (#9677: a real 3569-event session became permanently unopenable). The write side accepts it, and the relationships fold then refuses the whole log (\"PTC dispatch repeats subCallId\", \"PTC dispatch does not match its start\", \"PTC rootCallId requires a nonempty string\", \"PTC parentCallId does not belong to rootCallId\"), and reading is all-or-nothing — one repeat costs the entire session. The id a dispatch should have had is not recoverable from the artifact. Reported only, never edited."],
          "surface-replacement-invalid": ["Surface replacement chain is broken", "A surface row carrying a surfaceOp other than append (system/user/developer/assistant/message, tool/result) must name a span that is currently on the surface, list exactly the rows it shadows in sourceEventSeqs, and may not shadow the protected system head. The released reader refuses the whole log at the first row that does not (\"<type> replacement range is not on the current surface\", \"replacement sourceEventSeqs omit a shadowed surface node\"; the seed constructor words the same row as \"surface replace: start seq <n> not found in surface\"). Once startSeq/endSeq no longer name it, the span a replacement meant to shadow is not recoverable from the artifact. Reported only, never edited."],
          "tool-result-invalid": ["Tool result does not name its call", "A tool/result whose message.toolCallId is not a non-empty string, disagrees with message.source.callId, names a call this step never advertised, or whose surfaceOp is not an object (the replacement form). The released walker refuses the whole session with \"tool/result <id> has no advertised tool lifecycle\", \"tool call id requires a nonempty string\" or \"tool/result surfaceOp requires an object\". The call a result answers is not recoverable from the artifact. Reported only, never edited."],
          "turn-end-while-step-open": ["Turn ended with a step open", "turn/end lands before that step's step/end. The released walker refuses with \"turn/end <n> crosses an open step\", and the writer states the same rule in dsh-session/lib/invariant.js (#7824). Reported only, never edited."],
          "unknown-type": ["Unknown event type", "Reported; no rows deleted, nothing marked ignorable."]
        }
      },
      nl: {
        s: {
          "panel.title": "Sessie-chirurg",
          "panel.sub": "Klik op een sessie om het gesprek te lezen. Bestanden met en zonder het session- voorvoegsel zijn hetzelfde soort bestand, niet twee soorten sessies.",
          "scan": "Lijst vernieuwen",
          "close": "Sluiten",
          "page.back": "Terug naar gesprek",
          "pickHint": "Klik links op een sessie om hem te lezen. Elke werkruimte heeft zijn eigen set sessies; met of zonder het session- voorvoegsel is alleen een oud/nieuw-ID-schrijfwijze.",
          "repairHint": "Alleen als een sessie niet opent, heb je de acties “wijzigingen bekijken / repareren” nodig.",
          "emptyScan": "Nog niets gescand",
          "scanRoot": "Gescande map",
          "emptyHint": "Staan je sessies ergens anders? De plug-in volgt de DSH_HOME van de host (standaard ~/.dsh/sessions); zet DSH_SESSION_ROOT om een andere map te kiezen.",
          "rootLabel": "Sessiemap",
          "sessionUnit": "sessies",
          "rootMissing": "ontbreekt",
          "rootOther": "Andere map…",
          "rootPrompt": "Sessiemap (absoluut of ~/…)",
          "rootSwitched": "De standaardmap had geen sessies; overgeschakeld naar {root} ({n})",
          "loadingChat": "Gesprek lezen…",
          "chatFail": "Gesprek kon niet worden gelezen: ",
          "chatEmpty": "Dit bestand bevat nog geen leesbare gebruiker/assistent-berichten.",
          "omitted": "{n} eerdere berichten weggelaten.",
          "whoUser": "Jij",
          "whoAssistant": "Assistent",
          "cwd": "Werkruimte: ",
          "copyIdBtn": "Deze ID kopiëren",
          "actInspect": "In gewone taal controleren",
          "actRepair": "Bekijk wat er zou veranderen",
          "actApply": "Deze sessie repareren",
          "actExport": "Back-up exporteren",
          "busy": "Bezig…",
          "detailDefault": "Hieronder staat het gesprek in deze sessie.",
          "tech": "Technische details",
          "techEmpty": "Nog geen gedetailleerd resultaat",
          "busyScan": "Lokale sessies weergeven",
          "busyInspect": "Controleren",
          "busyRepairPreview": "Wijzigingen bekijken",
          "busyRepairApply": "Bestand wegschrijven",
          "busyExport": "Back-up exporteren",
          "exported": "Back-up gedownload ",
          "reqFail": "Aanvraag mislukt: {msg}. Staat er not found, start dan eerst dsh web opnieuw.",
          "toast.pickFirst": "Selecteer eerst links een sessie",
          "toast.noCopyId": "Geen sessie-ID om te kopiëren",
          "toast.copied": "Gekopieerd ",
          "toast.noId": "Sessie-ID kon niet worden gelezen",
          "confirm.apply": "Dit herschrijft het sessiebestand en maakt eerst een .bak-back-up. Doorgaan?",
          "explain.error": "Fout: ",
          "explain.refuse": "Nu niet te repareren:\n",
          "explain.wrote": "Teruggeschreven naar schijf (er is eerst een .bak bewaard).",
          "explain.willDo": "Nog geen bestandswijziging. Klik je op “Deze sessie repareren”, dan gebeurt dit:\n",
          "explain.rewrite": "- het bestand herschrijven",
          "explain.noFix": "Gecontroleerd: dit bestand hoeft niet gerepareerd te worden.",
          "explain.sessions": "Klik links op een sessie om hem te lezen. Met en zonder session- voorvoegsel is dezelfde sessie.",
          "explain.title": "Titel: ",
          "explain.count": "{n} leesbare berichten in totaal.",
          "workspaceUngrouped": "Niet gegroepeerd",
          "sidebar.aria": "Sessie-chirurg",
          "sidebar.title": "Sessie-inhoud bekijken of sessies repareren die niet openen",
          "menu.copyId": "Sessie-ID kopiëren",
          "menu.view": "Bekijken met sessie-chirurg",
          "hint.default": "Stuur mij de technische details rechts.",
          "settings.title": "Session surgeon / 会话医生",
          "settings.description": "Klik op een sessie om hem te lezen; controleer en repareer schijfbestanden als een sessie niet opent.",
          "settings.body": "Sessie-chirurg: bestanden met en zonder session- voorvoegsel zijn hetzelfde soort sessie.\nMeest gebruikt: sessie ⋯ → Sessie-ID kopiëren.\nInstalleren / bijwerken: op DSH Desktop doet de Plug-ins-pagina dat met github:xiaoshenming/dsh-session-surgeon#main; herstarten niet nodig.\nAgenttools: session_scan / session_inspect / session_repair (apply defaults to false)."
        },
        h: {
          "ok": ["OK", "Bestand is intact; voor dagelijks chatten is niets nodig."],
          "header-ok": ["OK", "Bestandskop is intact; voor dagelijks chatten is niets nodig."],
          "raw-jsonl": ["Niet gecomprimeerd", "Logboek in platte tekst; opent meestal gewoon."],
          "orphan-tmp": ["Overgebleven tijdelijk bestand", "Er is een .tmp maar geen echt sessiebestand."],
          "header-frame-corrupt": ["Bestandskop beschadigd", "De officiële lader weigert het. Meestal helpt alleen een back-up."],
          "header-frame-multiline": ["Het kopframe slokt de inhoud op", "Het hele log is in één frame gecomprimeerd, dus de kopregel is alleen de eerste regel van dat frame. Er is niets verloren, maar de lezer controleert eerst dat het eerste frame precies één kopregel is en weigert de hele sessie op die grens (12 van de 13 beschadigde sessies in #10440 kwamen van een offline hertitel-script). Reparatie schrijft de kopregel in zijn eigen frame en houdt elke regel van de inhoud byte voor byte — geen event, seq of inhoud wordt aangeraakt."],
          "header-parse-error": ["Bestandskop onleesbaar", "Het eerste frame is geen geldige header-regel. De officiële lader weigert het, en reparatie raadt niet wat er stond."],
          "foreign-version": ["Nieuwer dan deze harness", "Het bestand heeft een nieuwer formaat dan de geïnstalleerde harness. Werk de harness bij; deze tool degradeert of herschrijft de generatie niet."],
          "retired-fields": ["Kop met uitgefaseerde velden", "De header bevat beleidsvelden die de officiële build heeft verwijderd. Reparatie raadt niet welke te behouden; ze meldt het alleen."],
          "no-zstd-frame": ["Leeg bestand", "Er zit geen complete data in."],
          "failed-middle-frame": ["Middelste frame kapot", "De tool verzint niets om te voorkomen dat het erger wordt."],
          "seq-gap-committed": ["Ontbrekend stuk in het midden", "De officiële lader kan het niet openen. Korte crashherstel-closers worden weggegooid en de echte staart blijft behouden; packed-rijen met een overeenkomend voorvoegsel krijgen hun achtervoegsel eraan vastgemaakt; anders kapt hij af tot de laatste volledige beurt."],
          "seq-gap-tail": ["Onvolledig einde", "Het wegschrijven is onderbroken. Reparatie gooit de vuile staart weg."],
          "torn-tail": ["Gescheurd laatste frame", "Het laatste frame stopte midden in het schrijven. Reparatie gooit dat halve frame weg en behoudt alles wat al vastlag."],
          "zero-fill-tail": ["Staart vol nulbytes", "De crash viel tussen write() en fsync(): de bestandslengte stond op schijf maar de framedata niet, dus dat gebied leest terug als nullen (NTFS ValidDataLength, XFS/ext4 delayed allocation). De officiële lader verklaart het hele logboek corrupt (invalid frame magic), terwijl elk frame ervoor intact is (#9372). Reparatie gooit de nullen weg en raakt niets anders aan."],
          "packed-overlap-suffix": ["Overlappende packed-rij", "Gooit het vastgelegde voorvoegsel weg dat overeenkomt met het origineel en behoudt de doorlopende inhoud erna."],
          "newer-format-ranges": ["Bereikindeling", "sourceEventSeqs is gecomprimeerd tot [start,end]. Deze harness kan ze niet uitvouwen; reparatie schrijft dichte gehele getallen. Vanaf 0.1.2-rc.1 opent de officiële lader het bestand zelf — niet herschrijven."],
          "unparsable-line": ["Onleesbare regel", "Reparatie gooit de onleesbare staart weg."],
          "message-missing-id": ["Bericht zonder ID", "De officiële lader wijst het hele stuk af. Reparatie vult alleen id's aan; er gaat niets verloren."],
          "llm-retry-chain": ["Herhaalpogingen uit reeks", "Binnen één beleidsketen (turn/step/provider/policyKey) moet elke llm/retry de vorige poging + 1 zijn, en de keten houdt één retryId. Een schrijver die de ketenstatus kwijtraakt zet overal retry: 1 met een nieuw id, en de officiële validator weigert het hele logboek (`llm/retry skips its policy attempt sequence`, zichtbaar als stored session is corrupt — stil, pas bij het volgende openen, #9163). Beide waarden komen uit het logboek zelf: het pogingnummer is de positie in de keten en het id is het eerste id van die keten. Reparatie hernummert daarnaar en weigert wanneer ze niet te herstellen zijn."],
          "lone-surrogate": ["Losse surrogate", "De geschiedenis bevat een ongepaarde UTF-16-surrogate (meestal binaire data die als utf16le is gedecodeerd). JSON.stringify schrijft die als \\udXXX-escape en de provider weigert de hele request-body met 400, dus elk volgend verzoek mislukt terwijl het bestand zelf nog laadt — daarom toont de UI geen reden (#8466). Reparatie vervangt elke losse surrogate door U+FFFD en laat de rest van de tekst en de seqs ongemoeid; een surrogate in de header wordt alleen gemeld, want de header noemt de map waarin dit logboek staat."],
          "empty-tool-call-id": ["Lege tool-call-ID", "Het bestand opent, maar de volgende aanvraag geeft 400 (id cannot be empty). Wordt alleen gelokaliseerd, er wordt geen nep-callId verzonnen. De oorzaak ligt in de stackfiltering van de engine."],
          "duplicate-tool-call-id": ["Dubbele tool-call-ID", "Hetzelfde callId wordt in één stap twee keer aangekondigd. Vanaf 0.1.3 weigert de v0→v1-migratie de sessie (#5909). Reparatie zet #n achter latere id's; lege id's worden nooit verzonnen."],
          "legacy-replay-state": ["Oude replayState", "pi-ai zette {kind,...} op de replayState-wortel. De 0.1.3-migratie accepteert alleen {response,blocks} (#5694/#5909). Reparatie verplaatst bestaande sleutels naar response; er wordt niets verzonnen."],
          "v0-preset-extra-member": ["Extra permissieveld", "Oude permission/preset-gebeurtenissen bevatten extra leden zoals origin; de 0.1.5-migratie weigert die (#6189). Reparatie houdt alleen preset over — de effectieve permissie verandert niet."],
          "v0-descriptor-version": ["Subagent-descriptorversie", "subagent/descriptor data.version is geen 3; de 0.1.5-migratie weigert dat (#6151). Beide versies hebben dezelfde velden; reparatie zet 3."],
          "v0-plugin-source-form": ["Plug-in-bronvorm", "Een plug-in-berichtbron combineert summary/sections met de verkeerde form; de 0.1.5-migratie weigert dat (#6194). Reparatie vult de juiste form aan of verwijdert het louter decoratieve lid — de tekst blijft onaangetast."],
          "v0-chunk-provenance": ["Onvolledige chunk-herkomst", "Een assistant/message verwijst niet naar één complete geordende chunk-poging; zowel de v0→v1- als de v1→v2-migratie weigert dat (#6175 / #7824 — meestal omdat een opgegeven bereik een niet-chunk-event zoals session/end-seed meenam). Reparatie verwijst naar de chunk-seqs die al op schijf staan — niets verzonnen."],
          "v0-retired-source-kind": ["Uitgefaseerd brontype", "Een message source.kind is een uitgefaseerd literaal (bv. instruction-hint); de 0.1.5 v2→v3-migratie weigert dat als ongeclassificeerd (#6559). De ledenset komt overeen met de huidige plugin-vorm; reparatie hernoemt alleen de kind."],
          "v0-inbox-inserted-message": ["Ingevoegd bericht mist velden", "Een ingevoegd agent/inbox/spliced-bericht mist id/role; de v0→v1-converter weigert dat (#6559). Reparatie vult een id en de user-rol die de validator zelf voorschrijft; de tekst blijft ongewijzigd."],
          "descriptor-catalog-fact": ["Subagent-descriptor komt niet in de catalogus", "Het v3→v4 kind-cataloguspad accepteert precies één eigen subagent/descriptor en eist een string als provider, een mode van continuable of one-shot wanneer version niet 1 is, en een string als label zodra de effectieve mode continuable is (dat geldt voor elke rij met version 1); anders wordt de hele sessie geweigerd (#7995). De mode is een echte eigenschap en het label is vrije tekst, dus geen van beide is offline te verzinnen — alleen gemeld. Alleen gecontroleerd op v1–v3 (een opgeslagen v4-log doorloopt die migratie niet meer), en alleen voor een niet-geërfde subagent-child: de overgeërfde cut staat niet op schijf en wordt nooit geraden."],
          "v0-missing-member": ["Vereist veld ontbreekt", "Het eventtype is er nog, maar een veld dat de released v0-inventaris vereist niet — het beeld dat een afgekapt of half geschreven log achterlaat. De v0→v1 payload-gate weigert de hele sessie om één zo'n rij en noemt die \"… lacks required member \\\"x\\\"\". Het veld is niet uit het artefact te herstellen — alleen melden, nooit aanvullen."],
          "invalid-settlement-fields": ["Ongeldige settlement-velden", "Een assistant/message- of assistant/attempt-rij heeft een turn/step die geen niet-negatief veilig geheel getal is (-0 telt als ongeldig) of een stream die geen array is. De seed/restore-gate (dsh-session valideert de events waarmee een Session wordt opgebouwd; een gewone lezing van een opgeslagen log komt daar ook) weigert de hele sessie om één zo'n rij met \"seed assistant/message at index N has invalid settlement fields\" (#8084). De writer controleerde deze drie niet bij het schrijven, dus de rij komt pas bij de volgende load boven. **Het is te repareren**: turn/step is geen gok — het log vermeldt welke turn en step op dat seq open staan, en dat is de waarde waartoe de rij behoort; de gestreamde blokken achter stream zijn al verdwenen, maar een lege array is de enige toegestane waarde (assertCurrentAssistantStreams expandeert die tot niets en slaat de vergelijking van content/usage/replayState over), en het bericht, de usage en de replay state blijven onaangeroerd."],
          "producer-source-invalid": ["Berichtbron die de lezer weigert", "De bron van het bericht ontbreekt of is geen object, of het kind ontbreekt, is leeg, geen string, of niet het kind dat het slot eist (system/message wil system-prompt, assistant/message wil model, tool/result wil tool). Formaat v4 weigert het hele logbestand hierop en de juiste waarde heeft geen unieke opvolger in het artefact — alleen gemeld, nooit geraden."],
          "v4-literal-plugin-source": ["v4 plugin-bronletterlijk", "Een berichtbron draagt nog de oude {kind:\"plugin\"}-wrapper. Formaat v4 vereist een producer-eigen kind en deze harness weigert het hele logbestand bij het lezen (#7772). De reparatie schrijft het kind dat de released v3→v4-stage voor die pakketnaam afleidt (naamgevingstabel plus de plugin:<naam>-fallback) en houdt elk ander lid; een bron waarvan plugin geen string is blijft ongemoeid."],
          "dangling-tool-call": ["Hangende tool-aanroep", "De stap van de aanroep is gesloten zonder tool/result. De volgende modelaanvraag blijft 400 geven en op 0.1.7 opent de sessie mogelijk helemaal niet: zowel de v3→v4-restore als een gewone lezing van een opgeslagen v4-log weigert haar. Het resultaat kan alleen tijdens de open stap worden geschreven, dus een offline tool meldt het en verzint niets."],
          "prune-tail-outside-turn": ["Prune-pass zonder open beurt", "De tool-result-pruner voegt replacement tool/result-rijen toe terwijl er geen beurt open is, en de released lezer stuurt elke niet-append tool/result door requireTurn(), waardoor het hele log wordt geweigerd met \"tool/result is outside an open turn\" (#8812). Die rijen overschaduwen alleen surface-nodes die nog in het log staan, dus de reparatie snijdt terug tot de turn/end die de pass volgde en verliest geen bericht, beurt of toolresultaat."],
          "step-after-turn-end": ["Stap gaat door na gesloten beurt", "Stap-gebonden events schrijven door in een beurt die al turn/end gaf (een replacement tool/result is uitgezonderd: de released folds vragen alleen of er een beurt open is en vergelijken turn/step nooit). De released relationship-walker (de v1→v2-stage draait v0-to-v1's assertReleasedArtifactRelationships op het getransformeerde artefact) weigert de hele sessie met \"<type> does not match an open turn and step\" (#7824). Samenvoegen of splitsen heeft geen uniek antwoord in het artefact en splitsen hernummert elke latere seq — alleen melden, nooit aanpassen."],
          "turn-step-mismatch": ["Beurt/stap-koppeling loopt niet door", "De turn/step die een turn/start, step/start, stap-gebonden event of turn/end meedraagt is niet het paar dat de released walker verwacht: turn/start moet de volgende verwachte beurt openen, step/start de volgende stap van de open beurt zijn, elke stap-gebonden rij moet het open paar dragen, en turn/end moet de open beurt raken zonder open stap. Het lezen van een opgeslagen v4-log weigert de hele sessie met \"<type> does not match an open turn and step\" (of de turn/start-, step/start- en turn/end-variant). Een beurt midden in het log hernummeren heeft geen uniek antwoord in het artefact — compact kan alleen hernummeren omdat de meegegeven slicegrens het antwoord bepaalt — en het zou elke latere seq en elk gedeclareerd bereik hernummeren. Alleen melden, nooit aanpassen."],
          "title-references-invalid": ["De titel verwijst naar berichten die hij niet kan noemen", "Een session/title-event draagt messageSeqs en de fold handhaaft twee regels: een gebruikerstitel moet de lijst leeg houden (\"session/title messageSeqs must be empty exactly for a user title\"), en elke andere titel moet verwijzen naar distincte, eerdere, menselijke user/message-rijen (\"must cite distinct earlier human user/message events\" — een runtime-context- of team-message-rij telt niet). Faalt één van beide, dan weigert de lezer het hele log (#10440 variant C: een offline hertitel-script verzamelde \"de events het dichtst bij de titel\" en liet 10 verwijzingen naar step/start wijzen). Reparatie doet alleen wat vaststaat: de lijst van een gebruikerstitel wordt geleegd en verwijzingen die geen menselijk bericht noemen vervallen. Een niet-gebruikerstitel zonder geldige verwijzing is niet te reconstrueren — alleen melden."],
          "ptc-dispatch-invalid": ["PTC-subcall-identiteit klopt niet", "Een `run_code`-subcall-id is `<parent callId>:ptc:<n>`, en beide helften kunnen binnen één sessie herhalen: de provider hergebruikt het parent-id wanneer de assistent een call herhaalt, en `n` begint weer bij 1 voor elke `execute()`. Een subcall die zijn stap overleeft — het pollen van een achtergrondtaak is de natuurlijke — levert precies dat op: hetzelfde parent-id, de teller terug op 1, en een tweede `tool/ptc-dispatch-start` voor een id dat al is afgewikkeld (#9677: een echte sessie van 3569 events werd permanent onopenbaar). De schrijfkant accepteert het, en de relationships-fold weigert daarna de hele sessie (\"PTC dispatch repeats subCallId\", \"PTC dispatch does not match its start\", \"PTC rootCallId requires a nonempty string\", \"PTC parentCallId does not belong to rootCallId\"), en lezen is alles-of-niets — één herhaling kost de hele sessie. Het id dat een dispatch had moeten hebben is niet te herstellen uit het artefact. Alleen melden, nooit aanpassen."],
          "surface-replacement-invalid": ["Surface-vervangingsketen is stuk", "Een surface-rij met een surfaceOp anders dan append (system/user/developer/assistant/message, tool/result) moet een span noemen dat nu op de surface staat, precies de rijen die het schaduwt in sourceEventSeqs opsommen, en mag de beschermde system-head niet schaduwen. De released reader weigert de hele sessie bij de eerste rij die dat niet doet (\"<type> replacement range is not on the current surface\", \"replacement sourceEventSeqs omit a shadowed surface node\"; de seed-constructor zegt voor dezelfde rij \"surface replace: start seq <n> not found in surface\"). Zodra startSeq/endSeq het niet meer aanwijzen is de span die een vervanging wilde schaduwen niet te herstellen uit het artefact. Alleen melden, nooit aanpassen."],
          "tool-result-invalid": ["Toolresultaat noemt zijn call niet", "Een tool/result waarvan message.toolCallId geen niet-lege string is, afwijkt van message.source.callId, een call noemt die deze stap nooit aankondigde, of waarvan surfaceOp geen object is (de replacement-vorm). De released walker weigert de hele sessie met \"tool/result <id> has no advertised tool lifecycle\", \"tool call id requires a nonempty string\" of \"tool/result surfaceOp requires an object\". De call die een resultaat beantwoordt is niet te herstellen uit het artefact. Alleen melden, nooit aanpassen."],
          "turn-end-while-step-open": ["Beurt eindigde met open stap", "turn/end komt vóór de step/end van die stap. De released walker weigert met \"turn/end <n> crosses an open step\"; de writer zegt hetzelfde in dsh-session/lib/invariant.js (#7824). Alleen melden, nooit aanpassen."],
          "unknown-type": ["Onbekend gebeurtenistype", "Wordt gemeld; er worden geen regels verwijderd en niets wordt als ignorable gemarkeerd."]
        }
      }
    };
    const DICT_LANGS = { zh: "zh", en: "en", nl: "nl" };
    let localeId = "zh";
    const REFRESHERS = new Set();
    function pickLocale(active) {
      const lang = String(active ?? "").split("-")[0].toLowerCase();
      return DICT_LANGS[lang] ?? "zh";
    }
    function T(key, params) {
      let text = COPY[localeId]?.s?.[key] ?? COPY.en.s[key] ?? key;
      if (params) for (const name of Object.keys(params)) text = text.replaceAll("{" + name + "}", String(params[name]));
      return text;
    }
    function H(code) {
      return COPY[localeId]?.h?.[code] ?? COPY.en.h[code] ?? [code, T("hint.default")];
    }
    function ensureCss() {
      if (document.querySelector("style[data-plugin-css='dsh-session-surgeon']")) return;
      const tag = document.createElement("style");
      tag.dataset.pluginCss = "dsh-session-surgeon";
      document.head.appendChild(tag);
      fetch(API + "/ui.css").then((res) => res.text()).then((css) => { tag.textContent = css; }).catch(() => {});
    }
    function settingsCopy() {
      return {
        title: T("settings.title"),
        description: T("settings.description"),
        body: T("settings.body"),
      };
    }
    async function api(path, opts) {
      const res = await fetch(path, opts);
      const text = await res.text();
      let body = {};
      try { body = text ? JSON.parse(text) : {}; } catch { body = { error: text }; }
      if (!res.ok) throw new Error(body.error || res.statusText || String(res.status));
      return body;
    }
    function toast(message) {
      const el = document.createElement("div");
      el.textContent = message;
      el.style.cssText = "position:fixed;z-index:90;right:16px;bottom:16px;max-width:360px;padding:8px 12px;border-radius:8px;background:#222;color:#fff;font-size:13px";
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 2400);
    }
    function currentFromCtx(ctx) {
      try { return ctx?.sessions?.list?.getSnapshot?.()?.current; } catch { return undefined; }
    }
    /**
     * Read a service without declaring it. Cordis throws
     * `cannot get property "layout" without inject` for a direct read of a
     * service this plugin did not declare, and `ctx.get(name)` is its optional
     * lookup — the only access that also keeps working on a shell whose UI
     * seats are missing, where the overlay fallback has to stay reachable.
     */
    function serviceOf(ctx, name) {
      if (typeof ctx?.get === "function") {
        try { const service = ctx.get(name); if (service) return service; } catch { /* fall through */ }
      }
      try { return ctx?.[name]; } catch { return undefined; }
    }
    function idFromRow(row, ctx) {
      const list = ctx?.sessions?.list?.getSnapshot?.();
      if (!row) return list?.current;
      if (row.getAttribute("aria-selected") === "true" && list?.current) return list.current;
      const title = row.querySelector("[class*='title']")?.textContent?.trim();
      if (list?.byId && title) {
        const hits = Object.values(list.byId).filter((s) => s && (s.id === title || s.displayTitle === title || s.title === title));
        if (hits.length === 1) return hits[0].id;
      }
      return list?.current || title;
    }
    function createController() {
      let open = false;
      const subs = new Set();
      const notify = () => { for (const fn of subs) fn(); };
      return {
        getSnapshot() { return { panelOpen: open }; },
        subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
        open() { open = true; notify(); },
        close() { open = false; notify(); },
        toggle() { open = !open; notify(); },
      };
    }
    function sidebarRoot() {
      const column = document.querySelector("[data-pane='sidebar'], [class*='sidebarCol']");
      return column?.querySelector("[class*='logoRow']")?.parentElement ?? column?.firstElementChild;
    }
    function mountSidebar(controller, refreshLabels) {
      const entry = document.createElement("button");
      entry.type = "button";
      entry.dataset.dshSurgeonEntry = "";
      entry.setAttribute("aria-label", T("sidebar.aria"));
      entry.setAttribute("title", T("sidebar.title"));
      entry.innerHTML = '<span aria-hidden="true">✚</span><span data-label>' + T("sidebar.aria") + "</span>";
      entry.addEventListener("click", () => controller.toggle());
      const relabel = () => {
        entry.setAttribute("aria-label", T("sidebar.aria"));
        entry.setAttribute("title", T("sidebar.title"));
        const label = entry.querySelector("[data-label]");
        if (label) label.textContent = T("sidebar.aria");
      };
      refreshLabels.add(relabel);
      let placed = false;
      const place = () => {
        if (placed && document.body.contains(entry)) return;
        const root = sidebarRoot();
        const button = root?.querySelector("button[class*='newSession']") ?? Array.from(root?.children ?? []).find((c) => c.tagName === "BUTTON");
        if (!root || !button) return;
        const row = button.closest("[class*='logoRow']");
        const base = row && row.parentElement === root ? row : button;
        const family = Array.from(root.children).filter((el) => el.matches?.("[data-dsh-taskboard-entry],[data-dsh-ssh-entry],[data-dsh-surgeon-entry]"));
        root.insertBefore(entry, (family.at(-1) ?? base).nextElementSibling);
        placed = true;
      };
      const wait = new MutationObserver(place);
      wait.observe(document.body, { childList: true, subtree: true });
      const unsub = controller.subscribe(() => {
        if (controller.getSnapshot().panelOpen) entry.dataset.active = "true";
        else delete entry.dataset.active;
      });
      place();
      return () => { wait.disconnect(); unsub(); entry.remove(); };
    }
    const pretty = (value) => JSON.stringify(value, null, 2);
    const sessionIdOf = (row) => row?.header?.id || row?.sessionDir || "";
    const esc = (text) => String(text).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
    const healthOf = (row) => row?.health || "?";
    const isBad = (health) => health && health !== "header-ok" && health !== "ok";
    const labelOf = (health) => H(health)[0];
    const hintOf = (health) => H(health)[1];
    const workspaceOf = (row) => row?.header?.cwd?.replace(/^\/home\/[^/]+/, "~") || (row?.project || "").replace(/^--+|--+$/g, "").replace(/-/g, "/") || T("workspaceUngrouped");
    function explain(data) {
      if (!data || typeof data !== "object") return String(data ?? "");
      if (data.error) return T("explain.error") + data.error;
      if (data.plan) {
        if (data.plan.refuse) return T("explain.refuse") + data.plan.refuse;
        const acts = (data.plan.actions || []).map((a) => "- " + (a.detail || a.code)).join("\n");
        if (data.wrote) return T("explain.wrote") + "\n" + (acts || T("explain.rewrite"));
        return data.plan.mustWrite ? T("explain.willDo") + "\n" + (acts || T("explain.rewrite")) : T("explain.noFix");
      }
      if (data.sessions) return T("explain.sessions");
      if (data.messages) return (data.title ? T("explain.title") + data.title + ". " : "") + T("explain.count", { n: data.count });
      if (data.health) return labelOf(data.health) + ".\n" + hintOf(data.health);
      return pretty(data);
    }
    /**
     * Every request has to name the root the panel is looking at, otherwise
     * inspect/repair silently fall back to the server default and answer
     * "not found" for a session that is plainly on screen.
     */
    function withRoot(path, params, root) {
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(params || {})) {
        if (value !== undefined && value !== "") query.set(key, String(value));
      }
      if (root) query.set("root", root);
      const qs = query.toString();
      return API + path + (qs ? "?" + qs : "");
    }
    /**
     * The panel body. One instance serves both mounts — the shell's
     * center-column page (the native seat) and the legacy full-screen overlay —
     * so a scan or an open conversation survives switching panels.
     */
    function createPanel(controller, ctx) {
      const state = { rows: [], selected: "", detail: "", raw: "", busy: false, scanned: false, chat: null, titles: {}, root: "", roots: [], scanError: "", rootNote: "", mode: "overlay" };
      const shell = document.createElement("div");
      shell.className = "ss-shell";
      let pending;
      const layoutOf = () => serviceOf(ctx, "layout");
      const selectPanel = (id) => {
        const layout = layoutOf();
        if (!layout || typeof layout.selectPanel !== "function") return false;
        try { layout.selectPanel(id); return true; } catch (error) {
          console.warn("[dsh-session-surgeon] panel switch failed:", error);
          return false;
        }
      };
      const selectedRow = () => state.rows.find((r) => sessionIdOf(r) === state.selected);
      const listHtml = () => {
        const groups = new Map();
        for (const row of state.rows) { const key = workspaceOf(row); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(row); }
        const rootLine = state.root ? '<div class="ss-root">' + T("scanRoot") + " " + esc(state.root) + " · " + state.rows.length + (state.rootNote ? " — " + esc(state.rootNote) : "") + "</div>" : "";
        const rows = [...groups].flatMap(([name, rows]) => ['<div class="ss-group">' + esc(name) + " · " + rows.length + "</div>", ...rows.map((row) => { const id = sessionIdOf(row); const h = healthOf(row); return '<div class="ss-row" data-id="' + id + '"' + (id === state.selected ? " data-on" : "") + '><span class="ss-id"><span class="ss-title">' + esc(state.titles[id] || id.replace(/^session-/, "")) + '</span><span class="ss-sid">' + esc(id) + '</span></span><span class="ss-badge' + (isBad(h) ? " bad" : "") + '">' + esc(labelOf(h)) + "</span></div>"; })]);
        const empty = '<div class="ss-note">' + T("emptyScan")
          + (state.root ? "<br>" + T("scanRoot") + " " + esc(state.root) : "")
          + (state.scanError ? "<br>" + T("explain.error") + esc(state.scanError) : "<br>" + T("emptyHint"))
          + "</div>";
        return rootLine + (rows.join("") || empty);
      };
      const chatHtml = () => {
        const chat = state.chat;
        if (!state.selected) return "";
        if (!chat) return '<div class="ss-note">' + T("loadingChat") + "</div>";
        if (chat.error) return '<div class="ss-note">' + T("chatFail") + esc(chat.error) + "</div>";
        if (!chat.messages?.length) return '<div class="ss-note">' + T("chatEmpty") + "</div>";
        return '<div class="ss-chat">' + (chat.omitted ? '<div class="ss-note">' + T("omitted", { n: chat.omitted }) + "</div>" : "") + chat.messages.map((m) => '<div class="ss-msg ' + m.role + '"><div class="ss-who">' + (m.role === "user" ? T("whoUser") : T("whoAssistant")) + '</div><div class="ss-bubble">' + esc(m.text) + "</div></div>").join("") + "</div>";
      };
      const render = () => {
        const selected = selectedRow();
        const health = selected ? healthOf(selected) : "";
        const main = selected
          ? '<div class="ss-dhead"><span class="ss-dtitle">' + esc(state.chat?.title || state.selected) + '</span><span class="ss-badge' + (isBad(health) ? " bad" : "") + '">' + esc(labelOf(health)) + "</span></div>"
            + '<p class="ss-note">' + esc(hintOf(health)) + (state.chat?.cwd ? "<br>" + T("cwd") + esc(state.chat.cwd) : "") + "</p>"
            + '<div class="ss-idbox"><span>' + esc(state.selected) + '</span><button type="button" class="ss-btn primary" data-act="copy">' + T("copyIdBtn") + "</button></div>"
            + '<div class="ss-actions"><button type="button" class="ss-btn" data-act="inspect">' + T("actInspect") + '</button><button type="button" class="ss-btn" data-act="repair">' + T("actRepair") + '</button><button type="button" class="ss-btn danger" data-act="repair-apply">' + T("actApply") + '</button><button type="button" class="ss-btn" data-act="export">' + T("actExport") + "</button></div>"
            + '<p class="ss-note">' + (state.busy ? T("busy") : esc(state.detail || T("detailDefault"))) + "</p>"
            + chatHtml()
            + '<details><summary>' + T("tech") + "</summary><pre>" + esc(state.raw || T("techEmpty")) + "</pre></details>"
          : '<div class="ss-note">' + T("pickHint") + "<br><br>" + T("repairHint") + "</div>";
        const rootPicker = state.roots.length > 1 || state.scanError
          ? '<select class="ss-rootpick" data-act="pick-root" title="' + T("rootLabel") + '">'
            + state.roots.map((c) => '<option value="' + esc(c.root) + '"' + (c.root === state.root ? " selected" : "") + '>' + esc(c.label) + " · " + (c.exists === false ? T("rootMissing") : c.sessions + " " + T("sessionUnit")) + " · " + esc(c.root) + "</option>").join("")
            + '<option value="__other__">' + T("rootOther") + "</option></select>"
          : "";
        const closeLabel = state.mode === "page" ? T("page.back") : T("close");
        shell.innerHTML = '<div class="ss-head"><div class="ss-titles"><h1>' + T("panel.title") + '</h1><p class="ss-sub">' + T("panel.sub") + '</p></div><div class="ss-headacts">' + rootPicker + '<button type="button" class="ss-btn" data-act="scan">' + T("scan") + '</button><button type="button" class="ss-btn" data-act="close">' + closeLabel + "</button></div></div>"
          + '<div class="ss-body"><div class="ss-list">' + listHtml() + '</div><div class="ss-main">' + main + "</div></div>";
      };
      const run = async (label, fn) => {
        if (state.busy) return;
        state.busy = true; state.detail = label + "…"; render();
        try {
          const out = await fn();
          state.raw = typeof out === "string" ? out : pretty(out);
          state.detail = explain(out);
        } catch (error) {
          state.raw = String(error?.message || error);
          state.detail = T("reqFail", { msg: state.raw });
        }
        state.busy = false; render();
      };
      const loadChat = async (id) => {
        state.selected = id; state.chat = null; render();
        try {
          const data = await api(withRoot("/transcript", { id }, state.root));
          if (state.selected !== id) return;
          state.chat = data;
          if (data.title) state.titles[id] = data.title;
          state.detail = explain(data);
        } catch (error) {
          if (state.selected !== id) return;
          state.chat = { error: String(error?.message || error), messages: [] };
        }
        render();
      };
      const scan = () => run(T("busyScan"), async () => {
        let data;
        try {
          data = await api(withRoot("/scan", {}, state.root));
        } catch (error) {
          state.rows = [];
          state.scanned = true;
          state.scanError = String(error?.message || error);
          throw error;
        }
        state.rows = data.sessions || [];
        state.root = data.root || state.root;
        if (state.root && !state.roots.some((c) => c.root === state.root)) state.roots.push({ root: state.root, label: state.root, exists: !data.error });
        state.scanError = data.error || "";
        state.scanned = true;
        if (!state.selected && state.rows[0]) state.selected = sessionIdOf(state.rows[0]);
        if (state.selected) loadChat(state.selected);
        return data;
      });
      const loadRoots = async () => {
        try {
          const data = await api(API + "/roots");
          state.roots = data.candidates || [];
          let saved = "";
          try { saved = localStorage.getItem("dsh.sessionSurgeon.root") || ""; } catch { saved = ""; }
          if (saved && state.roots.some((c) => c.root === saved)) state.root = saved;
          else if (!state.root) {
            const host = data.root || "";
            const nonEmpty = state.roots.filter((c) => c.sessions > 0).sort((a, b) => b.sessions - a.sessions);
            const hostCandidate = state.roots.find((c) => c.root === host);
            if (nonEmpty.length > 0 && (!hostCandidate || hostCandidate.sessions === 0)) {
              state.root = nonEmpty[0].root;
              if (hostCandidate && nonEmpty[0].root !== host) state.rootNote = T("rootSwitched", { root: nonEmpty[0].root, n: nonEmpty[0].sessions });
            } else state.root = host || state.roots[0]?.root || "";
          }
        } catch {
          state.roots = [];
        }
        scan();
      };
      const onChange = (event) => {
        const select = event.target?.closest?.("select[data-act='pick-root']");
        if (!select) return;
        if (select.value === "__other__") {
          let typed = "";
          try { typed = window.prompt(T("rootPrompt"), state.root || "") || ""; } catch { typed = ""; }
          if (!typed.trim()) { render(); return; }
          const root = typed.trim();
          if (!state.roots.some((c) => c.root === root)) state.roots.push({ root, label: T("rootOther"), exists: true, sessions: 0 });
          state.root = root;
        } else {
          state.root = select.value;
        }
        state.rows = []; state.selected = ""; state.detail = ""; state.raw = ""; state.chat = null; state.scanError = ""; state.scanned = false;
        try { localStorage.setItem("dsh.sessionSurgeon.root", state.root); } catch { /* private mode */ }
        scan();
      };
      const onClick = (event) => {
        const act = event.target?.closest?.("[data-act]")?.getAttribute("data-act");
        const row = event.target?.closest?.("[data-id]");
        if (row?.dataset.id && !act) loadChat(row.dataset.id);
        if (act === "close") {
          if (state.mode === "page") selectPanel(null);
          else controller.close();
        }
        if (act === "scan") scan();
        if (act === "inspect") {
          if (!state.selected) return toast(T("toast.pickFirst"));
          run(T("busyInspect"), () => api(withRoot("/inspect", { id: state.selected }, state.root)));
        }
        if (act === "copy") {
          const id = state.selected || currentFromCtx(ctx);
          if (!id) return toast(T("toast.noCopyId"));
          navigator.clipboard?.writeText(id).then(() => toast(T("toast.copied") + id), () => toast(id));
        }
        if (act === "repair" || act === "repair-apply") {
          if (!state.selected) return toast(T("toast.pickFirst"));
          const applyWrite = act === "repair-apply";
          if (applyWrite && !window.confirm(T("confirm.apply"))) return;
          run(applyWrite ? T("busyRepairApply") : T("busyRepairPreview"), () => api(API + "/repair", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: state.selected, apply: applyWrite, root: state.root }) }));
        }
        if (act === "export") {
          if (!state.selected) return toast(T("toast.pickFirst"));
          run(T("busyExport"), async () => {
            const data = await api(withRoot("/export", { id: state.selected }, state.root));
            const a = document.createElement("a");
            a.href = URL.createObjectURL(new Blob([data.text || ""], { type: "application/x-ndjson" }));
            a.download = (data.id || state.selected) + ".jsonl";
            a.click();
            URL.revokeObjectURL(a.href);
            return T("exported") + a.download;
          });
        }
      };
      shell.addEventListener("click", onClick);
      shell.addEventListener("change", onChange);
      const onLocaleTick = () => { if (shell.isConnected) render(); };
      REFRESHERS.add(onLocaleTick);
      const attach = (host, mode) => {
        state.mode = mode;
        if (shell.parentElement !== host) host.replaceChildren(shell);
        render();
      };
      const show = (id, act) => {
        if (!shell.isConnected) { pending = { id, act }; return; }
        loadChat(id);
        if (act === "repair") run(T("busyRepairPreview"), () => api(API + "/repair", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, apply: false, root: state.root }) }));
      };
      const activate = () => {
        render();
        if (pending) { const next = pending; pending = undefined; show(next.id, next.act); }
        if (!state.scanned && !state.busy) { if (state.roots.length === 0) loadRoots(); else scan(); }
      };
      return {
        shell,
        attach,
        show,
        activate,
        render,
        detach() { shell.remove(); },
        dispose() { REFRESHERS.delete(onLocaleTick); shell.remove(); },
      };
    }
    /**
     * Legacy mount: the plugin owns a sidebar button and a full-screen overlay
     * for shells that declare no `sidebar.panellist` / `main` seats.
     */
    function mountOverlay(controller, panel) {
      const host = document.createElement("div");
      host.dataset.dshSurgeonView = "";
      document.body.appendChild(host);
      panel.attach(host, "overlay");
      const applyActive = () => {
        if (controller.getSnapshot().panelOpen) {
          document.documentElement.setAttribute(ACTIVE, "");
          document.dispatchEvent(new CustomEvent(EVENT, { detail: "session-surgeon" }));
          panel.activate();
        } else document.documentElement.removeAttribute(ACTIVE);
      };
      const unsub = controller.subscribe(applyActive);
      const onActivate = (event) => { if (event.detail !== "session-surgeon") controller.close(); };
      const onOpen = (event) => {
        const id = event.detail?.id;
        if (!id) return;
        controller.open();
        panel.show(id, event.detail?.act === "repair" ? "repair" : undefined);
      };
      document.addEventListener(EVENT, onActivate);
      document.addEventListener("dsh-surgeon-open", onOpen);
      applyActive();
      return () => { panel.detach(); unsub(); document.removeEventListener(EVENT, onActivate); document.removeEventListener("dsh-surgeon-open", onOpen); document.documentElement.removeAttribute(ACTIVE); host.remove(); };
    }
    /**
     * Native mount: contribute a row to the shell's own sidebar panel list and
     * the page to the layout's keyed `main` seat, so the shell owns the row box,
     * its label, the active highlight and the collapsed rail — the same
     * container the shipped Plugins page uses. Both registrations go through
     * `slots.inject`, so load order against the shell does not matter.
     * @returns disposer, or null when the shell has no slot registry.
     */
    function mountNativePanel(ctx, panel, require) {
      // A context without the service may resolve (or throw) either way, and a
      // shell that has no slot registry at all must keep the overlay path.
      const slots = serviceOf(ctx, "slots");
      if (!slots || typeof slots.inject !== "function" || typeof slots.register !== "function" || typeof require !== "function") return null;
      let React;
      try { React = require("react"); } catch { return null; }
      if (!React || typeof React.createElement !== "function" || typeof React.useEffect !== "function") return null;
      const createElement = React.createElement;
      const layoutOf = () => serviceOf(ctx, "layout");
      const Glyph = function SessionSurgeonGlyph(props) {
        const size = props?.size ?? 16;
        return createElement("svg", {
          viewBox: "0 0 16 16", width: size, height: size, fill: "none", stroke: "currentColor",
          strokeWidth: 1.3, strokeLinecap: "round", strokeLinejoin: "round",
          "aria-hidden": "true", "data-dsh-panel-entry": PANEL_ID,
        },
          createElement("path", { d: "M2.2 3.2h11.6v7.1H7.1L4 12.9v-2.6H2.2z" }),
          createElement("path", { d: "M8 5.1v3.3M6.35 6.75h3.3" }),
        );
      };
      const Page = function SessionSurgeonPage() {
        const hostRef = React.useRef(null);
        React.useEffect(() => {
          const host = hostRef.current;
          if (!host) return undefined;
          panel.attach(host, "page");
          panel.activate();
          return () => panel.detach();
        }, []);
        return createElement("div", { className: "ss-page", "data-dsh-surgeon-page": "", ref: hostRef });
      };
      const disposers = [];
      const seat = (name, options, component) => {
        try {
          disposers.push(slots.inject(name, () => {
            // The seat owner runs this callback; a refusal here must not break
            // its declaration pass, so it is contained and only logged.
            try { return slots.register(options, component); } catch (error) { console.warn("[dsh-session-surgeon] panel seat " + name + " refused:", error); return () => {}; }
          }));
        } catch (error) {
          console.warn("[dsh-session-surgeon] panel seat " + name + " unavailable:", error);
        }
      };
      seat("sidebar.panellist", { name: "sidebar.panellist", id: PANEL_ID, order: PANEL_ORDER, label: () => T("sidebar.aria") }, Glyph);
      seat("main", { name: "main", key: PANEL_ID, inject: () => ({}) }, Page);
      const onOpen = (event) => {
        const id = event.detail?.id;
        if (!id) return;
        // Queue the request before switching. The native page can be unmounted
        // while the shell changes seats, so show() must not depend on its
        // current DOM connection.
        panel.show(id, event.detail?.act === "repair" ? "repair" : undefined);
        const layout = layoutOf();
        if (layout && typeof layout.selectPanel === "function") {
          try { layout.selectPanel(PANEL_ID); } catch (error) { console.warn("[dsh-session-surgeon] panel switch failed:", error); }
        }
      };
      document.addEventListener("dsh-surgeon-open", onOpen);
      return () => { document.removeEventListener("dsh-surgeon-open", onOpen); for (const d of disposers) { try { d(); } catch { /* ignore */ } } };
    }
    function mountMenu(controller, ctx) {
      let lastRow;
      const onPointer = (event) => { const row = event.target?.closest?.("[role='treeitem']"); if (row) lastRow = row; };
      document.addEventListener("pointerdown", onPointer, true);
      const inject = (menu) => {
        if (menu.querySelector("[data-dsh-surgeon-item]")) return;
        const labels = Array.from(menu.querySelectorAll("[role='menuitem']")).map((el) => el.textContent || "");
        if (!labels.some((t) => /归档会话|Archive session|分叉会话|Fork session|Sessie archiveren|Sessie vertakken|archiveren|vertakken/i.test(t))) return;
        const sample = menu.querySelector("[role='menuitem']");
        const add = (label, fn) => {
          const btn = document.createElement("button");
          btn.type = "button"; btn.role = "menuitem"; btn.dataset.dshSurgeonItem = "";
          if (sample) btn.className = sample.className;
          btn.textContent = label;
          btn.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); fn(); });
          (sample?.parentElement || menu).appendChild(btn);
        };
        add(T("menu.copyId"), async () => {
          const id = idFromRow(lastRow, ctx);
          if (!id) return toast(T("toast.noId"));
          try { await navigator.clipboard.writeText(id); toast(T("toast.copied") + id); } catch { toast(id); }
        });
        add(T("menu.view"), () => {
          const id = idFromRow(lastRow, ctx);
          if (!id) return toast(T("toast.noId"));
          document.dispatchEvent(new CustomEvent("dsh-surgeon-open", { detail: { id, act: "inspect" } }));
        });
      };
      const obs = new MutationObserver(() => { for (const menu of document.querySelectorAll("[role='menu']")) inject(menu); });
      obs.observe(document.body, { childList: true, subtree: true });
      return () => { document.removeEventListener("pointerdown", onPointer, true); obs.disconnect(); };
    }
    function apply(ctx) {
      try {
        const refreshLabels = new Set();
        const disposers = [];
        if (ctx?.locale?.getLocale && ctx.locale.subscribe) {
          localeId = pickLocale(ctx.locale.getLocale().active);
          const localeUnsub = ctx.locale.subscribe(() => {
            localeId = pickLocale(ctx.locale.getLocale().active);
            for (const relabel of refreshLabels) { try { relabel(); } catch { /* ignore */ } }
            for (const refresh of REFRESHERS) { try { refresh(); } catch { /* ignore */ } }
          });
          disposers.push(() => { if (localeUnsub) localeUnsub(); });
        }
        ensureCss();
        const controller = createController();
        const panel = createPanel(controller, ctx);
        disposers.push(panel.dispose);
        // Native seat first: the shell then owns the sidebar row and the center
        // column, exactly as it does for the shipped Plugins and Schedule pages.
        const native = mountNativePanel(ctx, panel, require);
        if (native) disposers.push(native);
        else disposers.push(mountOverlay(controller, panel), mountSidebar(controller, refreshLabels));
        disposers.push(mountMenu(controller, ctx));
        ctx?.effect?.(() => () => { for (const d of disposers) d(); }, "session-surgeon: ui");
      } catch (error) {
        console.warn("[dsh-session-surgeon] mount failed:", error);
      }
    }
    return { name: "session-surgeon", inject: ["sessions", "locale"], apply, settingsCopy };
  },
});
