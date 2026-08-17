/**
 * Synthetic closers for an interrupted session tail.
 * Aligns with official interruptedTurnClosers; no @deepseek-ai/* import.
 */

export const TOOL_NOT_STARTED = "TOOL_NOT_STARTED";
export const TOOL_OUTCOME_UNKNOWN = "TOOL_OUTCOME_UNKNOWN";

const OUTCOME_UNKNOWN_TEXT =
  "The tool call was interrupted after it was recorded, but no result was durably recorded. Its outcome is unknown. Decide whether to retry from the tool semantics: retry only if the operation is read-only or idempotent; if it may have side effects, first verify external state or ask the user. Do not retry blindly.";

const NOT_STARTED_TEXT =
  "The tool call was interrupted before the Harness recorded it as started. Retry it if it is still needed.";

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const key of Object.keys(value)) deepFreeze(value[key]);
  return value;
}

function freezeMessage(message) {
  return deepFreeze(structuredClone(message));
}

function syntheticToolResultMessage(callId, seq, started) {
  return freezeMessage({
    id: `interrupted-tool-result-${callId}-${seq}`,
    role: "user",
    source: { kind: "tool", callId },
    content: [
      {
        type: "tool-result",
        toolCallId: callId,
        isError: true,
        content: [{ type: "text", text: started ? OUTCOME_UNKNOWN_TEXT : NOT_STARTED_TEXT }],
      },
    ],
  });
}

/**
 * Return deterministic synthetic events that close an open tail turn.
 * A balanced or empty log returns [].
 *
 * @param {readonly object[]} events
 * @returns {object[]}
 */
export function interruptedTurnClosers(events) {
  let openTurn = null;
  let openStep = null;
  const pendingCalls = new Map();

  for (const event of events) {
    switch (event.type) {
      case "turn/start":
        openTurn = event.data.turn;
        openStep = null;
        pendingCalls.clear();
        break;
      case "turn/end":
        openTurn = null;
        openStep = null;
        pendingCalls.clear();
        break;
      case "step/start":
        openStep = event.data.step;
        break;
      case "step/end":
        pendingCalls.clear();
        openStep = null;
        break;
      case "assistant/message":
        for (const block of event.data.message.content) {
          if (block.type === "tool-call") {
            pendingCalls.set(block.id, { step: event.data.step });
          }
        }
        break;
      case "tool/call": {
        const entry = pendingCalls.get(event.data.callId);
        if (entry) entry.callSeq = event.seq;
        break;
      }
      case "tool/result":
        pendingCalls.delete(event.data.message.source.callId);
        break;
      default:
        break;
    }
  }

  const last = events.at(-1);
  if (openTurn === null || last === undefined) return [];

  let seq = last.seq + 1;
  const time = last.time;
  const closers = [];

  for (const [callId, { step, callSeq }] of pendingCalls) {
    const started = callSeq !== undefined;
    closers.push({
      type: "tool/result",
      seq: seq++,
      time,
      data: {
        turn: openTurn,
        step,
        message: syntheticToolResultMessage(callId, seq - 1, started),
        error: started
          ? { name: "ToolOutcomeUnknownError", code: TOOL_OUTCOME_UNKNOWN }
          : { name: "ToolNotStartedError", code: TOOL_NOT_STARTED },
      },
      surfaceOp: "append",
      ...(started ? { sourceEventSeqs: [callSeq] } : {}),
    });
  }

  if (openStep !== null) {
    closers.push({
      type: "step/end",
      seq: seq++,
      time,
      data: { turn: openTurn, step: openStep },
    });
  }

  closers.push({
    type: "turn/end",
    seq: seq++,
    time,
    data: { turn: openTurn, reason: { kind: "interrupted" } },
  });

  return closers;
}
