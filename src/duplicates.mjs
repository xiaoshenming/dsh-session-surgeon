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

/**
 * The tool-call id one durable stream record carries, with a copy that swaps
 * it. Three record shapes exist: the compact `tool-call-chunks` run, and the
 * raw `chunk` wrapper for a delta the accumulator could not merge (it keeps
 * `id.length === 0 || name === ""` deltas verbatim) and for `block-end`,
 * whose assembled block the loader hands back untouched.
 */
function streamRecordId(record) {
  if (!record || typeof record !== "object") return undefined;
  if (record.type === "tool-call-chunks") {
    return { index: record.index, id: record.id, put: (id) => ({ ...record, id }) };
  }
  const chunk = record.type === "chunk" ? record.chunk : undefined;
  if (!chunk || typeof chunk !== "object") return undefined;
  if (chunk.type === "tool-call-delta" && typeof chunk.id === "string") {
    return { index: chunk.index, id: chunk.id, put: (id) => ({ ...record, chunk: { ...chunk, id } }) };
  }
  if (chunk.type === "block-end" && chunk.block?.type === "tool-call" && typeof chunk.block.id === "string") {
    return { index: chunk.index, id: chunk.block.id, put: (id) => ({ ...record, chunk: { ...chunk, block: { ...chunk.block, id } } }) };
  }
  return undefined;
}

/**
 * Re-point the ids inside the embedded stream at the suffixed ids, so the
 * reconstruction the loader compares against `message.content` still agrees.
 * Records whose id is not one of the rewritten calls are left alone; a record
 * that runs past its queue means the stream never matched the content, so the
 * caller must refuse rather than guess.
 * @returns the rewritten stream, or null when the mapping is not total.
 */
function rewriteStreamIds(stream, idQueues, rewrittenIds) {
  if (!Array.isArray(stream) || rewrittenIds.size === 0) return stream;
  let changed = false;
  const consumed = new Map();
  const byIndex = new Map();
  const next = [];
  for (const record of stream) {
    const found = streamRecordId(record);
    if (!found || typeof found.id !== "string" || !rewrittenIds.has(found.id)) {
      next.push(record);
      continue;
    }
    let mapped = byIndex.get(found.index);
    if (mapped === undefined) {
      const queue = idQueues.get(found.id) ?? [];
      const position = consumed.get(found.id) ?? 0;
      if (position >= queue.length) return null;
      consumed.set(found.id, position + 1);
      mapped = queue[position];
      byIndex.set(found.index, mapped);
    }
    if (mapped === found.id) {
      next.push(record);
      continue;
    }
    changed = true;
    next.push(found.put(mapped));
  }
  return changed ? next : stream;
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
  const resultIdBySeq = new Map();

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
      const idQueues = new Map();
      const rewrittenIds = new Set();
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
          rewrittenIds.add(id);
          rewritten += 1;
        } else {
          advertised.set(id, 1);
        }
        if (!idQueues.has(id)) idQueues.set(id, []);
        idQueues.get(id).push(finalId);
        if (!origOrder.has(id)) origOrder.set(id, []);
        origOrder.get(id).push(finalId);
      }
      if (nextContent) {
        const nextStream = rewriteStreamIds(event.data?.stream, idQueues, rewrittenIds);
        // An untotal mapping means the stream never agreed with the content;
        // writing the content alone would trade one refusal for another.
        if (nextStream === null) return { value: events, rewritten: 0 };
        value[i] = {
          ...event,
          data: {
            ...event.data,
            message: { ...event.data.message, content: nextContent },
            stream: nextStream,
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
      const id = event.data?.message?.source?.callId ?? event.data?.message?.toolCallId;
      if (typeof id !== "string" || id === "") continue;
      const sourceSeq = event.surfaceOp && typeof event.surfaceOp === "object" ? event.surfaceOp.startSeq : undefined;
      const replacementId = sourceSeq === undefined ? undefined : resultIdBySeq.get(sourceSeq);
      if (replacementId !== undefined) {
        if (replacementId !== id) {
          value[i] = { ...event, data: { ...event.data, message: {
            ...event.data.message,
            toolCallId: replacementId,
            source: { ...event.data.message.source, callId: replacementId },
          } } };
          rewritten += 1;
        }
        resultIdBySeq.set(event.seq, replacementId);
        continue;
      }
      if (!origOrder.has(id)) continue;
      const list = origOrder.get(id);
      const idx = resultCursor.get(id) ?? 0;
      if (idx >= list.length) continue;
      const finalId = list[idx];
      resultCursor.set(id, idx + 1);
      resultIdBySeq.set(event.seq, finalId);
      if (finalId !== id) {
        value[i] = {
          ...event,
          data: {
            ...event.data,
            message: {
              ...event.data.message,
              toolCallId: finalId,
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
