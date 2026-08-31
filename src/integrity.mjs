function toolCallBlockId(block) {
  if (!block || typeof block !== "object") return undefined;
  if (typeof block.id === "string") return block.id;
  if (typeof block.callId === "string") return block.callId;
  return undefined;
}

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

/**
 * Empty tool-call ids on the wire (#5182 / #4908): next model request is
 * `tool_calls[0] id cannot be empty`. Detection only — never invent an id.
 */
export function emptyToolCallIds(events) {
  const hits = [];
  if (!Array.isArray(events)) return hits;
  for (const event of events) {
    if (event.type === "tool/call") {
      const id = event.data?.callId;
      if (typeof id !== "string" || id === "") {
        hits.push({ seq: event.seq, where: "tool/call", callId: typeof id === "string" ? id : "" });
      }
    }
    if (event.type === "assistant/message") {
      const content = event.data?.message?.content;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        if (!block || block.type !== "tool-call") continue;
        const id = toolCallBlockId(block);
        if (typeof id !== "string" || id === "") {
          hits.push({ seq: event.seq, where: "assistant/message", callId: typeof id === "string" ? id : "" });
        }
      }
    }
  }
  return hits;
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
