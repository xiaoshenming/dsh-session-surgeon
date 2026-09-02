/**
 * Detect Alpha (#3048) compressed sourceEventSeqs ranges. Official v0 / rc.2
 * foldSurface only accepts a dense array of integers; a `[start, end]` pair
 * is a newer on-disk shape that still claims version 0 (#5160 / #4910).
 * Inspect reports it; repair expands ranges losslessly so current harness
 * can open the file. Never invent seqs that were not already in the range.
 */

function isRecord(value) {
  return typeof value === "object" && value !== null;
}

/** True when `value` is a [start, end] pair of non-negative safe integers. */
export function isSeqRangePair(value) {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    Number.isSafeInteger(value[0]) &&
    Number.isSafeInteger(value[1]) &&
    value[0] >= 0 &&
    value[1] >= value[0]
  );
}

/** Hard cap so a malicious [0, 1e12] cannot OOM the process. */
export const MAX_EXPAND_RANGE = 1_000_000;

function walk(node, hits) {
  if (Array.isArray(node)) {
    for (const item of node) walk(item, hits);
    return;
  }
  if (!isRecord(node)) return;
  if (Object.hasOwn(node, "sourceEventSeqs") && Array.isArray(node.sourceEventSeqs)) {
    if (node.sourceEventSeqs.some(isSeqRangePair)) hits.push(node.sourceEventSeqs);
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === "sourceEventSeqs") continue;
    walk(value, hits);
  }
}

/** Collect compressed sourceEventSeqs range arrays from events. */
export function findCompressedSeqRanges(events) {
  const hits = [];
  if (!Array.isArray(events)) return hits;
  for (const event of events) walk(event, hits);
  return hits;
}

export function hasCompressedSeqRanges(events) {
  return findCompressedSeqRanges(events).length > 0;
}

/** Expand one sourceEventSeqs list that may mix ints and [start,end] pairs. */
export function expandSeqRangeList(list) {
  if (!Array.isArray(list)) return list;
  const out = [];
  for (const item of list) {
    if (!isSeqRangePair(item)) {
      out.push(item);
      continue;
    }
    const start = item[0];
    const end = item[1];
    const n = end - start + 1;
    if (n > MAX_EXPAND_RANGE) {
      throw new RangeError(
        "sourceEventSeqs range [" + start + "," + end + "] is too large to expand",
      );
    }
    for (let seq = start; seq <= end; seq++) out.push(seq);
  }
  return out;
}

function expandEvent(event) {
  if (!isRecord(event)) return { value: event, expanded: 0 };
  let value = event;
  let expanded = 0;
  if (Array.isArray(event.sourceEventSeqs) && event.sourceEventSeqs.some(isSeqRangePair)) {
    value = { ...event, sourceEventSeqs: expandSeqRangeList(event.sourceEventSeqs) };
    expanded += 1;
  }
  const data = value.data;
  if (isRecord(data) && Array.isArray(data.sourceEventSeqs) && data.sourceEventSeqs.some(isSeqRangePair)) {
    value = { ...value, data: { ...data, sourceEventSeqs: expandSeqRangeList(data.sourceEventSeqs) } };
    expanded += 1;
  }
  return { value, expanded };
}

/**
 * Clone events whose sourceEventSeqs still use [start,end] pairs, replacing
 * each pair with the inclusive integer run. Seq numbers already exist on
 * disk — this is a layout rewrite, not invented history.
 */
export function expandCompressedSeqRanges(events) {
  if (!Array.isArray(events)) return { value: events, expanded: 0 };
  let expanded = 0;
  const value = events.map((event) => {
    const next = expandEvent(event);
    expanded += next.expanded;
    return next.value;
  });
  return { value, expanded };
}
