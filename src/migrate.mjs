/**
 * Refusal shapes of the released v0→v1 session converter shipped in
 * @deepseek-ai/dsh 0.1.5-rc.1 (dsh-session-format-v0-to-v1), reported in
 * #6151 / #6175 / #6189 / #6194: released v0 writers emitted shapes the
 * frozen inventory refuses, so sessions that older harnesses load fine
 * become permanently unopenable after the upgrade. The source artifact is
 * left untouched by the official migration, which is why repair has to fix
 * the v0 file on disk instead.
 *
 * #6559 shapes (retired source kind, spliced inbox message id/role) live in
 * message-shapes.mjs; this module is the single aggregator for repair.
 *
 * Detection always runs. Rewriting is gated on MIGRATES_V0_ON_LOAD by the
 * caller: a v0-only harness loads these files as-is. Every fix below either
 * drops redundant display metadata or cites seq numbers that already exist
 * on disk — nothing is invented, no event is deleted, seq layout is kept.
 */
import { expandCompressedSeqRanges } from "./provenance.mjs";
import {
  fillInsertedMessageFields,
  insertedMessageHits,
  renameRetiredSourceKinds,
  retiredSourceKindHits,
} from "./message-shapes.mjs";
import { SESSION_FORMAT_VERSION } from "./runtime.mjs";

/**
 * True when the installed harness migrates v0 artifacts on load
 * (SESSION_FORMAT_VERSION >= 1, i.e. 0.1.3+).
 */
export const MIGRATES_V0_ON_LOAD =
  Number.isSafeInteger(SESSION_FORMAT_VERSION) && SESSION_FORMAT_VERSION >= 1;

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function userMessageSources(event) {
  if (event?.type !== "user/message") return [];
  const data = record(event.data);
  if (!data) return [];
  const message = record(data.message);
  const source = message ? record(message.source) : record(data.source);
  return source ? [source] : [];
}

/** A: permission/preset data carries members outside the released inventory (#6189). */
export function presetExtraMemberHits(events) {
  const hits = [];
  if (!Array.isArray(events)) return hits;
  for (const event of events) {
    if (event?.type !== "permission/preset") continue;
    const data = record(event.data);
    if (!data || !Object.hasOwn(data, "preset")) continue;
    const extra = Object.keys(data).filter((key) => key !== "preset");
    if (extra.length > 0) hits.push({ seq: event.seq, extra });
  }
  return hits;
}

/** B: subagent/descriptor data.version other than 3 on a v0 artifact (#6151). */
export function descriptorVersionHits(events) {
  const hits = [];
  if (!Array.isArray(events)) return hits;
  for (const event of events) {
    if (event?.type !== "subagent/descriptor") continue;
    const data = record(event.data);
    if (!data || data.version === 3) continue;
    if (!Number.isSafeInteger(data.version)) continue;
    hits.push({ seq: event.seq, version: data.version });
  }
  return hits;
}

/** C: plugin message source pairs summary/sections with the wrong form (#6194). */
export function pluginSourceFormHits(events) {
  const hits = [];
  if (!Array.isArray(events)) return hits;
  for (const event of events) {
    for (const source of userMessageSources(event)) {
      if (typeof source.plugin !== "string" || source.plugin === "") continue;
      const summary = Object.hasOwn(source, "summary");
      const sections = Object.hasOwn(source, "sections");
      if (!summary && !sections) continue;
      // summary requires form "notice", sections requires form "snapshot".
      // Aligning the display-only form keeps the member; only a genuine
      // member pair conflict (both present) has to drop one of them.
      if (!sections) hits.push({ seq: event.seq, setForm: "notice" });
      else if (!summary) hits.push({ seq: event.seq, setForm: "snapshot" });
      else if (source.form === "notice") hits.push({ seq: event.seq, drop: "sections" });
      else hits.push({ seq: event.seq, setForm: "snapshot", drop: "summary" });
    }
  }
  return hits;
}

function assistantTurnStep(event) {
  const data = record(event.data);
  if (!data) return null;
  return { turn: data.turn, step: data.step };
}

// Official v1→v2 closesAttempt: the chunk-attempt group restarts after these.
function closesAttempt(event) {
  return (
    event.type === "turn/end" ||
    event.type === "step/end" ||
    event.type === "llm/retry" ||
    event.type === "llm/retry-started"
  );
}

// /rewind-style replacement messages cite the shadowed surface nodes, not
// chunks; applySurface requires exactly those citations (issue #3, defect 2).
function isReplaceSurfaceOp(surfaceOp) {
  if (surfaceOp === "replace") return true;
  return record(surfaceOp)?.op === "replace";
}

