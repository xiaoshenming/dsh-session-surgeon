# Synthetic fixtures

Week 1 will add:

- `torn-tail.session.jsonl.zstd` — last zstd frame truncated
- `seq-gap-committed.session.jsonl.zstd` — overlap after a turn/end
- `lone-surrogate.session.jsonl.zstd` — isolated UTF-16 code unit in a user line
- `orphan-tmp/` — leftover `session.jsonl.zstd.tmp`

Do not copy files from `~/.dsh/sessions` into this folder.
