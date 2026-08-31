/** Official abort path pairs every tool/call with a tool/result.
 *  A call with no matching result survives load, then the next model request is 400.
 *  Detection only — repair must not invent a result or callId. */
export function danglingToolCalls(events) {
  const results = new Set();
  for (const event of events) {
    if (event.type !== "tool/result") continue;
    const id = event.data?.message?.source?.callId;
    if (typeof id === "string") results.add(id);
  }
  const dangling = [];
  for (const event of events) {
    if (event.type !== "tool/call") continue;
    const id = event.data?.callId;
    if (typeof id !== "string" || id === "" || !results.has(id)) {
      dangling.push({ seq: event.seq, callId: typeof id === "string" ? id : "" });
    }
  }
  return dangling;
}

/** Official replay boundary: user/message, assistant/message and tool/result
 *  must carry a non-empty message id, or the loader refuses the whole log. */
export function missingMessageIds(events) {
  const seqs = [];
  for (const event of events) {
    const type = event.type;
    if (type !== "user/message" && type !== "assistant/message" && type !== "tool/result") continue;
    const data = event.data;
    const record = data && typeof data === "object" ? data : undefined;
    const message = type === "user/message" ? record : record?.message;
    if (!message || typeof message !== "object" || typeof message.id !== "string" || message.id === "") {
      seqs.push(event.seq);
    }
  }
  return seqs;
}
