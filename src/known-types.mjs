/**
 * Session event vocabulary aligned with the installed @deepseek-ai/dsh-session catalog.
 * Unknown types without the envelope `ignorable: true` marker are reported,
 * not dropped.
 */

export const KNOWN_SESSION_EVENT_TYPES = new Set([
  "agent-preset/selected",
  "agent/inbox/spliced",
  "approval/asked",
  "approval/decided",
  "approval/policy",
  "assistant/chunk",
  "assistant/message",
  "command/done",
  "command/run",
  "compaction/end",
  "compaction/prune",
  "compaction/start",
  "compaction/summary",
  "feedback/record",
  "goal/change",
  "hook/invoked",
  "hook/result",
  "llm/retry",
  "llm/retry-started",
  "permission/preset",
  "plan/mode",
  "request/context",
  "request/header",
  "sandbox/mode",
  "schedule/change",
  "session/end-seed",
  "session/title",
  "session/title-llm-request",
  "step/end",
  "step/start",
  "subagent/descriptor",
  "team/member",
  "team/message/delivered",
  "team/message/queued",
  "team/task",
  "todo/write",
  "tool-workflow/agent-end",
  "tool-workflow/agent-start",
  "tool-workflow/run-end",
  "tool-workflow/run-start",
  "tool/call",
  "tool/code-dispatch",
  "tool/code-dispatch-start",
  "tool/result",
  "turn/end",
  "turn/start",
  "user/message",
  "web/deepseek-search-llm-request",
]);

/** True when `type` (or `event.type`) is in this build's session vocabulary. */
export function isKnownEventType(typeOrEvent) {
  const type = typeof typeOrEvent === "string" ? typeOrEvent : typeOrEvent?.type;
  return typeof type === "string" && KNOWN_SESSION_EVENT_TYPES.has(type);
}

/** True when the event envelope carries the official `ignorable: true` marker. */
export function isIgnorable(event) {
  return event != null && typeof event === "object" && event.ignorable === true;
}
