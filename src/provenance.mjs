/**
 * Detect Alpha (#3048) compressed sourceEventSeqs ranges without expanding
 * them. Official v0 readers only accept a dense array of integers; a
 * `[start, end]` pair is a newer on-disk shape that still claims version 0
 * (#5160 / #4910). Report it as a format mismatch — never rewrite ranges
 * into the old layout.
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

function walk(node, hits) {
  if (Array.isArray(node)) {
    if (node.some(isSeqRangePair)) hits.push(node);
    for (const item of node) walk(item, hits);
    return;
  }
  if (!isRecord(node)) return;
  if (Object.hasOwn(node, "sourceEventSeqs") && Array.isArray(node.sourceEventSeqs)) {
    if (node.sourceEventSeqs.some(isSeqRangePair)) hits.push(node.sourceEventSeqs);
  }
  for (const value of Object.values(node)) walk(value, hits);
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
