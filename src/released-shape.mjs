/**
 * Rows a truncated or half-written v0 log really contains: the type survived,
 * a member the released inventory requires did not. The official v0->v1 payload
 * gate refuses the whole session over one such row (`… lacks required member
 * "reason"`), so silence here would mean telling a user their file is `ok` while
 * the loader refuses it.
 *
 * The table is derived by ablation against the released validator
 * (`assertReleasedV0Keys` in `dsh-session-format-v0-to-v1`): remove one member,
 * keep it only when the gate refuses that removal. It is deliberately partial —
 * only the types measured end to end are listed, and per-block members are
 * skipped because they vary by block type (`text` vs `tool-result`), where a
 * mirror would have to reproduce the whole block table to stay honest. Extend it
 * the same way: measure against the released package, then add.
 *
 * `subagent/descriptor` is absent on purpose: `v0-descriptor-version` already
 * covers it, including a missing version, and two codes for one row is noise.
 */

const RELEASED_V0_REQUIRED = {
  "turn/start": { data: ["turn"] },
  "step/start": { data: ["turn", "step"] },
  "step/end": { data: ["turn", "step"] },
  "turn/end": { data: ["turn", "reason"] },
  "tool/call": { data: ["turn", "step", "callId", "name", "arguments"] },
  "permission/preset": { data: ["preset"] },
  "user/message": { data: ["id", "role", "content", "source"], dataContentArray: true },
  "assistant/message": { data: ["turn", "step", "message"], message: ["id", "role", "source"], messageContentArray: true },
  "tool/result": { message: ["id", "role", "source"], messageContentArray: true },
};

const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

function firstMissing(shape, data) {
  if (!isRecord(data)) return "data";
  const missing = (shape.data ?? []).find((member) => !Object.hasOwn(data, member));
  if (missing !== undefined) return `data.${missing}`;
  if (shape.dataContentArray && !Array.isArray(data.content)) return "data.content";
  if (!shape.message) return null;
  const message = data.message;
  if (!isRecord(message)) return "data.message";
  const nested = shape.message.find((member) => !Object.hasOwn(message, member));
  if (nested !== undefined) return `message.${nested}`;
  if (shape.messageContentArray && !Array.isArray(message.content)) return "message.content";
  return null;
}

/** Rows missing a member the released v0 inventory requires, in event order. */
export function missingMemberHits(events) {
  const hits = [];
  if (!Array.isArray(events)) return hits;
  for (const event of events) {
    const shape = RELEASED_V0_REQUIRED[event?.type];
    if (!shape) continue;
    const member = firstMissing(shape, event.data);
    if (member !== null) hits.push({ seq: event.seq, type: event.type, member });
  }
  return hits;
}
