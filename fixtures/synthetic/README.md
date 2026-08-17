# Synthetic fixtures

Golden samples for scan / inspect / repair. Generated only by
`node fixtures/synthetic/build.mjs`. **Never** copy files from
`~/.dsh/sessions` into this folder.

Each `.session.jsonl.zstd` is official-shaped: frame 0 is the header
line only; later frames are event batches. Frames are compressed with
`node:zlib.zstdCompress` and `checksumFlag=1`. Headers are
`type=session` / `version=0` / non-negative `createdAt` +
`delegationDepth`, no retired `sandboxMode` / `approvalPolicy`.

| file | defect | expected |
|---|---|---|
| `healthy-packed.session.jsonl.zstd` | none | header + `turn/start` + packed `text-chunks` (≥3 `text-delta`) + `assistant/message` + `turn/end`. After expand, seq is contiguous. dry-run: 0 required edits. |
| `torn-tail.session.jsonl.zstd` | last complete frame then last-frame checksum truncated | inspect reports `torn-tail`; `repair --apply` keeps flushed complete lines, seq contiguous, synthesizes `turn/end`. |
| `seq-gap-committed.session.jsonl.zstd` | turn 1 fully closed, then seq jumps, later another `turn/end` | stop at the last `turn/end` before the gap; later turn discarded. |
| `lone-surrogate.session.jsonl.zstd` | `user/message` text contains isolated high surrogate U+D800 | replace with U+FFFD; seq unchanged. |
| `orphan-tmp/session.jsonl.zstd` | healthy tiny log | scan lists it. |
| `orphan-tmp/session.jsonl.zstd.tmp` | leftover sibling of the healthy log | scan lists the orphan; repair must not treat `.tmp` as the canonical file. |

Regenerate:

```
node fixtures/synthetic/build.mjs
```

The builder self-checks header shape, packed expand, torn-frame
incompleteness, the committed seq hole, and the persisted lone
surrogate before printing paths.
