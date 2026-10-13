/**
 * Turn/step pairing and tool-result identity.
 *
 * The released relationship walkers keep one state machine per session and
 * refuse the *whole* log on the first row that does not continue it. Two of
 * them run these rules: `assertReleasedV4Relationships` when a stored v4 log is
 * read, and `assertReleasedArtifactRelationships` inside the v0→v1 stage for
 * anything older (`nextTurn`/`nextStep` both start at 1, `turn/start` must open
 * the expected turn, `step/start` must be the next step of the open turn, every
 * step-scoped row must carry the open pair, `turn/end` must match the open turn
 * with no step open, and a `tool/result` must name a call the log advertised).
 *
 * Our imbalance detectors only looked for *imbalances* (`step-after-turn-end`,
 * `turn-end-while-step-open`), so a row whose turn/step numbers are simply
 * wrong — or a `tool/result` whose id no longer names the call it answers — was
 * reported `ok` while the reader refused the session. That is the worse
 * failure: the user is told the file is fine.
 *
 * Callers must only run this on a file that is already v4. The older stages
 * normalise the older shape before they validate it: a raw v3 `tool/result`
 * carries its call id inside `content[0].toolCallId` with `role: "user"`, and
 * the v3→v4 stage lifts that into `message.toolCallId`. Running these rules on
 * an older artifact therefore reports a violation the loader never sees — this
 * module did exactly that on a real v3 session before the caller was gated.
 *
 * Detection only, never repair. Renumbering a mid-log turn has no unique answer
 * inside the artifact — `compact` may renumber because the slice boundary it is
 * handed *defines* the answer — and it would also renumber every later seq and
 * every declared range. The id a `tool/result` answers is likewise not
 * recoverable once it is wrong.
 */

/** Types the walkers route through `requireOpenStep` before their own switch. */
const STEP_REQUIRED = new Set(["system/message", "developer/message", "assistant/attempt"]);

/** Types `Relationships.tool()` owns; it calls `requireStep` before dispatching. */
const TOOL_TYPES = new Set(["assistant/message", "tool/call", "tool/result"]);

/** The only types that move turn/step state. Every other event leaves it alone. */
const TRACKED = new Set([
  "turn/start",
  "turn/end",
  "step/start",
  "step/end",
  ...STEP_REQUIRED,
  ...TOOL_TYPES,
]);

/** Codes this module raises, worst first. */
export const PAIRING_CODES = ["turn-step-mismatch", "tool-result-invalid"];

const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const show = (value) => (value === undefined ? "undefined" : JSON.stringify(value));

/**
 * Report every row the released walkers would refuse over pairing or over the
 * identity of a `tool/result`.
 * @returns {{seq:number,type:string,code:string,detail:string}[]}
 */
