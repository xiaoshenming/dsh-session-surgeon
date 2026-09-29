/**
 * The settlement fields a restored assistant row must carry (#8084).
 *
 * `assertAssistantSettlementShape` in `dsh-session` runs over the events a
 * `Session` is constructed with as its seed — which is the stored-log read
 * path (`Session.fromRestore`) as well as the publish/verify path. It requires
 * `turn` and `step` to be non-negative safe integers (`-0` included in the
 * rejection) and `stream` to be an array, on `assistant/message` and
 * `assistant/attempt`, and refuses the whole session over one bad row:
 *
 *   seed assistant/message at index 4002 has invalid settlement fields
 *
 * The writer's append path does not check these three, so a row can be written
 * that only fails on the next load. `stream` is a non-empty array in every
 * healthy row we have measured (5..26 entries), and it is what the streamed
 * blocks are rebuilt from — it cannot be reconstructed from the artifact, so
 * this is report-only.
 *
 * v0 is excluded: a released v0 `assistant/message` may not carry `stream` at
 * all (the v0→v1 payload gate rejects it as an unexpected member), and the
 * member set only becomes `[turn, step, message, stream]` in the v2 inventory.
 *
 * `stream` cannot be reconstructed, but the row is still repairable: see
 * `settle.mjs` for the measured reason an empty array is admissible.
 */
export const SETTLEMENT_TYPES = new Set(["assistant/message", "assistant/attempt"]);

/** `-0` passes `>= 0` but is refused by the gate, so it is tested explicitly. */
export function isOrdinal(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0);
}

/** @returns {{seq: number, type: string, members: string[]}[]} */
export function settlementShapeHits(events) {
  const hits = [];
  for (const event of events) {
    if (!SETTLEMENT_TYPES.has(event.type)) continue;
    const data = event.data;
    const members = [];
    if (!isOrdinal(data?.turn)) members.push("turn");
    if (!isOrdinal(data?.step)) members.push("step");
    if (!Array.isArray(data?.stream)) members.push("stream");
    if (members.length > 0) hits.push({ seq: event.seq, type: event.type, members });
  }
  return hits;
}
