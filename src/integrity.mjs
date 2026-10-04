function toolCallBlockId(block) {
  if (!block || typeof block !== "object") return undefined;
  if (typeof block.id === "string") return block.id;
  if (typeof block.callId === "string") return block.callId;
  return undefined;
}

/**
 * Official abort path pairs every tool/call with a tool/result, and the
 * lifecycle fold only demands the pairing when the step closes
 * (`assertNoUnresolvedTools(toolLifecycles, "step/end")`): a call whose step is
 * still open at the end of the log is the ordinary crash shape, and the
 * engine's own `interruptedTurnClosers()` writes its result on resume, so it
 * must not be reported as a refusal — measured on a real 2970-event v4 log,
 * which the shipped 0.2.0-rc.2 verifier accepts with the call unresolved.
 * A call whose step did close without a result survives load but the next
 * model request is 400, and reading a stored v4 log refuses it outright.
 * Detection only — repair must not invent a result or callId.
 */
export function danglingToolCalls(events) {
  const results = new Set();
  for (const event of events) {
    if (event.type !== "tool/result") continue;
    const id = event.data?.message?.source?.callId;
    if (typeof id === "string") results.add(id);
  }
  const dangling = [];
  let stepOpen = false;
  let pending = [];
  const flush = () => {
    dangling.push(...pending);
    pending = [];
  };
  for (const event of events) {
    switch (event.type) {
      case "step/start":
        flush();
        stepOpen = true;
        break;
      case "step/end":
        flush();
        stepOpen = false;
        break;
      case "turn/start":
      case "turn/end":
        flush();
        stepOpen = false;
        break;
      case "tool/call": {
        const id = event.data?.callId;
        if (typeof id === "string" && id !== "" && results.has(id)) break;
        const hit = { seq: event.seq, callId: typeof id === "string" ? id : "" };
        // An empty id is refused on the call itself, so it never waits for the step to close.
        if (stepOpen && hit.callId !== "") pending.push(hit);
        else dangling.push(hit);
        break;
      }
      default:
        break;
    }
  }
  // Anything still pending belongs to the step that is open at the tail.
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
