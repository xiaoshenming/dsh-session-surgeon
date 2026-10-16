/**
 * PTC sub-call dispatch identity.
 *
 * `run_code` numbers each sub-call from a counter scoped to one `execute()`, so
 * the id is `<parent callId>:ptc:<n>` — and **both halves can repeat inside one
 * session**: the provider re-issues a parent id when the assistant repeats a
 * call, and `n` restarts at 1 for every new run. A sub-call that outlives its
 * step (polling a background job is the natural one) produces exactly that: the
 * same parent id, the counter back at 1, and a second `tool/ptc-dispatch-start`
 * for an id that is already settled.
 *
 * Nothing rejects the write, so the log is stored happily and refused on the
 * next read — `PTC dispatch repeats subCallId`, inside `stored log is corrupt` —
 * and reading is all-or-nothing, so one repeat costs the whole session. That is
 * [discussion #9677](https://github.com/deepseek-ai/deepseek-harness/discussions/9677):
 * a real 3569-event session became permanently unopenable.
 *
 * The relationships fold is the only gate that checks this — `Session.fromRestore`
 * accepts every row below — so a file is refused on open by the fold alone.
 *
 * One shape is repairable, and it is the one the report is about: a later
 * occurrence that repeats an id the log already recorded. Only the key is wrong
 * there, so `repairPtcSubCallIds` renames the **later** occurrence and leaves the
 * first id alone — the first id is the one an existing child row may already name
 * as its `parentCallId`, so it has to keep resolving. That is the scheme
 * `@argszero/dsh-ptc-subcall-guard` applies to the seed it hands the session
 * factory (#9677); applying it to the stored file is what makes the log readable
 * for every consumer, not just the process that ran the guard. Every other shape
 * stays report-only: a wrong `rootCallId` or an emptied id has no unique
 * replacement inside the artifact.
 *
 * The walk stops at the first violation, like `surface.mjs`: the fold aborts
 * there, so continuing would only manufacture cascade hits.
 *
 * Callers must only run this on a v4 file, the generation that folds these rows.
 */
import { isDeepStrictEqual } from "node:util";

/** The two rows `Relationships.dispatch()` owns. */
const PTC_TYPES = new Set(["tool/ptc-dispatch-start", "tool/ptc-dispatch"]);

/** Codes this module raises. */
export const PTC_CODES = ["ptc-dispatch-invalid"];

/** Members `tool/ptc-dispatch` must repeat verbatim from its start. */
const MATCHED_MEMBERS = ["rootCallId", "parentCallId", "name", "arguments"];

const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const show = (value) => (value === undefined ? "undefined" : JSON.stringify(value));

/**
 * Report the first PTC row the released fold refuses.
 * @returns {{seq:number,type:string,code:string,detail:string}[]}
 */
export function ptcHits(events) {
  const dispatches = new Map();
  let turnOpen = false;

  for (const event of events ?? []) {
    if (!event || typeof event.type !== "string") continue;
    if (event.type === "turn/start") {
      turnOpen = true;
      continue;
    }
    if (event.type === "turn/end") {
      turnOpen = false;
      continue;
    }
    if (!PTC_TYPES.has(event.type)) continue;
    const hit = (detail) => [{ seq: event.seq, type: event.type, code: "ptc-dispatch-invalid", detail }];
    const data = isObject(event.data) ? event.data : {};

    if (!turnOpen) return hit(`${event.type} is outside an open turn`);
    for (const [key, subject] of [
      ["subCallId", "PTC subCallId"],
      ["rootCallId", "PTC rootCallId"],
      ["parentCallId", "PTC parentCallId"],
    ]) {
      if (typeof data[key] !== "string" || data[key].length === 0) {
        return hit(`${subject} requires a nonempty string, got ${show(data[key])}`);
      }
    }

    const existing = dispatches.get(data.subCallId);
    if (existing !== undefined && existing.data.rootCallId !== data.rootCallId) {
      return hit("PTC dispatch changes its rootCallId");
    }
    if (data.parentCallId !== data.rootCallId && dispatches.get(data.parentCallId)?.data.rootCallId !== data.rootCallId) {
      return hit("PTC parentCallId does not belong to rootCallId");
    }

    if (event.type === "tool/ptc-dispatch-start") {
      if (existing !== undefined) return hit("PTC dispatch repeats subCallId");
      dispatches.set(data.subCallId, { data, settled: false });
      continue;
    }
    if (existing === undefined) return hit("PTC dispatch has no unique start");
    if (existing.settled) return hit("PTC dispatch has no unique start (its start is already settled)");
    const changed = MATCHED_MEMBERS.find((key) => !isDeepStrictEqual(existing.data[key], data[key]));
    if (changed !== undefined) return hit(`PTC dispatch does not match its start (${changed})`);
    existing.settled = true;
  }
  return [];
}