/**
 * D: assistant/message chunk provenance must be one complete ordered attempt
 * of the preceding same-(turn, step) assistant/chunk run (#6175). Empty or
 * absent citations are accepted; anything else that is not the exact run is
 * refused by the converter's transformMessage.
 */
export function chunkProvenanceHits(events) {
  const hits = [];
  if (!Array.isArray(events)) return hits;
  let pending = null;
  for (const event of events) {
    if (closesAttempt(event)) {
      pending = null;
      continue;
    }
    if (event?.type === "assistant/chunk") {
      const pos = assistantTurnStep(event);
      if (!pos) continue;
      if (!pending || pending.turn !== pos.turn || pending.step !== pos.step) {
        pending = { turn: pos.turn, step: pos.step, seqs: [] };
      }
      pending.seqs.push(event.seq);
      continue;
    }
    if (event?.type !== "assistant/message") continue;
    if (isReplaceSurfaceOp(event.surfaceOp)) continue;
    const pos = assistantTurnStep(event);
    if (!pos) continue;
    const same = pending && pending.turn === pos.turn && pending.step === pos.step;
    const sources = event.sourceEventSeqs;
    if (!same) {
      if (Array.isArray(sources) && sources.length > 0) {
        hits.push({ seq: event.seq, expect: [] });
      }
    } else if (!Array.isArray(sources)) {
      hits.push({ seq: event.seq, expect: pending.seqs.slice() });
    } else if (
      sources.length > 0 &&
      (sources.length !== pending.seqs.length ||
        sources.some((seq, i) => seq !== pending.seqs[i]))
    ) {
      hits.push({ seq: event.seq, expect: pending.seqs.slice() });
    }
    pending = null;
  }
  return hits;
}

const MESSAGES = {
  "v0-preset-extra-member":
    "permission/preset data carries members outside the released v0 inventory — the 0.1.5 v0→v1 converter refuses the session (#6189); repair keeps only the preset member",
  "v0-descriptor-version":
    "subagent/descriptor data.version is not 3 — the converter refuses v0 artifacts with another descriptor version (#6151); repair sets version 3 (same member shape)",
  "v0-plugin-source-form":
    "plugin message source pairs summary/sections with the wrong form — the converter refuses (#6194); repair adds the matching form or drops the display-only member",
  "v0-chunk-provenance":
    "assistant/message chunk provenance is not one complete ordered attempt — the 0.1.5 migration refuses (#6175); repair cites the on-disk chunk run",
  "v0-retired-source-kind":
    "message source uses a retired kind literal whose successor keeps the same members — the 0.1.5 v2→v3 migration refuses it as unclassified (#6559); repair renames the kind only",
  "v0-inbox-inserted-message":
    "agent/inbox/spliced inserted message lacks the id/role the v0→v1 converter requires — the session is refused (#6559); repair fills an id and the validator's own user role",
};

/** One aggregated issue per refusal code, shaped like other decode issues. */
export function migrationRefusalIssues(events) {
  const groups = [
    ["v0-preset-extra-member", presetExtraMemberHits(events)],
    ["v0-descriptor-version", descriptorVersionHits(events)],
    ["v0-plugin-source-form", pluginSourceFormHits(events)],
    ["v0-chunk-provenance", chunkProvenanceHits(events)],
    ["v0-retired-source-kind", retiredSourceKindHits(events)],
    ["v0-inbox-inserted-message", insertedMessageHits(events)],
  ];
  const issues = [];
  for (const [code, hits] of groups) {
    if (hits.length === 0) continue;
    issues.push({
      code,
      message: MESSAGES[code],
      seqs: hits.map((hit) => hit.seq),
    });
  }
  return issues;
}

function patchEvent(event, patch) {
  return { ...event, ...patch };
}

function patchData(event, patch) {
  return { ...event, data: { ...event.data, ...patch } };
}

function omit(value, keys) {
  const out = { ...value };
  for (const key of keys) delete out[key];
  return out;
}

function patchSource(event, patch) {
  const data = event.data;
  const omitKeys = Object.keys(patch).filter((key) => patch[key] === undefined);
  const setKeys = Object.keys(patch).filter((key) => patch[key] !== undefined);
  if (record(data?.message)) {
    let source = { ...data.message.source };
    for (const key of setKeys) source[key] = patch[key];
    source = omit(source, omitKeys);
    return { ...event, data: { ...data, message: { ...data.message, source } } };
  }
  let source = { ...data.source };
  for (const key of setKeys) source[key] = patch[key];
  source = omit(source, omitKeys);
  return { ...event, data: { ...data, source } };
}

