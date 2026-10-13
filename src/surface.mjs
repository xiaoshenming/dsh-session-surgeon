/**
 * The v4 surface replacement chain.
 *
 * Every surface-eligible event — `system/message`, `user/message`,
 * `developer/message`, `assistant/message`, `tool/result` — is folded into one
 * ordered surface list. `surfaceOp: "append"` pushes the row onto it; anything
 * else is a replacement that must name a span **currently on the surface**, must
 * carry a `sourceEventSeqs` array listing exactly the rows it shadows, and may
 * not shadow the protected system head. The released reader refuses the whole
 * log at the first row that breaks any of that — from both entry points this
 * project verifies against, the v4 relationship fold (`tool/result replacement
 * range is not on the current surface`, `replacement sourceEventSeqs omit a
 * shadowed surface node`) and the seed constructor (`surface replace: start seq
 * <n> not found in surface`, `sourceEventSeqs must not be empty`).
 *
 * Our other detectors said `ok` on every one of those rows: a false-negative
 * sweep over a real 44-replacement session found all three shapes accepted by
 * us while both gates refused the file. Detection only — the span a replacement
 * meant to shadow is not recoverable once `startSeq`/`endSeq` no longer name it,
 * and `sourceEventSeqs` is a claim about the surface that the surface itself
 * cannot confirm.
 *
 * Callers must only run this on a file that is already v4: `surfaceOp` is a v4
 * member and the older stages rewrite the older shape before they validate it.
 *
 * The walk stops at the first violation on purpose. The fold itself aborts
 * there, so every later index is undefined and continuing would only manufacture
 * cascade hits.
 */

/** Types `foldSurface` folds; every one of them is in the relationship walk. */
const SURFACE_TYPES = new Set([
  "system/message",
  "user/message",
  "developer/message",
  "assistant/message",
  "tool/result",
]);

/** Codes this module raises. */
export const SURFACE_CODES = ["surface-replacement-invalid"];

const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const show = (value) => (value === undefined ? "undefined" : JSON.stringify(value));

/**
 * Report the first surface row the released fold refuses.
 * @returns {{seq:number,type:string,code:string,detail:string}[]}
 */
export function surfaceHits(events) {
  const surface = [];
  let protectedHead;
  /** A coordinate must be a non-negative safe integer naming an earlier event. */
  const coordinate = (value, seq) => (Number.isSafeInteger(value) && value >= 0 && value < seq ? value : null);

  for (const event of events ?? []) {
    if (!event || typeof event.type !== "string" || !SURFACE_TYPES.has(event.type)) continue;
    const hit = (detail) => [{ seq: event.seq, type: event.type, code: "surface-replacement-invalid", detail }];

    if (event.type === "system/message" && surface.length > 0 && protectedHead === undefined) {
      return hit("system/message requires a protected first surface head");
    }
    if (event.surfaceOp === "append") {
      if (event.type === "system/message" && surface.length === 0) protectedHead = event.seq;
      surface.push(event.seq);
      continue;
    }

    const operation = isObject(event.surfaceOp) ? event.surfaceOp : null;
    if (operation === null) {
      return hit(`surfaceOp is ${show(event.surfaceOp)} where the walker requires an object`);
    }
    const startSeq = coordinate(operation.startSeq, event.seq);
    const endSeq = coordinate(operation.endSeq, event.seq);
    if (startSeq === null || endSeq === null) {
      return hit(`replacement range ${show(operation.startSeq)}..${show(operation.endSeq)} must name earlier events`);
    }
    const first = surface.indexOf(startSeq);
    const last = surface.indexOf(endSeq);
    if (first < 0 || last < first) {
      return hit(`replacement range ${startSeq}..${endSeq} is not on the current surface`);
    }
    const removed = surface.slice(first, last + 1);
    if (!Array.isArray(event.sourceEventSeqs)) {
      return hit(`replacement sourceEventSeqs is ${show(event.sourceEventSeqs)} where the walker requires an array`);
    }
    const missing = removed.filter((seq) => !event.sourceEventSeqs.includes(seq));
    if (missing.length > 0) {
      return hit(`replacement sourceEventSeqs omit shadowed surface ${missing.join(", ")}`);
    }
    if (protectedHead !== undefined && removed.includes(protectedHead)) {
      if (event.type !== "system/message" || removed.length !== 1) {
        return hit("surface replacement cannot shadow the protected system head");
      }
      protectedHead = event.seq;
    }
    surface.splice(first, removed.length, event.seq);
  }
  return [];
}

/**
 * Issues for `decode.mjs`, built from hits the caller already computed.
 */
export function surfaceIssuesFrom(hits) {
  if (hits.length === 0) return [];
  const first = hits[0];
  return [
    {
      code: first.code,
      message:
        `${first.type} at seq ${first.seq}: ${first.detail}` +
        " — the released reader refuses the whole log there (\"<type> replacement range is not on the current surface\", \"replacement sourceEventSeqs omit a shadowed surface node\", or the seed constructor's wording for the same row); the span a replacement meant to shadow is not recoverable once startSeq/endSeq no longer name it, and sourceEventSeqs is a claim about the surface that the surface itself cannot confirm, so repair only reports",
      seqs: [first.seq],
      count: hits.length,
      types: [first.type],
    },
  ];
}