/**
 * Issues for `decode.mjs`, built from hits the caller already computed.
 */
/**
 * Give every repeated PTC sub-call id to one occurrence only.
 *
 * A duplicate occurrence runs from its `tool/ptc-dispatch-start` up to the next
 * start carrying the same id, and every row in that span that names the id is
 * renamed with it. The new id is the old one plus the lowest free `::r<k>`
 * suffix — free meaning unused as a `subCallId` **or** as a `parentCallId`
 * anywhere in the log, so the rename cannot collide with a child that already
 * points at something. The first occurrence is never touched.
 *
 * Nothing is deleted and no other member changes. The caller must re-run
 * `ptcHits` over the result and refuse when it is still not empty: a row that is
 * broken for a second reason (a `tool/ptc-dispatch` that disagrees with its own
 * start, a child whose root no longer matches) is not repaired by renaming.
 * @returns {{value: object[], renamed: number}}
 */
export function repairPtcSubCallIds(events) {
  const list = events ?? [];
  const used = new Set();
  for (const event of list) {
    const data = isObject(event?.data) ? event.data : {};
    for (const key of ["subCallId", "parentCallId"]) {
      if (typeof data[key] === "string" && data[key].length > 0) used.add(data[key]);
    }
  }

  const firstSeen = new Set();
  const spans = [];
  for (let index = 0; index < list.length; index += 1) {
    const event = list[index];
    if (event?.type !== "tool/ptc-dispatch-start") continue;
    const id = isObject(event.data) ? event.data.subCallId : undefined;
    if (typeof id !== "string" || id.length === 0) continue;
    if (!firstSeen.has(id)) {
      firstSeen.add(id);
      continue;
    }
    let to = list.length;
    for (let next = index + 1; next < list.length; next += 1) {
      const other = list[next];
      if (other?.type === "tool/ptc-dispatch-start" && isObject(other.data) && other.data.subCallId === id) {
        to = next;
        break;
      }
    }
    spans.push({ from: index, to, id });
  }
  if (spans.length === 0) return { value: list, renamed: 0 };

  const value = Array.from(list, (event) => (isObject(event) ? { ...event } : event));
  let renamed = 0;
  const nextSuffix = new Map();
  for (const span of spans) {
    let suffix = nextSuffix.get(span.id) ?? 1;
    let fresh = `${span.id}::r${suffix}`;
    while (used.has(fresh)) {
      suffix += 1;
      fresh = `${span.id}::r${suffix}`;
    }
    used.add(fresh);
    nextSuffix.set(span.id, suffix + 1);
    for (let index = span.from; index < span.to; index += 1) {
      const data = isObject(value[index]?.data) ? value[index].data : null;
      if (data === null || data.subCallId !== span.id) continue;
      value[index].data = { ...data, subCallId: fresh };
      renamed += 1;
    }
  }
  return { value, renamed };
}

export function ptcIssuesFrom(hits) {
  if (hits.length === 0) return [];
  const first = hits[0];
  return [
    {
      code: first.code,
      message:
        `${first.type} at seq ${first.seq}: ${first.detail}` +
        " — the released relationships fold (the gate a stored log passes on open) refuses the whole log there, and reading is all-or-nothing, so one repeated sub-call id costs the entire session (#9677); repair renames a repeated id (the later occurrence only, so the first id a child row may name keeps resolving) and reports anything else here, because a wrong rootCallId or an emptied id has no unique replacement inside the artifact",
      seqs: [first.seq],
      count: hits.length,
      types: [first.type],
    },
  ];
}
