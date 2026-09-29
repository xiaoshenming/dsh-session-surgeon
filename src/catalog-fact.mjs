/**
 * The child-catalog path the v3→v4 stage runs for a subagent child (#7995).
 *
 * `historicalChildCatalogSource` collects a child's own descriptor and hands it
 * to `childCatalogFact`, which is the only reader of `mode`. Measured against
 * the released function (`dsh-session-format-v3-to-v4/lib/index.js:871-920`),
 * by ablation:
 *
 *   - not exactly one descriptor row, or `version ∉ [1, 2, 3]` → no fact and
 *     **no refusal** (the function returns early);
 *   - `provider` not a string → refused;
 *   - `version !== 1` and `mode ∉ {continuable, one-shot}` → refused
 *     (`has an invalid subagent descriptor mode`);
 *   - the fact's mode is `continuable` for version 1 (forced), else the row's
 *     own mode, and `catalogFact` (`:927`) requires a **string `label`**
 *     whenever that mode is `continuable` → a version-1 row, or a version 2/3
 *     row with mode `continuable`, needs `label`. A non-string `label` is
 *     refused for every mode.
 *
 * The count is only evaluable offline for an **unseeded** child: the catalog
 * counts rows at `seq >= inheritedEventCount`, and `inheritedEventCount` is
 * runtime state that no on-disk header carries (`assertReleasedV4Header`'s
 * allowed set is version/id/createdAt/isSeeded/delegationDepth/cwd/
 * parentSession/origin/agentPreset). `assertReleasedV2Artifact` pins the one
 * direction we can use: `if (!header.isSeeded && cut !== 0) throw` — unseeded
 * means the cut is 0, so the whole file is the counted range. A seeded child is
 * skipped rather than guessed at.
 */
const KNOWN_VERSIONS = new Set([1, 2, 3]);
const CATALOG_MODES = new Set(["continuable", "one-shot"]);

/** @returns {{seq: number, reason: string}[]} */
export function catalogFactHits(header, events) {
  if (header?.origin !== "subagent" || header.parentSession === undefined) return [];
  if (header.isSeeded !== false) return [];
  const descriptors = events.filter((event) => event?.type === "subagent/descriptor");
  if (descriptors.length !== 1) return [];
  const data = descriptors[0].data;
  if (!data || typeof data !== "object" || !KNOWN_VERSIONS.has(data.version)) return [];
  const seq = descriptors[0].seq;
  if (typeof data.provider !== "string") return [{ seq, reason: "provider" }];
  if (data.version !== 1 && !CATALOG_MODES.has(data.mode)) return [{ seq, reason: "mode" }];
  // Version 1 is normalised to "continuable" before the fact is validated.
  const mode = data.version === 1 ? "continuable" : data.mode;
  if (data.label !== undefined && typeof data.label !== "string") return [{ seq, reason: "label" }];
  if (mode === "continuable" && typeof data.label !== "string") return [{ seq, reason: "label" }];
  return [];
}
