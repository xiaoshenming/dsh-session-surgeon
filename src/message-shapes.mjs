/**
 * Released-writer message shapes the frozen converters refuse, reported in
 * #6559 and still present on 0.1.7-rc.1 / rc.2:
 *
 * - a retired `source.kind` literal (dsh-agent-instructions wrote
 *   {kind:"instruction-hint", plugin}) is not in the v2→v3 SOURCE_KINDS, so
 *   assertSource refuses the whole session as unclassified;
 * - `agent/inbox/spliced` inserted messages that omit id/role, which the
 *   v0→v1 messageValue inventory requires.
 *
 * Both are single-answer normalizations: the successor of the retired kind
 * keeps the same members, and the spliced message role the validator passes
 * in is literally "user". Anything outside the released member set is left
 * alone — repair reports, it does not guess.
 *
 * A third shape is repairable after all: a log already at v4 may still carry
 * the retired `{kind:"plugin", plugin}` source wrapper, which v4 admission
 * refuses while the log is read (#7772). The successor kind is not a guess —
 * the released v3→v4 stage derives it with `producerKind(plugin, role)`, a total
 * function whose tables and fallback are byte-identical in 0.1.7-rc.2 and the
 * desktop's 0.2.0-rc.2, so the repair applies that function instead of
 * inventing an answer.
 */
import { randomUUID } from "node:crypto";

// Retired writer literals whose successor is a rename with the same members.
const RETIRED_SOURCE_KINDS = { "instruction-hint": "plugin" };
const PLUGIN_SOURCE_MEMBERS = new Set(["kind", "plugin", "form", "sections", "summary"]);
const INSERTED_MESSAGE_MEMBERS = new Set(["id", "role", "content", "source"]);

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

/**
 * Rewrite every message source the official walker (`mapEventMessages`) hands
 * to `rewriteV3MessageSource`: user/message data itself, the message of
 * developer/system/assistant/tool-result events, and the inserted/messages
 * arrays of agent/inbox/spliced and session/title-llm-request. The transform
 * receives the enclosing message so a role-sensitive producer rename can be
 * resolved the way the stage resolves it.
 */
function rewriteMessageSources(event, transform) {
  const data = record(event?.data);
  if (!data) return event;
  if (event.type === "user/message") {
    const source = record(data.source);
    if (!source) return event;
    const next = transform(source, data, event);
    return next === source ? event : { ...event, data: { ...data, source: next } };
  }
  if (
    event.type === "developer/message" || event.type === "system/message" ||
    event.type === "assistant/message" || event.type === "tool/result"
  ) {
    const message = record(data.message);
    const source = message ? record(message.source) : null;
    if (!source) return event;
    const next = transform(source, message, event);
    return next === source ? event : { ...event, data: { ...data, message: { ...message, source: next } } };
  }
  const key =
    event.type === "agent/inbox/spliced" ? "inserted"
      : event.type === "session/title-llm-request" ? "messages"
        : null;
  const messages = key === null ? null : Array.isArray(data[key]) ? data[key] : null;
  if (!messages) return event;
  let changed = false;
  const nextMessages = messages.map((member) => {
    const message = record(member);
    const source = message ? record(message.source) : null;
    if (!source) return member;
    const next = transform(source, message, event);
    if (next === source) return member;
    changed = true;
    return { ...message, source: next };
  });
  return changed ? { ...event, data: { ...data, [key]: nextMessages } } : event;
}

function isRetiredSourceKind(source) {
  if (!Object.hasOwn(RETIRED_SOURCE_KINDS, source.kind)) return false;
  if (typeof source.plugin !== "string" || source.plugin === "") return false;
  return Object.keys(source).every((key) => PLUGIN_SOURCE_MEMBERS.has(key));
}

/** A: message source uses a retired kind literal whose successor is a rename (#6559). */
export function retiredSourceKindHits(events) {
  const hits = [];
  if (!Array.isArray(events)) return hits;
  for (const event of events) {
    rewriteMessageSources(event, (source) => {
      if (isRetiredSourceKind(source)) hits.push({ seq: event.seq, kind: source.kind });
      return source;
    });
  }
  return hits;
}

export function renameRetiredSourceKinds(events) {
  const hits = retiredSourceKindHits(events);
  if (hits.length === 0) return { value: events, hits };
  const value = events.map((event) =>
    rewriteMessageSources(event, (source) =>
      isRetiredSourceKind(source) ? { ...source, kind: RETIRED_SOURCE_KINDS[source.kind] } : source,
    ),
  );
  return { value, hits };
}

