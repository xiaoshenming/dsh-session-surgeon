/**
 * An idle prune pass that lands outside any open turn (#8812).
 *
 * The tool-result pruner rewrites old results in a background/idle pass, i.e.
 * with no turn open: it appends `compaction/prune` rows followed by replacement
 * `tool/result` rows whose `surfaceOp` is a replace range. The reader's
 * lifecycle fold routes every non-append `tool/result` through `requireTurn()`,
 * which throws `tool/result is outside an open turn` once `turn/end` has been
 * seen — so the writer emits a log its own reader refuses, and the session
 * stops loading for good (`assertReleasedV4Relationships`, reached from both
 * the v3→v4 walker and `readStoredLog`).
 *
 * A prune pass is pure surface metadata: every replacement shadows surface
 * nodes that are still in the log, and `sourceEventSeqs` names exactly those
 * nodes (the fold checks that). Dropping the tail after the last `turn/end`
 * therefore restores the pre-prune surface and loses no message, turn or tool
 * result — which is what makes this repairable where a turn that simply kept
 * going past its `turn/end` (#7824) is not: there the rows are real work.
 */

/** Event types a prune pass is allowed to append after the last `turn/end`. */
const DROPPABLE_TYPES = new Set(["compaction/prune"]);

/** The fold's own test: anything that is not the literal `"append"` is a replacement. */
function isReplacement(event) {
  const surfaceOp = event?.surfaceOp;
  return surfaceOp !== undefined && surfaceOp !== "append" && typeof surfaceOp === "object" && surfaceOp !== null;
}

function isDroppable(event) {
  if (!event || typeof event.type !== "string") return false;
  return DROPPABLE_TYPES.has(event.type) || (event.type === "tool/result" && isReplacement(event));
}

/**
 * Replacement `tool/result` rows the fold evaluates while no turn is open.
 * @returns {{seq:number,type:string}[]}
 */
export function prunePassHits(events) {
  const hits = [];
  let openTurn = false;
  for (const event of events ?? []) {
    if (!event || typeof event.type !== "string") continue;
    if (event.type === "turn/start") {
      openTurn = true;
      continue;
    }
    if (event.type === "turn/end") {
      openTurn = false;
      continue;
    }
    if (!openTurn && event.type === "tool/result" && isReplacement(event)) {
      hits.push({ seq: event.seq, type: event.type });
    }
  }
  return hits;
}

/**
 * Cut the log back to the `turn/end` the prune pass followed, but only while
 * the dropped tail is the prune pass itself.
 * @returns {{cutIndex:number,cutSeq:number,dropped:number,types:string[]}|{refuse:string}}
 */
export function planPruneTail(events) {
  const list = Array.isArray(events) ? events : [];
  const hits = prunePassHits(list);
  if (hits.length === 0) return { refuse: "no replacement tool/result outside an open turn" };
  const firstHit = list.findIndex((event) => event?.seq === hits[0].seq && event.type === hits[0].type);
  let cutIndex = -1;
  for (let i = firstHit - 1; i >= 0; i--) {
    if (list[i]?.type === "turn/end") {
      cutIndex = i;
      break;
    }
  }
  if (cutIndex < 0) {
    return { refuse: "the prune pass follows no turn/end, so there is no closed boundary to cut back to" };
  }
  const cutSeq = list[cutIndex].seq;
  const tail = list.slice(cutIndex + 1);
  const stray = tail.filter((event) => !isDroppable(event));
  if (stray.length > 0) {
    const types = [...new Set(stray.map((event) => String(event?.type)))].join(", ");
    return {
      refuse:
        "the tail after turn/end at seq " + String(cutSeq) + " carries " + String(stray.length) +
        " event(s) a prune pass did not write (" + types + "), so truncating would drop real work",
    };
  }
  const danglingSource = tail.find((event) =>
    Array.isArray(event?.sourceEventSeqs) &&
    event.sourceEventSeqs.some((seq) => typeof seq !== "number" || seq > cutSeq));
  if (danglingSource !== undefined) {
    return {
      refuse:
        "a replacement after turn/end at seq " + String(cutSeq) +
        " shadows a surface node at or after the cut, so the originals are not all retained",
    };
  }
  return { cutIndex, cutSeq, dropped: tail.length, types: [...new Set(tail.map((event) => String(event?.type)))] };
}
