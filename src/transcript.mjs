import { redactString } from "./redact.mjs";

function clip(text, max = 6000) {
  const value = String(text ?? "");
  return value.length > max ? value.slice(0, max) + "…" : value;
}

function fromBlocks(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    if (block.type === "text" && block.text) parts.push(block.text);
  }
  return parts.join("\n").trim();
}

function isNoise(text) {
  return /^(?:<system-reminder>|Current runtime context\.|This is an automatically generated checkpoint|# Agent Rules\b)/.test(text);
}

function isHumanUser(event) {
  const kind = event.data?.source?.kind;
  return kind === "user" || kind === undefined;
}

/** Latest session/title written into the log. */
export function lastTitle(events) {
  let title = "";
  for (const event of events) {
    if (event.type === "session/title" && typeof event.data?.title === "string") {
      title = event.data.title;
    }
  }
  return title;
}

function prepare(event, redact) {
  const raw = event.type === "user/message"
    ? fromBlocks(event.data?.content)
    : fromBlocks(event.data?.message?.content ?? event.data?.content);
  const text = clip(redact ? redactString(raw) : raw);
  return text;
}

/**
 * Readable chat: human user turns plus the last assistant reply in each turn.
 * Skips plugin/system injections, token chunks, and tool-only steps.
 */
export function buildTranscript(events, { redact = true, maxTurns = 30 } = {}) {
  const users = [];
  const assistants = [];
  for (const event of events) {
    if (event.type === "user/message" && isHumanUser(event)) {
      const text = prepare(event, redact);
      if (text && !isNoise(text)) users.push({ role: "user", text, seq: event.seq });
    } else if (event.type === "assistant/message") {
      const text = prepare(event, redact);
      if (text) assistants.push({ role: "assistant", text, seq: event.seq });
    }
  }
  const chosen = users.length > maxTurns ? users.slice(-maxTurns) : users;
  const messages = [];
  for (let i = 0; i < chosen.length; i++) {
    const user = chosen[i];
    const nextSeq = chosen[i + 1]?.seq ?? Number.POSITIVE_INFINITY;
    messages.push(user);
    const reply = assistants.findLast((a) => a.seq > user.seq && a.seq < nextSeq);
    if (reply) messages.push(reply);
  }
  if (!chosen.length && assistants.length) messages.push(assistants.at(-1));
  return {
    title: lastTitle(events),
    count: users.length + assistants.length,
    omitted: Math.max(0, users.length - chosen.length),
    messages,
  };
}
