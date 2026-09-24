/**
 * Released-writer message shapes the frozen converters refuse, reported in
 * #6559 and still present on 0.1.7-rc.1:
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
 * A third shape is detection-only: a log already at v4 may still carry the
 * retired `{kind:"plugin", plugin}` source wrapper, which v4 admission refuses
 * while the log is read (#7772). Its successor kind is derived from the package
 * name, so there is no single answer to write back.
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
 * Rewrite every message source the official v2→v3 admission gate inspects:
 * user/message data, assistant/message + tool/result data.message, and the
 * inserted/messages arrays of agent/inbox/spliced and session/title-llm-request.
 */
function rewriteMessageSources(event, transform) {
  const data = record(event?.data);
  if (!data) return event;
  if (event.type === "user/message") {
    const source = record(data.source);
    if (!source) return event;
    const next = transform(source);
    return next === source ? event : { ...event, data: { ...data, source: next } };
  }
  if (event.type === "assistant/message" || event.type === "tool/result") {
    const message = record(data.message);
    const source = message ? record(message.source) : null;
    if (!source) return event;
    const next = transform(source);
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
    const next = transform(source);
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