export function pairingHits(events) {
  const hits = [];
  let turn = null;
  let step = null;
  let nextTurn = 1;
  let nextStep = 1;
  const closed = new Set();
  const advertised = new Set();
  const note = (event, code, detail) => hits.push({ seq: event.seq, type: event.type, code, detail });

  for (const event of events ?? []) {
    if (!event || typeof event.type !== "string" || !TRACKED.has(event.type)) continue;
    const type = event.type;
    const data = isObject(event.data) ? event.data : {};
    const stepOpen = turn !== null && step !== null && data.turn === turn && data.step === step;
    // A row that continues a turn this log already closed is the #7824 shape,
    // which `turnStepImbalances` owns; reporting it here too would double it.
    const continuesClosedTurn = typeof data.turn === "number" && closed.has(data.turn);
    // A replacement `tool/result` never reaches `requireStep`: the walkers
    // return after `requireTurn`, so its own turn/step are not compared.
    const stepScoped =
      STEP_REQUIRED.has(type) ||
      type === "assistant/message" ||
      type === "tool/call" ||
      type === "step/end" ||
      (type === "tool/result" && event.surfaceOp === "append");

    if (stepScoped && !stepOpen && !continuesClosedTurn) {
      note(event, "turn-step-mismatch", `${type} carries turn/step ${data.turn}/${data.step}, which is not the open pair ${turn}/${step}`);
    }

    if (type === "turn/start") {
      if (turn !== null || data.turn !== nextTurn) {
        const stillOpen = turn === null ? "" : `, and turn ${turn} is still open`;
        note(event, "turn-step-mismatch", `turn/start ${show(data.turn)} does not open the expected turn ${nextTurn}${stillOpen}`);
      }
      turn = nextTurn;
      step = null;
      nextStep = 1;
      advertised.clear();
    } else if (type === "turn/end") {
      if (turn === null || data.turn !== turn) {
        note(event, "turn-step-mismatch", `turn/end ${show(data.turn)} does not match the open turn ${turn}`);
      }
      if (typeof data.turn === "number") closed.add(data.turn);
      turn = null;
      step = null;
      nextTurn += 1;
      advertised.clear();
    } else if (type === "step/start") {
      if (turn === null || data.turn !== turn || step !== null || data.step !== nextStep) {
        note(event, "turn-step-mismatch", `step/start ${data.turn}/${data.step} does not match the open turn ${turn} and next step ${nextStep}`);
      }
      step = nextStep;
    } else if (type === "step/end") {
      step = null;
      nextStep += 1;
      advertised.clear();
    } else if (type === "assistant/message") {
      if (stepOpen) advertiseToolCalls(data, advertised);
    } else if (type === "tool/call") {
      if (stepOpen && typeof data.callId === "string" && data.callId.length > 0) advertised.add(data.callId);
    } else if (type === "tool/result") {
      const replacement = event.surfaceOp !== "append";
      const message = isObject(data.message) ? data.message : {};
      const source = isObject(message.source) ? message.source : {};
      const id = message.toolCallId;
      if (replacement && !isObject(event.surfaceOp)) {
        note(event, "tool-result-invalid", `tool/result surfaceOp is ${show(event.surfaceOp)} where the walker requires an object`);
      }
      if (typeof id !== "string" || id.length === 0) {
        note(event, "tool-result-invalid", `tool/result requires a nonempty message.toolCallId, got ${show(id)}`);
      } else if (source.callId !== id) {
        note(event, "tool-result-invalid", `tool/result message.toolCallId ${id} does not match its tool source callId ${show(source.callId)}`);
      } else if (!replacement && stepOpen && !advertised.has(id)) {
        note(event, "tool-result-invalid", `tool/result ${id} has no advertised tool lifecycle`);
      }
      // A replacement result shadows a surface node, it does not answer a call.
      if (!replacement) advertised.delete(id);
    }
  }
  return hits;
}

function advertiseToolCalls(data, advertised) {
  const message = isObject(data.message) ? data.message : {};
  for (const block of Array.isArray(message.content) ? message.content : []) {
    if (!isObject(block) || block.type !== "tool-call") continue;
    if (typeof block.id === "string" && block.id.length > 0) advertised.add(block.id);
  }
}

const PAIRING_RULE = {
  "turn-step-mismatch":
    " — the released walker refuses the whole log at the first such row (\"<type> does not match an open turn and step\", or its turn/start, step/start or turn/end variant); renumbering a mid-log turn has no unique answer inside the artifact (compact can renumber only because the slice boundary it is given defines the answer) and it would renumber every later seq and every declared range, so repair only reports",
  "tool-result-invalid":
    " — the released walker refuses the whole log at the first such row (\"tool/result <id> has no advertised tool lifecycle\", \"tool call id requires a nonempty string\", or \"tool/result surfaceOp requires an object\"); the call a result answers is not recoverable from the artifact once its id is wrong, so repair only reports",
};

/**
 * Issues for `decode.mjs`, one per code, built from hits the caller already
 * computed. The seq list is capped so a session with hundreds of stray rows
 * keeps the inspect payload small.
 */
export function pairingIssuesFrom(hits) {
  const issues = [];
  for (const code of PAIRING_CODES) {
    const group = hits.filter((hit) => hit.code === code);
    if (group.length === 0) continue;
    const all = group.map((hit) => hit.seq);
    const seqs = all.slice(0, 12);
    const shown = all.length > seqs.length ? ` (first ${seqs.length} of ${all.length})` : "";
    issues.push({
      code,
      message: group[0].detail + " at seq " + seqs.join(", ") + shown + PAIRING_RULE[code],
      seqs,
      count: all.length,
      types: [...new Set(group.map((hit) => hit.type))],
      rules: [...new Set(group.map((hit) => hit.detail))].slice(0, 5),
    });
  }
  return issues;
}