/**
 * C: format v4 admission refuses the literal `plugin` source kind
 * (`format v4 message requires a producer-owned source kind`), and the read
 * path checks it, so a log already at v4 that still carries the retired
 * `{kind:"plugin", plugin}` wrapper cannot be opened at all (#7772). The
 * producer kind is derived from the package name — a rename table plus a
 * released set plus a `plugin:<pkg>` fallback — which an offline tool cannot
 * reconstruct for an unknown plugin: report only, never guess.
 */
export function literalPluginSourceHits(events) {
  const hits = [];
  if (!Array.isArray(events)) return hits;
  for (const event of events) {
    rewriteMessageSources(event, (source) => {
      if (source.kind === "plugin") {
        hits.push({ seq: event.seq, plugin: typeof source.plugin === "string" ? source.plugin : null });
      }
      return source;
    });
  }
  return hits;
}

/**
 * Released v3 plugin identities whose current producer kind is not the plugin
 * string. Copied from the released v3→v4 stage (`RENAMED_PRODUCERS`,
 * `RELEASED_SAME_NAME_PRODUCERS`, `producerKind`) — byte-identical in
 * 0.1.7-rc.2 and the desktop's 0.2.0-rc.2 — because that function is what the
 * writer would have applied.
 */
const RENAMED_PRODUCERS = Object.freeze({
  "compact": "compact-checkpoint",
  "tools-code-mode": "ptc-mode",
  "tools-ptc": "ptc-mode",
  "dsh-compaction-basic": "compact-basic",
  "@deepseek-ai/dsh-system-prompt": "runtime-context",
});
const RELEASED_SAME_NAME_PRODUCERS = new Set([
  "agent-instructions",
  "session-reference",
  "team-message",
  "goal",
  "skill-invocation",
  "skill-catalog",
  "coordinator",
  "subagent-report",
  "subagent-settled",
  "webhook",
  "agent-message",
  "model-selection",
  "plan-mode",
  "time-context",
  "tmux-context",
  "user-approval",
  "repeat-tool-reminder",
  "tool-cordis",
  "cordis-host-runner",
  "tool-goal",
  "tool-jobs",
  "hooks-codex",
  "hooks-claude-code",
  "schedule",
  "dsh-session-title-llm",
]);

/** The released `producerKind(plugin, role)`: total, with `plugin:<name>` as its fallback. */
export function producerKindFor(plugin, role) {
  if (plugin === "@deepseek-ai/dsh-system-prompt" && role === "system") return "system-prompt";
  if (Object.hasOwn(RENAMED_PRODUCERS, plugin)) return RENAMED_PRODUCERS[plugin];
  if (RELEASED_SAME_NAME_PRODUCERS.has(plugin)) return plugin;
  return "plugin:" + plugin;
}

/** The released `rewritePluginSource`: drop `plugin`, replace `kind`, keep everything else. */
function rewritePluginSource(source, role) {
  const plugin = source.plugin;
  if (typeof plugin !== "string") return null;
  const kind = producerKindFor(plugin, role);
  if (Object.keys(source).length === 2) return { kind };
  const next = {};
  for (const [key, value] of Object.entries(source)) {
    if (key === "plugin") continue;
    next[key] = key === "kind" ? kind : value;
  }
  return next;
}

/**
 * Replace the retired `{kind:"plugin", plugin}` wrapper with the producer kind
 * the released stage would have written. Sources whose `plugin` is not a string
 * are left alone: there the released converter throws, so there is nothing to
 * reproduce.
 * @returns {{value: object[], rewritten: number}}
 */
export function rewriteLiteralPluginSources(events) {
  if (!Array.isArray(events) || events.length === 0) return { value: events, rewritten: 0 };
  let rewritten = 0;
  const value = events.map((event) => {
    const role = (message) => (typeof message?.role === "string" ? message.role : undefined);
    return rewriteMessageSources(event, (source, message) => {
      if (source.kind !== "plugin") return source;
      const next = rewritePluginSource(source, role(message));
      if (next === null) return source;
      rewritten += 1;
      return next;
    });
  });
  return { value, rewritten };
}

/**
 * Source kinds a slot demands beyond "a producer-owned kind". Measured against
 * the reader shipped in the desktop's 0.2.0-rc.2 bundle: for `system/message`
 * only `system-prompt` is accepted, for `assistant/message` only `model`, and
 * for `tool/result` only `tool` (that one also needs `toolCallId` matching
 * `source.callId`); `user/message` and `developer/message` accept any
 * non-empty kind that is not the retired `plugin` literal.
 */
