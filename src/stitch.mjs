/** Crash-recovery closers vs a live writer that never died (#1586 / #1497). */

export function isInterruptedToolResult(event) {
  if (event?.type !== "tool/result") return false;
  const id = event.data?.message?.id;
  return typeof id === "string" && id.startsWith("interrupted-tool-result-");
}

/**
 * Index of the first synthetic recovery closer at the end of `events`,
 * or -1 if the suffix is not the official interrupted-turn repair shape.
 *
 * Typical suffix: interrupted-tool-result+ / optional step/end /
 * turn/end{interrupted} / optional session/end-seed.
 */
export function recoveryCloserStart(events) {
  if (!Array.isArray(events) || events.length === 0) return -1;
  let i = events.length - 1;
  if (events[i]?.type === "session/end-seed") i -= 1;
  if (i < 0 || events[i]?.type !== "turn/end") return -1;
  if (events[i].data?.reason?.kind !== "interrupted") return -1;
  i -= 1;
  if (i >= 0 && events[i]?.type === "step/end") i -= 1;
  while (i >= 0 && isInterruptedToolResult(events[i])) i -= 1;
  const start = i + 1;
  return start < events.length ? start : -1;
}

export function takeContinuousOverflow(overflow, expectedSeq) {
  if (!Array.isArray(overflow) || overflow.length === 0) return [];
  if (overflow[0]?.seq !== expectedSeq) return [];
  const out = [];
  for (let i = 0; i < overflow.length; i++) {
    if (overflow[i]?.seq !== expectedSeq + i) break;
    out.push(overflow[i]);
  }
  return out;
}

function liveHasWork(events) {
  return events.some((event) => {
    const type = event?.type;
    return (
      type === "tool/call" ||
      type === "tool/code-dispatch" ||
      type === "tool/code-dispatch-start" ||
      type === "assistant/chunk" ||
      type === "assistant/message" ||
      type === "user/message"
    );
  });
}

/**
 * If the committed prefix ends on crash-recovery closers and overflow
 * resumes at the same seq (stale in-memory cursor), drop the closers
 * and keep the live writer. Seq numbers already match — nothing is invented.
 * Returns null when the shape is not safe to stitch.
 */
export function stitchLiveWriterTail(events, overflow) {
  const start = recoveryCloserStart(events);
  if (start < 0) return null;
  const expected = events[start].seq;
  const live = takeContinuousOverflow(overflow, expected);
  if (live.length === 0 || !liveHasWork(live)) return null;
  return {
    events: events.slice(0, start).concat(live),
    droppedClosers: events.length - start,
    keptLive: live.length,
    stitchSeq: expected,
  };
}