/**
 * Apply every migration refusal fix. The caller decides gating:
 * `expandRanges` additionally expands compressed sourceEventSeqs (reuses
 * provenance); `converters` gates the v0→v1 converter fixes themselves —
 * a v0-only host needs the range expansion but must keep the rest of the
 * file byte-for-byte (minimal repair). Throws RangeError from the range
 * expander when a range is too large.
 */
export function applyMigrationFixes(events, { expandRanges = false, converters = true } = {}) {
  if (!Array.isArray(events)) return { value: events, actions: [] };
  const actions = [];
  let value = events;

  if (expandRanges) {
    const expanded = expandCompressedSeqRanges(value);
    if (expanded.expanded > 0) {
      value = expanded.value;
      actions.push({
        code: "newer-format-ranges",
        detail:
          "expanded " + expanded.expanded +
          " sourceEventSeqs field(s) from compressed [start,end] ranges into dense integers",
      });
    }
  }

  if (!converters) return { value, actions };

  // Renames run before the form alignment below so a renamed plugin source is
  // still checked for a matching form.
  const retired = renameRetiredSourceKinds(value);
  if (retired.hits.length > 0) {
    value = retired.value;
    actions.push({
      code: "v0-retired-source-kind",
      detail:
        "renamed retired source kind on " +
        retired.hits.length +
        " message source(s): " +
        [...new Set(retired.hits.map((hit) => hit.kind))].join(", ") +
        " (#6559)",
    });
  }

  const inserted = fillInsertedMessageFields(value);
  if (inserted.hits.length > 0) {
    value = inserted.value;
    actions.push({
      code: "v0-inbox-inserted-message",
      detail:
        "filled id/role on " +
        inserted.hits.length +
        " agent/inbox/spliced inserted message(s) (#6559)",
    });
  }

  const presetHits = presetExtraMemberHits(value);
  if (presetHits.length > 0) {
    const bySeq = new Map(presetHits.map((hit) => [hit.seq, hit.extra]));
    value = value.map((event) => {
      const extra = bySeq.get(event.seq);
      if (extra === undefined || event.type !== "permission/preset") return event;
      return { ...event, data: omit(event.data, extra) };
    });
    actions.push({
      code: "v0-preset-extra-member",
      detail: "kept only the preset member on " + presetHits.length + " permission/preset event(s) (#6189)",
    });
  }

  const descriptorHits = descriptorVersionHits(value);
  if (descriptorHits.length > 0) {
    const hitSet = new Set(descriptorHits.map((hit) => hit.seq));
    value = value.map((event) => {
      if (!hitSet.has(event.seq) || event.type !== "subagent/descriptor") return event;
      return patchData(event, { version: 3 });
    });
    actions.push({
      code: "v0-descriptor-version",
      detail: "set subagent/descriptor data.version to 3 on " + descriptorHits.length + " event(s) (#6151)",
    });
  }

  const formHits = pluginSourceFormHits(value);
  if (formHits.length > 0) {
    const bySeq = new Map(formHits.map((hit) => [hit.seq, hit]));
    value = value.map((event) => {
      const hit = bySeq.get(event.seq);
      if (hit === undefined) return event;
      for (const source of userMessageSources(event)) {
        if (typeof source.plugin !== "string" || source.plugin === "") continue;
        const patch = {};
        if (hit.setForm !== undefined) patch.form = hit.setForm;
        if (hit.drop !== undefined) patch[hit.drop] = undefined;
        return patchSource(event, patch);
      }
      return event;
    });
    actions.push({
      code: "v0-plugin-source-form",
      detail: "aligned form/summary/sections on " + formHits.length + " plugin message source(s) (#6194)",
    });
  }

  const chunkHits = chunkProvenanceHits(value);
  if (chunkHits.length > 0) {
    const bySeq = new Map(chunkHits.map((hit) => [hit.seq, hit.expect]));
    value = value.map((event) => {
      const expect = bySeq.get(event.seq);
      if (expect === undefined) return event;
      return patchEvent(event, { sourceEventSeqs: expect });
    });
    actions.push({
      code: "v0-chunk-provenance",
      detail:
        "rewrote chunk provenance to the on-disk assistant/chunk run on " +
        chunkHits.length + " assistant/message event(s) (#6175)",
    });
  }

  return { value, actions };
}
