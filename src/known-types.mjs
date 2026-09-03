/**
 * Session event vocabulary aligned with the installed @deepseek-ai/dsh-session catalog.
 * Unknown types without the envelope `ignorable: true` marker are reported,
 * not dropped.
 */
import { existsSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { delimiter, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const FALLBACK_SESSION_EVENT_TYPES = [
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
];

function dshRequires() {
  const requires = [createRequire(import.meta.url)];
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (dir === "") continue;
    const candidate = join(dir, process.platform === "win32" ? "dsh.cmd" : "dsh");
    if (!existsSync(candidate)) continue;
    try {
      requires.push(createRequire(realpathSync(candidate)));
    } catch {
      // Ignore stale or non-file PATH entries.
    }
  }
  return requires;
}

async function installedCatalog() {
  for (const requireFrom of dshRequires()) {
    try {
      const root = requireFrom.resolve("@deepseek-ai/dsh-session");
      const modulePath = join(dirname(root), "types", "known-event-types.js");
      const loaded = await import(pathToFileURL(modulePath).href);
      const catalog = loaded.KNOWN_SESSION_EVENT_TYPES;
      if (catalog instanceof Set && [...catalog].every((type) => typeof type === "string")) {
        return { catalog: new Set(catalog), source: modulePath };
      }
    } catch {
      // Try the next resolver; standalone installs may not expose core peers.
    }
  }
  return { catalog: new Set(FALLBACK_SESSION_EVENT_TYPES), source: "fallback" };
}

const installed = await installedCatalog();
export const KNOWN_SESSION_EVENT_TYPES = installed.catalog;
export const KNOWN_SESSION_EVENT_TYPES_SOURCE = installed.source;

/** True when `type` (or `event.type`) is in this build's session vocabulary. */
export function isKnownEventType(typeOrEvent) {
  const type = typeof typeOrEvent === "string" ? typeOrEvent : typeOrEvent?.type;
  return typeof type === "string" && KNOWN_SESSION_EVENT_TYPES.has(type);
}

/** True when the event envelope carries the official `ignorable: true` marker. */
export function isIgnorable(event) {
  return event != null && typeof event === "object" && event.ignorable === true;
}