const REQUIRED_SOURCE_KINDS = Object.freeze({
  "system/message": "system-prompt",
  "assistant/message": "model",
  "tool/result": "tool",
});

/**
 * Why the released v4 source admission would refuse this message, or null.
 *
 * `assertV4MessageSources` runs for every message slot on every read and
 * refuses the whole log when `source` is not an object or `kind` is not a
 * non-empty string that differs from the retired `plugin` literal. The
 * `plugin` literal is the one repairable shape and belongs to
 * {@link rewriteLiteralPluginSources}; everything else reported here has no
 * unique successor in the artifact, so repair must not guess one.
 * @returns {string|null} a short reason naming the member that is wrong.
 */
function sourceProblem(event, source) {
  if (record(source) === null) return "source is missing or not an object";
  const kind = source.kind;
  if (typeof kind !== "string" || kind === "") return "source.kind is missing or empty";
  if (kind === "plugin") return null;
  const required = REQUIRED_SOURCE_KINDS[event.type];
  if (required !== undefined && kind !== required) {
    return 'source.kind is "' + kind + '" but ' + event.type + ' requires "' + required + '"';
  }
  return null;
}

/** Message slots whose source sits on `data.message`. */
const MESSAGE_SLOTS = new Set(["developer/message", "system/message", "assistant/message", "tool/result"]);
/** Message slots whose sources sit in an array on `data[key]`. */
const ARRAY_SLOTS = Object.freeze({ "agent/inbox/spliced": "inserted", "session/title-llm-request": "messages" });

/**
 * The raw `source` of every message the official walker visits, `undefined`
 * included. `rewriteMessageSources` only hands over rows that already have a
 * source object — which is exactly the case this detector exists for — so the
 * slots are enumerated here instead of reusing that walk.
 */
function eventSources(event) {
  const data = record(event?.data);
  if (!data) return [];
  if (event.type === "user/message") return [data.source];
  if (MESSAGE_SLOTS.has(event.type)) {
    const message = record(data.message);
    return message ? [message.source] : [];
  }
  const key = ARRAY_SLOTS[event.type];
  if (key === undefined) return [];
  const members = Array.isArray(data[key]) ? data[key] : [];
  return members.map((member) => record(member)?.source);
}

/**
 * Every message whose source the released v4 admission refuses for a reason
 * repair cannot fix. Detection only — an absent or wrong kind has no unique
 * successor inside the artifact.
 * @returns {{seq:number,type:string,problem:string}[]}
 */
export function producerSourceHits(events) {
  const hits = [];
  if (!Array.isArray(events)) return hits;
  for (const event of events) {
    for (const source of eventSources(event)) {
      const problem = sourceProblem(event, source);
      if (problem !== null) hits.push({ seq: event.seq, type: event.type, problem });
    }
  }
  return hits;
}

/** B: agent/inbox/spliced inserted messages lack the id/role the v0 converter requires (#6559). */
export function insertedMessageHits(events) {
  const hits = [];
  if (!Array.isArray(events)) return hits;
  for (const event of events) {
    if (event?.type !== "agent/inbox/spliced") continue;
    const data = record(event.data);
    const inserted = data && Array.isArray(data.inserted) ? data.inserted : [];
    for (const [index, member] of inserted.entries()) {
      const message = record(member);
      if (!message) continue;
      // Only the released shape is fixable: content/source present, and no
      // members the converter's messageValue inventory does not admit.
      if (!Array.isArray(message.content) || !record(message.source)) continue;
      if (!Object.keys(message).every((key) => INSERTED_MESSAGE_MEMBERS.has(key))) continue;
      const needsId = typeof message.id !== "string" || message.id === "";
      const needsRole = message.role === undefined;
      if (needsId || needsRole) hits.push({ seq: event.seq, index, needsId, needsRole });
    }
  }
  return hits;
}

export function fillInsertedMessageFields(events) {
  const hits = insertedMessageHits(events);
  if (hits.length === 0) return { value: events, hits };
  const bySeq = new Map();
  for (const hit of hits) {
    const list = bySeq.get(hit.seq) ?? [];
    list.push(hit);
    bySeq.set(hit.seq, list);
  }
  const value = events.map((event) => {
    const list = bySeq.get(event.seq);
    if (list === undefined) return event;
    const inserted = event.data.inserted.map((member, index) => {
      const hit = list.find((candidate) => candidate.index === index);
      if (hit === undefined) return member;
      const patched = { ...member };
      if (hit.needsId) patched.id = randomUUID();
      if (hit.needsRole) patched.role = "user";
      return patched;
    });
    return { ...event, data: { ...event.data, inserted } };
  });
  return { value, hits };
}
