/**
 * Duplicate advertised tool-call ids inside one step (#5909).
 * 0.1.3 v0→v1 migration throws:
 *   assistant/message repeats advertised tool call ${callId}
 * v0 writers never enforced uniqueness. Detection always; repair only when
 * the installed runtime's format version is >= 1 (migration would refuse).
 * Never invents an id from empty — only suffixes a later duplicate of an
 * id that already exists on disk.
 */

function toolCallBlockId(block) {
  if (!block || typeof block !== "object") return undefined;
  if (typeof block.id === "string") return block.id;
  if (typeof block.callId === "string") return block.callId;
  return undefined;
}

function assistantToolCallBlocks(event) {
  if (event?.type !== "assistant/message") return [];
  const content = event.data?.message?.content;
  return Array.isArray(content) ? content : [];
}

function clearLifecycle(type) {
  return type === "turn/start" || type === "step/end";
}

function rewriteId(id, n) {
  return `${id}#${n}`;
}

/** Hits where an assistant/message re-advertises a callId already seen this step. */
export function duplicateAdvertisedToolCallIds(events) {
  const hits = [];
  if (!Array.isArray(events)) return hits;
  const advertised = new Set();
  for (const event of events) {
    if (clearLifecycle(event.type)) advertised.clear();
    for (const block of assistantToolCallBlocks(event)) {
      if (block?.type !== "tool-call") continue;
      const id = toolCallBlockId(block);
      if (typeof id !== "string" || id === "") continue;
      if (advertised.has(id)) hits.push({ seq: event.seq, callId: id });
      advertised.add(id);
    }
  }
  return hits;
}

/**
 * Keep the first advertised id; suffix later duplicates in the same step,
 * then remap tool/call.callId and tool/result source.callId in appearance order.
 */
export function disambiguateDuplicateToolCallIds(events) {
  if (!Array.isArray(events) || events.length === 0) return { value: events, rewritten: 0 };
  let rewritten = 0;
  const value = events.map((event) => event);
  let advertised = new Map();
  let origOrder = new Map();
  let callCursor = new Map();
  let resultCursor = new Map();

  function reset() {
    advertised = new Map();
    origOrder = new Map();
    callCursor = new Map();
    resultCursor = new Map();
  }

  for (let i = 0; i < value.length; i++) {
    const event = value[i];
    if (clearLifecycle(event.type)) reset();

    if (event.type === "assistant/message") {
      const content = event.data?.message?.content;
      if (!Array.isArray(content)) continue;
      let nextContent = null;
      for (let b = 0; b < content.length; b++) {
        const block = content[b];
        if (!block || block.type !== "tool-call") continue;
        const id = toolCallBlockId(block);
        if (typeof id !== "string" || id === "") continue;
        let finalId = id;
        if (advertised.has(id)) {
          const n = advertised.get(id) + 1;
          advertised.set(id, n);
          finalId = rewriteId(id, n);
          if (!nextContent) nextContent = content.slice();
          nextContent[b] = { ...block, id: finalId };
          rewritten += 1;
        } else {
          advertised.set(id, 1);
        }
        if (!origOrder.has(id)) origOrder.set(id, []);
        origOrder.get(id).push(finalId);
      }
      if (nextContent) {
        value[i] = {
          ...event,
          data: {
            ...event.data,
            message: { ...event.data.message, content: nextContent },
          },
        };
      }
      continue;
    }

    if (event.type === "tool/call") {
      const id = event.data?.callId;
      if (typeof id !== "string" || id === "" || !origOrder.has(id)) continue;
      const list = origOrder.get(id);
      const idx = callCursor.get(id) ?? 0;
      if (idx >= list.length) continue;
      const finalId = list[idx];
      callCursor.set(id, idx + 1);
      if (finalId !== id) {
        value[i] = { ...event, data: { ...event.data, callId: finalId } };
        rewritten += 1;
      }
      continue;
    }

    if (event.type === "tool/result") {
      const id = event.data?.message?.source?.callId;
      if (typeof id !== "string" || id === "" || !origOrder.has(id)) continue;
      const list = origOrder.get(id);
      const idx = resultCursor.get(id) ?? 0;
      if (idx >= list.length) continue;
      const finalId = list[idx];
      resultCursor.set(id, idx + 1);
      if (finalId !== id) {
        value[i] = {
          ...event,
          data: {
            ...event.data,
            message: {
              ...event.data.message,
              source: { ...event.data.message.source, callId: finalId },
            },
          },
        };
        rewritten += 1;
      }
    }
  }
  return { value, rewritten };
}
