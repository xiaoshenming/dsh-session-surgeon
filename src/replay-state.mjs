/**
 * Pre-envelope pi-ai replayState (#5694 / #5909).
 * Released writers stored a flat `{ kind, version, api, ..., blocks }`.
 * 0.1.3 v0→v1 `replayEnvelopeValue` only admits `{ response, blocks? }`,
 * so `kind` is an unexpected member and the whole session refuses.
 * Wrap by moving every key except `blocks` under `response`. Nothing is invented.
 */

function isRecord(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

/** True when replayState is the pre-7e95a00 flat adapter form. */
export function isFlatReplayState(value) {
  return isRecord(value) && Object.hasOwn(value, "kind") && !Object.hasOwn(value, "response");
}

export function wrapFlatReplayState(value) {
  if (!isFlatReplayState(value)) return { value, wrapped: false };
  const { blocks, ...response } = value;
  const next = blocks === undefined ? { response } : { response, blocks };
  return { value: next, wrapped: true };
}

function visitReplayState(holder, key, hits, rewrite) {
  if (!isRecord(holder) || !Object.hasOwn(holder, key)) return holder;
  const current = holder[key];
  if (!isFlatReplayState(current)) return holder;
  hits.push(current);
  if (!rewrite) return holder;
  return { ...holder, [key]: wrapFlatReplayState(current).value };
}

function mapEvent(event, hits, rewrite) {
  if (!isRecord(event) || !isRecord(event.data)) return event;
  let data = event.data;
  let changed = false;

  if (event.type === "assistant/chunk" && isRecord(data.chunk)) {
    const chunk = visitReplayState(data.chunk, "replayState", hits, rewrite);
    if (chunk !== data.chunk) {
      data = { ...data, chunk };
      changed = true;
    }
  }

  if (event.type === "assistant/message" && isRecord(data.message) && isRecord(data.message.source)) {
    const source = visitReplayState(data.message.source, "replayState", hits, rewrite);
    if (source !== data.message.source) {
      data = { ...data, message: { ...data.message, source } };
      changed = true;
    }
  }

  return changed ? { ...event, data } : event;
}

/** Seq numbers of events that still carry a flat replayState. */
export function flatReplayStateHits(events) {
  const seqs = [];
  if (!Array.isArray(events)) return seqs;
  for (const event of events) {
    const hits = [];
    mapEvent(event, hits, false);
    if (hits.length > 0) seqs.push(event.seq);
  }
  return seqs;
}

export function wrapFlatReplayStates(events) {
  if (!Array.isArray(events) || events.length === 0) return { value: events, wrapped: 0 };
  let wrapped = 0;
  const value = events.map((event) => {
    const hits = [];
    const next = mapEvent(event, hits, true);
    wrapped += hits.length;
    return next;
  });
  return { value, wrapped };
}
