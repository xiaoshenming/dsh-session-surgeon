---
name: Corrupt session
about: Report a session that will not load
---

Do **not** paste raw `session.jsonl.zstd` — it contains your prompts and possibly keys.

Instead run:

```bash
node bin/dsh-session-surgeon.mjs inspect <session-id>
```

and paste the JSON report (no user message bodies).
