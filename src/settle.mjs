import { SETTLEMENT_TYPES, isOrdinal } from "./settlement.mjs";

/**
 * Make an assistant row the settlement gate refuses admissible again (#8084).
 *
 * The two members are not the same kind of problem.
 *
 * `turn` and `step` are not a guess: the log states which turn and step are
 * open at the row's seq, and the released walker only admits a step-scoped row
 * that matches that open pair — so the enclosing pair is the value the row
 * belongs to, and the rewrite is lossless. When nothing is open at that seq
 * (the row sits outside any turn) there is nothing to derive and the member is
 * left alone.
 *
 * `stream` is different: it is exactly what is missing, so there is nothing to
 * recover. An empty array is the one admissible value, measured against the
 * installed runtime rather than reasoned about:
 *
 *   - the settlement gate accepts it, because `Array.isArray([])` holds;
 *   - `assertCurrentAssistantStreams` (persistence-jsonl `lib/index.js:1833`)
 *     expands it to nothing and then `continue`s before comparing
 *     `message.content`, `usage` and `message.source.replayState` against the
 *     stream, so the row is not cross-checked against blocks that are gone;
 *   - a deleted or `null` stream fails both: the gate throws
 *     `seed assistant/message at index N has invalid settlement fields` and the
 *     expander throws `stream is not iterable`.
 *
 * The streamed deltas for that attempt are gone either way. The conversation
 * text lives in `message.content` and is never touched, and neither are `usage`
 * or the replay state.
 */
export function settleAssistantFields(events) {
  const value = events.map((event) => event);
  const actions = [];
  let openTurn = null;
  let openStep = null;

  for (let index = 0; index < value.length; index++) {
    const event = value[index];
    const type = event?.type;
    const data = event?.data && typeof event.data === "object" ? event.data : {};

    if (type === "turn/start") {
      openTurn = isOrdinal(data.turn) ? data.turn : null;
      openStep = null;
      continue;
    }
    if (type === "turn/end") {
      openTurn = null;
      openStep = null;
      continue;
    }
    if (type === "step/start") {
      if (isOrdinal(data.turn)) openTurn = data.turn;
      openStep = isOrdinal(data.step) && data.turn === openTurn ? data.step : null;
      continue;
    }
    if (type === "step/end") {
      openStep = null;
      continue;
    }
    if (!SETTLEMENT_TYPES.has(type)) continue;

    const needTurn = !isOrdinal(data.turn);
    const needStep = !isOrdinal(data.step);
    const needStream = !Array.isArray(data.stream);
    if (!needTurn && !needStep && !needStream) continue;

    const next = { ...data };
    const patched = [];
    const stuck = [];
    if (needTurn) {
      if (openTurn === null) stuck.push("turn");
      else {
        next.turn = openTurn;
        patched.push("turn");
      }
    }
    if (needStep) {
      if (openStep === null) stuck.push("step");
      else {
        next.step = openStep;
        patched.push("step");
      }
    }
    if (needStream) {
      next.stream = [];
      patched.push("stream");
    }
    if (patched.length === 0) {
      actions.push({
        code: "settlement-unresolved",
        detail: `${type} at seq ${event.seq} still lacks ${stuck.join("+")}: no open turn or step at that seq to take the value from`,
      });
      continue;
    }
    value[index] = { ...event, data: next };
    const from = patched
      .map((member) => (member === "stream" ? "stream=[] (deltas were already absent; content, usage and replay state untouched)" : `${member}=${next[member]} (the pair open at that seq)`))
      .join(", ");
    actions.push({
      code: "settlement-fields",
      detail: `${type} at seq ${event.seq}: ${from}${stuck.length > 0 ? `; left ${stuck.join("+")} alone (nothing open to derive it from)` : ""}`,
    });
  }

  return { value, actions };
}
