/**
 * Steps that continue a turn the log already closed (#7824).
 *
 * The v1→v2 stage re-asserts the released relationships on the artifact it just
 * produced (v0-to-v1's `assertReleasedArtifactRelationships`, also reached from
 * the v3→v4 walker), so a `turn/end` that lands before its steps finish makes
 * every later step-scoped event refuse the whole session with
 * `<type> does not match an open turn and step`. A `turn/end` that lands while a
 * step is still open is refused with `turn/end <n> crosses an open step`; the
 * writer states the same rule in `dsh-session/lib/invariant.js`.
 *
 * Detection only. Merging the split turn and splitting it in two are both local
 * rewrites with no unique answer inside the artifact, and splitting renumbers
 * every later seq and every declared range — so repair reports, never edits.
 */

/** Types the official walker routes through `requireOpenStep` / `requireStep`. */
const STEP_TYPES = new Set([
  "step/start",
  "step/end",
  "assistant/chunk",
  "assistant/message",
  "tool/call",
  "tool/result",
]);

/**
 * Report every step-scoped event that continues an already-closed turn, plus
 * every `turn/end` that lands while a step is still open.
 * @returns {{seq:number,type:string,code:string,detail:string}[]}
 */
export function turnStepImbalances(events) {
  const hits = [];
  let openTurn = null;
  let openStep = null;
  const closed = new Set();
  const afterClosedTurn = (data) =>
    typeof data.turn === "number" && data.turn !== openTurn && closed.has(data.turn);
  const note = (event, code, detail) => hits.push({ seq: event.seq, type: event.type, code, detail });

  for (const event of events ?? []) {
    if (!event || typeof event.type !== "string") continue;
    const data = event.data && typeof event.data === "object" ? event.data : {};
    switch (event.type) {
      case "turn/start":
        openTurn = typeof data.turn === "number" ? data.turn : null;
        openStep = null;
        break;
      case "turn/end":
        if (openStep !== null) {
          note(event, "turn-end-while-step-open", `turn/end ${data.turn} while step ${openStep} is still open`);
        }
        if (typeof data.turn === "number") closed.add(data.turn);
        openTurn = null;
        openStep = null;
        break;
      default:
        if (!STEP_TYPES.has(event.type)) break;
        if (afterClosedTurn(data)) {
          note(event, "step-after-turn-end", `${event.type} ${data.turn}/${data.step} continues turn ${data.turn}, which already ended`);
        } else if (event.type === "step/start" && data.turn === openTurn && openStep === null) {
          openStep = typeof data.step === "number" ? data.step : null;
        } else if (event.type === "step/end" && data.turn === openTurn && data.step === openStep) {
          openStep = null;
        }
        break;
    }
  }
  return hits;
}

/** Order matters: `worse()` picks the earlier code when both shapes are present. */
export const TURN_STEP_CODES = ["turn-end-while-step-open", "step-after-turn-end"];

const STEP_AFTER_END_MESSAGE =
  " — the released relationship walker refuses the whole session with \"<type> does not match an open turn and step\" (#7824); merging or splitting that turn has no unique answer inside the artifact, and splitting renumbers every later seq and declared range, so repair only reports";

const TURN_END_OPEN_STEP_MESSAGE =
  " — the released walker refuses the whole session with \"turn/end <n> crosses an open step\" (#7824); the writer states the same rule in dsh-session/lib/invariant.js, so repair only reports";

/**
 * Issues for `decode.mjs`, one per code. The seq list is capped so a session
 * with hundreds of stray steps keeps the inspect payload small.
 */
export function turnStepIssues(events) {
  const hits = turnStepImbalances(events);
  const issues = [];
  for (const code of TURN_STEP_CODES) {
    const group = hits.filter((hit) => hit.code === code);
    if (group.length === 0) continue;
    const all = group.map((hit) => hit.seq);
    const seqs = all.slice(0, 12);
    const shown = all.length > seqs.length ? ` (first ${seqs.length} of ${all.length})` : "";
    issues.push({
      code,
      message: group[0].detail + " at seq " + seqs.join(", ") + shown +
        (code === "step-after-turn-end" ? STEP_AFTER_END_MESSAGE : TURN_END_OPEN_STEP_MESSAGE),
      seqs,
      count: all.length,
      types: [...new Set(group.map((hit) => hit.type))],
    });
  }
  return issues;
}
