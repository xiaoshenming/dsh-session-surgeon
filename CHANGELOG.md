# Changelog

All notable user-facing changes to dsh-session-surgeon. Dates are UTC.

## Unreleased

### Added

- 0.1.5-rc.1 converter refusals on released v0 sessions (`v0-preset-extra-member` [#6189](https://github.com/deepseek-ai/deepseek-harness/discussions/6189), `v0-descriptor-version` / plugin source kinds [#6151](https://github.com/deepseek-ai/deepseek-harness/discussions/6151), `v0-plugin-source-form` [#6194](https://github.com/deepseek-ai/deepseek-harness/discussions/6194), `v0-chunk-provenance` [#6175](https://github.com/deepseek-ai/deepseek-harness/discussions/6175)). The frozen released-v0 inventory refuses shapes earlier writers emitted, so sessions become unopenable after upgrading. Repair (only when the installed runtime migrates v0, i.e. format ≥ 1) keeps just `preset` on `permission/preset`, sets `subagent/descriptor` version 3, aligns plugin-source `form` with `summary`/`sections`, and cites the on-disk chunk run for `assistant/message`. Verified against the real 0.1.5-rc.1 `sessionFormatV0ToV1` stage: refused before, clean migration after. Unknown event types (`session/imported`, plugin messages) are still inspect-only — the converter refuses those even when `ignorable`, and repair does not delete events.
- Two more released-writer refusals from the [#6559](https://github.com/deepseek-ai/deepseek-harness/discussions/6559) inventory, still present on 0.1.7-rc.1: `v0-retired-source-kind` — a message `source.kind` literal the writer retired (`instruction-hint`) is no longer in the v2→v3 `SOURCE_KINDS`, so `assertSource` refuses the session as unclassified; the member set is identical to the current `plugin` source, so repair renames the kind only. `v0-inbox-inserted-message` — `agent/inbox/spliced` inserted messages that lack `id`/`role`, which the v0→v1 `messageValue` inventory refuses; repair fills the missing id and the `"user"` role the validator itself passes in. Sources carrying members beyond the released plugin set are left untouched (report only). Verified against the real 0.1.7-rc.1 `sessionFormatV0ToV1` and `sessionFormatV2ToV3` stages: refused before, accepted after.
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

- `v0-chunk-provenance` missed attempts split by `llm/retry` / `llm/retry-started` ([#3](https://github.com/xiaoshenming/dsh-session-surgeon/issues/3)): the chunk-attempt group now resets exactly where the official v1→v2 `closesAttempt` does (`turn/end` / `step/end` / `llm/retry` / `llm/retry-started`), so a message citing chunks from both sides of a retry is flagged and re-cited to the surviving attempt. Replacement messages (`/rewind` markers, `surfaceOp` replace) are never rewritten — their `sourceEventSeqs` are the shadowed surface nodes `applySurface` requires.
- `v0-plugin-source-form` repair now aligns the display-only `form` (`notice` for `summary`, `snapshot` for `sections`) instead of deleting the member; only a genuine summary+sections conflict drops one of them ([#6194](https://github.com/deepseek-ai/deepseek-harness/discussions/6194), reporter-confirmed `summary requires notice form`).
- The `model/selection` downgrade shim is gated on the **installed** runtime's catalog: a host that knows the type never gets `ignorable` stamped, even when the plugin falls back to its bundled vocabulary ([#3](https://github.com/xiaoshenming/dsh-session-surgeon/issues/3)). Catalog resolution additionally probes beside the running executable, so DSH Desktop installs resolve it without a PATH `dsh`.
- Unknown-type classification accepts either the installed catalog or the legacy v0 vocabulary, so 0.1.5 hosts no longer flag retired-but-legal v0 types such as `assistant/chunk`.
- Sidebar collapse: the entry button's label now hides via `body[data-dsh-sidebar-collapsed]`, matching what dsh-better-sidebar actually sets ([#4](https://github.com/xiaoshenming/dsh-session-surgeon/issues/4) / [#5](https://github.com/xiaoshenming/dsh-session-surgeon/issues/5)).
- Windows `--apply` no longer aborts with `EPERM` when fsyncing the read-only `.bak.<utc>` handle ([#4178](https://github.com/deepseek-ai/deepseek-harness/discussions/4178) / [#1452](https://github.com/deepseek-ai/deepseek-harness/discussions/1452)).

### Not in scope (still refuse / warn only)

- Empty `callId` / empty `tool_calls[].id` / dangling `tool/call`: inspect warns (`empty-tool-call-id` / `dangling-tool-call`), repair does not invent a `tool/result` or callId.
- Unknown plugin event types: report `unknown-type`, do not stamp `ignorable`.
- Web Chat `received more than one start Match`: frontend fold, not a disk defect.
- Arbitrary dual-write branch picking when the packed/live-writer signatures do not match.

## 0.1.0

- First public plugin: copy session ID, scan / inspect / dry-run repair / apply / compact / export.
- Host tools `session_scan` / `session_inspect` / `session_repair`.
