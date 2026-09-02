/**
 * Narrow downgrade shims for newer official core events that an older loader
 * does not know. Never apply this policy to arbitrary plugin events.
 */

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isModelSelection(event) {
  if (!isRecord(event) || event.type !== "model/selection" || Object.hasOwn(event, "ignorable")) return false;
  const envelopeKeys = Object.keys(event);
  if (envelopeKeys.some((key) => key !== "type" && key !== "seq" && key !== "time" && key !== "data")) {
    return false;
  }
  if (!Number.isSafeInteger(event.seq) || typeof event.time !== "number" || !Number.isFinite(event.time)) return false;
  const data = event.data;
  if (!isRecord(data)) return false;
  const keys = Object.keys(data);
  if (keys.some((key) => key !== "provider" && key !== "model" && key !== "reasoningEffort")) return false;
  if (typeof data.provider !== "string" || data.provider.length === 0) return false;
  if (typeof data.model !== "string" || data.model.length === 0) return false;
  return data.reasoningEffort === undefined ||
    (typeof data.reasoningEffort === "string" && data.reasoningEffort.length > 0);
}

/** Return newer official events that are proven safe for an older reader to ignore. */
export function forwardEventShims(events) {
  if (!Array.isArray(events)) return [];
  return events
    .filter(isModelSelection)
    .map((event) => ({
      type: event.type,
      seq: event.seq,
      reason: "official Alpha log-only model selection; never enters derived model history",
    }));
}

/** Preserve the event and seq; add only the official unknown-reader escape hatch. */
export function applyForwardEventShims(events) {
  const shims = forwardEventShims(events);
  if (shims.length === 0) return { value: events, shims };
  return {
    value: events.map((event) => isModelSelection(event) ? { ...event, ignorable: true } : event),
    shims,
  };
}
