/**
 * Rows a truncated or half-written v0 log really contains: the type survived,
 * a member the released inventory requires did not. The official v0->v1 payload
 * gate refuses the whole session over one such row (`… lacks required member
 * "reason"`), so silence here would mean telling a user their file is `ok` while
 * the loader refuses it.
 *
 * The table is derived by ablation against the released validator: remove one
 * member, keep it only when the v0->v1 payload gate refuses that removal. The
 * released package also declares its inventory (`RELEASED_V0_EVENT_DISPOSITIONS`,
 * 51 types, `disposition([required], [optional])`) and the gate enforces it
 * generically — every entry here was cross-checked against that table and
 * matches it. The table is still not a safe substitute: it declares
 * `assistant/chunk` requires `chunk`, while the gate accepts a chunk row with a
 * missing `chunk` *and* with an unexpected extra member, i.e. that type is never
 * validated on this path. Embedding the declaration wholesale would therefore
 * report rows the loader loads. Coverage stays partial for the same reason:
 * extending it means building a baseline the gate accepts for each further type
 * and ablating it, not copying the declaration. Per-block members are skipped
 * too, since they vary by block type (`text` vs `tool-result`) and a mirror
 * would have to reproduce the whole block table to stay honest.
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
  "agent/inbox/spliced": { data: ["target", "start", "inserted"] },
  "goal/change": { data: ["kind", "version", "operation"] },
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
