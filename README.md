# dsh-session-surgeon

Copy a session ID from the sidebar ⋯ menu, then paste it into a new chat so the new session can learn from the old one — the Codex-style “continue from this thread” move that stock DSH does not expose.

Also repairs DeepSeek Harness sessions that refuse to load — seq gap, torn zstd, lone surrogates, events missing their message id, and `assistant/message` / `assistant/attempt` rows whose settlement fields the seed/restore gate refuses (#8084: `seed assistant/message at index N has invalid settlement fields` — we name the row and which of `turn`/`step`/`stream` tripped, then repair it: `turn`/`step` from the pair the log has open at that seq, and a missing `stream` as an empty array, the one value both gates admit, leaving `message.content`, `usage` and the replay state untouched). `inspect` also **warns** on dangling `tool/call` (no matching `tool/result` → next model request 400) and on steps that continue a turn the log already closed (#7824: the released walker refuses those with `does not match an open turn and step`), but **will not invent** a fake result, a turn boundary, or streamed blocks that are gone. 官方以后修加载器，也救不回已经坏掉的 `session.jsonl.zstd`。

> Verified against `@deepseek-ai/dsh@0.1.7-rc.2` (format **v4**, npm `latest` and `next` since 2026-09-27; the same checks were run on `0.1.7-rc.1`); `session.vN.jsonl.zstd` from every released generation (v0 … v4) is inspected and repaired the same way. Catalog, seq-range handling, and format version follow the *installed* runtime.

## Why copy the session ID

Stock DSH session ⋯ only has rename / fork / archive. There is no “copy ID”.

After this plugin:

1. Left sidebar, click ⋯ on a session → **复制会话 ID**
2. Open a new chat and paste something like:

   ```text
   Continue from session session-1e66cda9-a046-4893-8f4b-b817080acbea.
   Read that log if you need prior context.
   ```

   or, for an agent with tools:

   ```text
   session_inspect id=session-1e66cda9-a046-4893-8f4b-b817080acbea
   Then keep going from where that conversation left off.
   ```

The ID is the durable handle (with or without the `session-` prefix — same session). Fork duplicates a file; copying the ID lets a **new** session refer to the old one, the way people pass a Codex thread id around.

## Install

**DSH Desktop** (the app this repo is developed against since 2026-09-29): open the **Plugins** page and add the upstream git package `github:xiaoshenming/dsh-session-surgeon#main`. The profile lives in `~/.dsh/profiles/desktop`, and pnpm resolves `#main` to a commit tarball there. The Desktop shell (bundled `@deepseek-ai/dsh-web-frontend@0.2.0-rc.2`) is what serves the `sidebar.panellist` / `main` seats this plugin registers into, so 会话医生 is a real sidebar row and a real center-column page — the same container the shipped Plugins page uses — rather than a DOM overlay.

The same install from a CLI profile:

```bash
dsh plugin --profile desktop add "github:xiaoshenming/dsh-session-surgeon#main"
```

Then:

- Session ⋯ menu: **复制会话 ID** (the everyday action) / inspect / dry-run repair
- Sidebar **会话医生 / Session surgeon**: browse conversations, copy id, dry-run repair, apply repair, compact preview, export JSONL

**Updating** is the Plugins page's update action for this plugin (pnpm re-resolves `#main` to the new commit), or from the profile:

```bash
cd ~/.dsh/profiles/desktop && pnpm update dsh-session-surgeon
```

No `dsh web` restart and no re-`add` — the installed copy is a plain pnpm checkout without a `.git` of its own, so push to `main` first and update after.

For local development, use the pinned dsh version and pnpm lockfile (Node.js 24):

```bash
pnpm install --frozen-lockfile
export DSH_HOME="$HOME/.dsh-surgeon-dev"
./node_modules/.bin/dsh plugin --profile web add "link:$(pwd)"
./node_modules/.bin/dsh web
```

`DSH_HOME` keeps development sessions separate; the panel/CLI follow it (`$DSH_SESSION_ROOT` → `$DSH_HOME/sessions` → `~/.dsh/sessions`) and the panel's *session root* picker lists every DSH home it can find on the machine (by home shape, plus any path you type), so sessions in the other home are one click away. Avoid reinstalling this checkout with npm: duplicate physical copies of `@deepseek-ai/dsh-tools` can make tool calls fail with `reading 'prepare'`.

In an agent chat that has this checkout (or the installed plugin skills), **更新 / 更新插件** is enough: scan official Discussions, absorb in-scope repair feedback, changelog, reply, push `main` via `px` (`127.0.0.1:7897`). See [skills/dsh-session-surgeon-update/SKILL.md](./skills/dsh-session-surgeon-update/SKILL.md). If the agent's skill catalog does not list it, have it read that file directly — the workflow is plain markdown and needs no registration.

DSH's skill index reads `<project>/.dsh/skills`, `<project>/.agents/skills`, `$DSH_HOME/skills` and `~/.agents/skills` — **not** the `skills/` directory inside an installed plugin. To have the Desktop catalog list this skill, link it into the user root (the link follows every plugin update):

```bash
mkdir -p ~/.dsh/skills
ln -sfn ~/.dsh/profiles/desktop/node_modules/dsh-session-surgeon/skills/dsh-session-surgeon-update \
        ~/.dsh/skills/dsh-session-surgeon-update
```

## Also: repair unloadable sessions

Real crash families from official Discussions:

- [#317](https://github.com/deepseek-ai/deepseek-harness/discussions/317) stack overflow on huge history
- [#1497](https://github.com/deepseek-ai/deepseek-harness/discussions/1497) / [#1586](https://github.com/deepseek-ai/deepseek-harness/discussions/1586) `seq gap in committed region`
- [#436](https://github.com/deepseek-ai/deepseek-harness/discussions/436) lone UTF-16 surrogate → permanent HTTP 400
- [#674](https://github.com/deepseek-ai/deepseek-harness/discussions/674) leftover `.tmp` plaintext

Default repair is dry-run. `--apply` writes `.bak.<utc>` first, never invents missing seqs, and fills missing message ids without dropping events. If a crash-recovery closer collided with a still-live writer (#1586), repair drops those synthetic closers and keeps the live tail instead of truncating at the first gap. A packed chunk row that overlaps already-committed seqs but continues through the cursor (#5151) keeps the uncommitted suffix. Compact refuses an unloadable file — repair first, with all writers stopped. Alpha compressed `sourceEventSeqs` ranges (#5160) are native on 0.1.2-rc.1+ (surgeon does not rewrite). Older rc.2 still cannot fold them — repair expands inclusive pairs into dense integers; nothing is invented. A validated Alpha `model/selection` event is preserved and marked `ignorable: true` for rc.2; arbitrary unknown plugin events are never changed. Empty `tool_calls[].id` (#5182) is flagged `empty-tool-call-id`; repair will not invent an id. Sessions that refuse to load **after upgrading to 0.1.5** (#6151 / #6175 / #6189 / #6194 — extra `permission/preset` members, `subagent/descriptor` version 2, mismatched plugin-source `form`/`summary`, broken chunk provenance) are normalized losslessly against the released v0 inventory — verified against the real `sessionFormatV0ToV1` stage — when the installed runtime migrates v0 itself. Unknown types (`session/imported`, plugin messages) are reported only; the converter refuses them even when `ignorable` and repair never deletes events. Two further released-writer refusals still present on 0.1.7-rc.1 ([#6559](https://github.com/deepseek-ai/deepseek-harness/discussions/6559)) are handled the same way: a retired `source.kind` literal (`instruction-hint`, no longer in the v2→v3 `SOURCE_KINDS`) is renamed to its same-member successor `plugin`, and an `agent/inbox/spliced` inserted message missing `id`/`role` gets the id plus the `"user"` role the official validator itself supplies. Sources or messages carrying members beyond the released shape are reported, never guessed.

## CLI

No `dsh web` required after the plugin (or this repo) is on disk:

```bash
npx --yes github:xiaoshenming/dsh-session-surgeon scan
npx --yes github:xiaoshenming/dsh-session-surgeon inspect <session-id>
npx --yes github:xiaoshenming/dsh-session-surgeon repair <session-id>          # dry-run
npx --yes github:xiaoshenming/dsh-session-surgeon repair <session-id> --apply  # writes .bak.<utc> first
```

Or from a clone: `node bin/dsh-session-surgeon.mjs scan`.

Agent tools after install: `session_scan` / `session_inspect` / `session_repair` (`apply` defaults to false).

## Commands

| command | meaning |
|---|---|
| `scan [root]` | list sessions + header health + orphan `.tmp` |
| `inspect <id>` | decode every zstd frame, expand packed rows, report seq gaps / missing ids / dangling tool/call / steps after a closed turn |
| `repair <id>` | default `--dry-run`; `--apply` rewrites after `.bak.<utc>` |
| `compact <id> --keep-last-turns N` | keep the last N complete turns, renumber seq from 0 |
| `export <id>` | JSONL dump; redacts secrets unless `--no-redact` |
| `index [root]` | session / parent / goal / health table |

`--format text` prints a human table. Exit 0 on success, 2 on usage error, 1 on not-found / refuse.

## What this is not

Not a marketplace, not a token heatmap, not a memory plugin, not a Codex task store.

DSH has **session id + optional same-session goal id**, not a Codex-style resumable task id. Copying the session ID is the closest everyday equivalent. See [docs/LEARNING-TASKS.md](./docs/LEARNING-TASKS.md).

## Docs

- [docs/PLAN.md](./docs/PLAN.md) — milestones, safety, release
- [docs/SESSION-FORMAT.md](./docs/SESSION-FORMAT.md) — zstd frames, header, packed rows, when the official loader refuses
- [docs/REPAIR-SPEC.md](./docs/REPAIR-SPEC.md) — repair steps aligned with the official loader
- [docs/LEARNING-TASKS.md](./docs/LEARNING-TASKS.md) — why there is no Codex task id
- [docs/IMPLEMENTATION-CONTRACT.md](./docs/IMPLEMENTATION-CONTRACT.md) — multi-agent implementation contract
- [CHANGELOG.md](./CHANGELOG.md) — user-facing changes

## Safety

- Default is read-only. Write paths require `--apply` and write `.bak.<utc>` first. Windows: fsync on the read-only backup handle used to abort with `EPERM` after the copy already succeeded; `--apply` now treats that as best-effort.
- Never commit raw files from `~/.dsh/sessions` (they contain user text and secrets).
- Do **not** put `@deepseek-ai/dsh-tools` in `dependencies`.
- Export redacts `sk-*`, PEM blocks, and home paths unless `--no-redact`.

## License

MIT
