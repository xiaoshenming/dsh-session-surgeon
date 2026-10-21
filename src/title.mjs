/**
 * Citation lists on `session/title`.
 *
 * A title event carries `messageSeqs` — the messages the title was derived
 * from — and the relationships fold enforces two clauses on it:
 *
 *   1. empty **exactly** for a user title: `(refs.length === 0) !== (source.kind === "user")`
 *      refuses with `session/title messageSeqs must be empty exactly for a user title`;
 *   2. every remaining ref must name a **distinct, earlier human** `user/message`
 *      (`data.source.kind === "user"`, not a runtime-context or team-message row)
 *      and refuses with `session/title messageSeqs must cite distinct earlier
 *      human user/message events`.
 *
 * Measured against the released reader rather than read off a document: appending
 * one title to a real 326-event v4 session gives exactly those two messages for a
 * user title citing messages, a provider title citing nothing, a provider title
 * citing a `step/start`, and a provider title citing a runtime-context message;
 * a fallback title citing one human `user/message` is accepted. The report that
 * made this worth a code is
 * [discussion #10440](https://github.com/deepseek-ai/deepseek-harness/discussions/10440):
 * three offline retitle scripts wrote logs the loader then refused whole, and one
 * of them simply collected "the events nearest the title".
 *
 * Both repairs here are deterministic and drop nothing that can be read:
 * a **user** title's citation list is required to be empty, and a citation that
 * names no earlier human message is not a jump target. What is *not* repairable
 * is a non-user title with an empty (or wholly invalid) list — which messages it
 * was derived from is not in the artifact — so that shape stays report-only.
 *
 * Callers must only run this on a v4 file: the same walker runs inside the v3→v4
 * migration, where the title source may still be rewritten, so judging a raw v3
 * row would report a violation the loader never sees.
 */

export const TITLE_CODE = "title-references-invalid";

const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

/** Title events plus the human `user/message` seqs seen so far. */
function walk(events, visit) {
  const human = new Set();
  for (const event of events ?? []) {
    if (!event || typeof event.type !== "string") continue;
    if (event.type === "user/message") {
      const source = isObject(event.data?.source) ? event.data.source : null;
      if (source?.kind === "user") human.add(event.seq);
      continue;
    }
    if (event.type !== "session/title") continue;
    visit(event, human);
  }
}

/**
 * Every title the fold would refuse, with the citation list to write when there
 * is one unique legal answer.
 * @returns {{seq:number, repair?:number[], why:string}[]}
 */
export function titleReferenceHits(events) {
  const hits = [];
  walk(events, (event, human) => {
    const data = isObject(event.data) ? event.data : {};
    const source = isObject(data.source) ? data.source : null;
    const refs = data.messageSeqs;
    // A missing source or a non-array list is refused by the shape gates, not here.
    if (source === null || !Array.isArray(refs)) return;
    const userTitle = source.kind === "user";
    if (userTitle && refs.length > 0) {
      hits.push({
        seq: event.seq,
        repair: [],
        why: "a user title must carry an empty messageSeqs (" + refs.length + " citation(s) present)",
      });
      return;
    }
    if (!userTitle && refs.length === 0) {
      hits.push({
        seq: event.seq,
        why: "a " + String(source.kind) + " title must cite the messages it came from, and none are recorded",
      });
      return;
    }
    if (userTitle) return;
    const kept = [];
    const seen = new Set();
    for (const ref of refs) {
      if (typeof ref !== "number" || !human.has(ref) || seen.has(ref)) continue;
      seen.add(ref);
      kept.push(ref);
    }
    if (kept.length === refs.length) return;
    const dropped = refs.filter((ref) => !kept.includes(ref));
    hits.push(
      kept.length > 0
        ? {
            seq: event.seq,
            repair: kept,
            why: "citation(s) " + dropped.join(", ") + " name no earlier human user/message",
          }
        : { seq: event.seq, why: "no citation names an earlier human user/message (" + refs.join(", ") + ")" },
    );
  });
  return hits;
}

/** Rewrite the citation lists that have one legal answer. */
export function repairTitleReferences(events) {
  const hits = titleReferenceHits(events);
  const patchable = new Map(hits.filter((hit) => Array.isArray(hit.repair)).map((hit) => [hit.seq, hit.repair]));
  if (patchable.size === 0) return { value: events, fixed: 0 };
  const value = (events ?? []).map((event) => {
    const refs = patchable.get(event?.seq);
    if (refs === undefined || event.type !== "session/title") return event;
    return { ...event, data: { ...event.data, messageSeqs: refs.slice() } };
  });
  return { value, fixed: patchable.size };
}

export function titleIssuesFrom(hits) {
  if (hits.length === 0) return [];
  const seqs = hits.map((hit) => hit.seq);
  const repairable = hits.filter((hit) => Array.isArray(hit.repair)).length;
  return [
    {
      code: TITLE_CODE,
      message:
        "session/title at seq " + seqs.slice(0, 12).join(", ") + ": " + hits[0].why +
        " — the relationships fold refuses the whole log there (`session/title messageSeqs must be empty exactly for a user title` or `must cite distinct earlier human user/message events`), and reading is all-or-nothing; repair empties a user title's list and drops citations that name no earlier human user/message" +
        (repairable < hits.length
          ? ", and reports the " + String(hits.length - repairable) + " title(s) whose citations cannot be reconstructed"
          : ""),
      seqs,
      count: hits.length,
      repairable,
    },
  ];
}
