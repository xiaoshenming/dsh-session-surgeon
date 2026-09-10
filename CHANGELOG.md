# Changelog

All notable user-facing changes to dsh-session-surgeon. Dates are UTC.

## Unreleased

### Added

- 0.1.5-rc.1 converter refusals on released v0 sessions (`v0-preset-extra-member` [#6189](https://github.com/deepseek-ai/deepseek-harness/discussions/6189), `v0-descriptor-version` / plugin source kinds [#6151](https://github.com/deepseek-ai/deepseek-harness/discussions/6151), `v0-plugin-source-form` [#6194](https://github.com/deepseek-ai/deepseek-harness/discussions/6194), `v0-chunk-provenance` [#6175](https://github.com/deepseek-ai/deepseek-harness/discussions/6175)). The frozen released-v0 inventory refuses shapes earlier writers emitted, so sessions become unopenable after upgrading. Repair (only when the installed runtime migrates v0, i.e. format ≥ 1) keeps just `preset` on `permission/preset`, sets `subagent/descriptor` version 3, aligns plugin-source `form` with `summary`/`sections`, and cites the on-disk chunk run for `assistant/message`. Verified against the real 0.1.5-rc.1 `sessionFormatV0ToV1` stage: refused before, clean migration after. Unknown event types (`session/imported`, plugin messages) are still inspect-only — the converter refuses those even when `ignorable`, and repair does not delete events.
- Follow DeepSeek Harness **0.1.2-rc.1** (native `decodeSeqRanges`, live event catalog) and **0.1.3-alpha** format generations: `session.vN.jsonl.zstd` (`SESSION_FORMAT_VERSION` 2). Historical v0 files stay readable; only a version *newer* than the installed runtime is `foreign-version`.
- Duplicate advertised tool-call ids in one step (`duplicate-tool-call-id`, [#5909](https://github.com/deepseek-ai/deepseek-harness/discussions/5909)). 0.1.3 v0→v1 migration throws `assistant/message repeats advertised tool call`. Repair suffixes later duplicates (`id#2`) and remaps matching `tool/call` / `tool/result` in order — never invents an empty id. On 0.1.2-rc.1 (v0) this is inspect-only because the file still loads.
- Flat pi-ai `replayState` (`legacy-replay-state`, [#5694](https://github.com/deepseek-ai/deepseek-harness/discussions/5694) / [#5909](https://github.com/deepseek-ai/deepseek-harness/discussions/5909)). Pre-envelope writers stored `{kind, version, api, ..., blocks}` at the root; v0→v1 only admits `{response, blocks?}`. Repair moves existing keys under `response`. On v0 this is inspect-only.
- Agent skill `dsh-session-surgeon-update`: saying **更新插件** (or 自我迭代 / 逛逛社区) runs the community-scan → code → changelog → reply → px-push loop without restating the steps.
- Web UI follows the app locale (zh / en / nl) and re-renders live ([#2](https://github.com/xiaoshenming/dsh-session-surgeon/pull/2) by @vkpeter). Chinese remains the default when the locale service is missing.
- Inspect flags empty `tool_calls[].id` / empty `tool/call.callId` as `empty-tool-call-id` ([#5182](https://github.com/deepseek-ai/deepseek-harness/discussions/5182)). Repair still **does not invent** an id — the engine must filter on replay.
- Packed-row overlap suffix (`packed-overlap-suffix`, [#5151](https://github.com/deepseek-ai/deepseek-harness/discussions/5151)): when a packed chunk row starts before the committed cursor but continues through it **and the overlapping prefix is identical to already-committed events**, drop that prefix and keep the uncommitted suffix. Seq numbers already exist on disk — nothing is invented. A mismatched prefix is still a seq gap.
- Crash-recovery vs live writer (`live-writer-tail`, [#1586](https://github.com/deepseek-ai/deepseek-harness/discussions/1586) / [#1497](https://github.com/deepseek-ai/deepseek-harness/discussions/1497)): drop official `interrupted-tool-result-*` / `turn/end interrupted` closers when overflow resumes at the same seq with real work.
- Detect Alpha compressed `sourceEventSeqs` ranges (`newer-format-ranges`, [#5160](https://github.com/deepseek-ai/deepseek-harness/discussions/5160) / [#4910](https://github.com/deepseek-ai/deepseek-harness/discussions/4910)). **0.1.2-rc.1+** persistence expands pairs on read — surgeon leaves those files alone. Older rc.2 still cannot: repair expands inclusive `[start,end]` pairs losslessly.
- Repair validated Alpha `model/selection` events after a downgrade to rc.2 by adding only `ignorable: true`. The official event is log-only and never enters derived model history; type, data, seq, and time stay intact. Malformed variants and arbitrary plugin events remain untouched.

### Changed

- Follow the **installed** DSH runtime (`0.1.2-rc.1` catalog, native `decodeSeqRanges`). Bundled fallback stays the older rc.2 vocabulary. `model/selection` is only shimmed to `ignorable` when the active loader does not know it. Compressed `sourceEventSeqs` ranges are not rewritten on a harness that already expands them.
- Peer `@deepseek-ai/dsh-tools` range is `>=0.1.0-rc.6 <0.2.0` so `0.1.2-rc.1` resolves (a caret on a prerelease does not).
- Compact refuses unloadable files (seq gap / failed frames / newer format). Repair first, with all writers stopped — compact itself does not create seq holes, but a second live writer after rewrite will.
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
