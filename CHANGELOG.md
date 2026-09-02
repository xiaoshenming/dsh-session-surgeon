# Changelog

All notable user-facing changes to dsh-session-surgeon. Dates are UTC.

## Unreleased

### Added

- Agent skill `dsh-session-surgeon-update`: saying **更新插件** (or 自我迭代 / 逛逛社区) runs the community-scan → code → changelog → reply → px-push loop without restating the steps.
- Inspect flags empty `tool_calls[].id` / empty `tool/call.callId` as `empty-tool-call-id` ([#5182](https://github.com/deepseek-ai/deepseek-harness/discussions/5182)). Repair still **does not invent** an id — the engine must filter on replay.
- Packed-row overlap suffix (`packed-overlap-suffix`, [#5151](https://github.com/deepseek-ai/deepseek-harness/discussions/5151)): when a packed chunk row starts before the committed cursor but continues through it **and the overlapping prefix is identical to already-committed events**, drop that prefix and keep the uncommitted suffix. Seq numbers already exist on disk — nothing is invented. A mismatched prefix is still a seq gap.
- Crash-recovery vs live writer (`live-writer-tail`, [#1586](https://github.com/deepseek-ai/deepseek-harness/discussions/1586) / [#1497](https://github.com/deepseek-ai/deepseek-harness/discussions/1497)): drop official `interrupted-tool-result-*` / `turn/end interrupted` closers when overflow resumes at the same seq with real work.
- Detect Alpha compressed `sourceEventSeqs` ranges (`newer-format-ranges`, [#5160](https://github.com/deepseek-ai/deepseek-harness/discussions/5160) / [#4910](https://github.com/deepseek-ai/deepseek-harness/discussions/4910)). Current `@deepseek-ai/dsh@0.1.1-rc.2` `foldSurface` still requires dense integers and npm has no newer harness — **repair expands** inclusive `[start,end]` pairs losslessly instead of refusing.
- Repair validated Alpha `model/selection` events after a downgrade to rc.2 by adding only `ignorable: true`. The official event is log-only and never enters derived model history; type, data, seq, and time stay intact. Malformed variants and arbitrary plugin events remain untouched.

### Changed

- Compact refuses unloadable files (seq gap / failed frames / newer format). Repair first, with all writers stopped — compact itself does not create seq holes, but a second live writer after rewrite will.
- The known-event catalog again matches the installed rc.2 loader exactly. Newer official events are handled only by narrow, shape-validated downgrade shims instead of being mislabeled as locally supported.
- Inspect keeps overflow after the first seq defect instead of pretending later rows do not exist.

### Fixed

- Windows `--apply` no longer aborts with `EPERM` when fsyncing the read-only `.bak.<utc>` handle ([#4178](https://github.com/deepseek-ai/deepseek-harness/discussions/4178) / [#1452](https://github.com/deepseek-ai/deepseek-harness/discussions/1452)).

### Not in scope (still refuse / warn only)

- Empty `callId` / empty `tool_calls[].id` / dangling `tool/call`: inspect warns (`empty-tool-call-id` / `dangling-tool-call`), repair does not invent a `tool/result` or callId.
- Unknown plugin event types: report `unknown-type`, do not stamp `ignorable`.
- Web Chat `received more than one start Match`: frontend fold, not a disk defect.
- Arbitrary dual-write branch picking when the packed/live-writer signatures do not match.

## 0.1.0

- First public plugin: copy session ID, scan / inspect / dry-run repair / apply / compact / export.
- Host tools `session_scan` / `session_inspect` / `session_repair`.
