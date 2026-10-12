/**
 * `llm/retry` policy chains (#9163).
 *
 * The released fold sequences every scheduled retry against the most recent
 * retry of the same `(turn, step, provider, policyKey)` chain: `retry` must be
 * that attempt + 1 (or 1 when the chain starts), and one chain keeps one
 * `retryId` (`Relationships.retry` — "llm/retry skips its policy attempt
 * sequence" / "llm/retry must keep one retryId per policy chain"). A writer
 * that loses the chain state stamps `retry: 1` with a fresh id on every
 * attempt, which refuses the whole log: `stored session "…" is corrupt`.
 *
 * Both values come back out of the log itself, so nothing is invented: the
 * attempt number is the event's position inside its chain, and the id is the
 * chain's own first id. `llm/retry-started` pairs a scheduled attempt by
 * `(retryId, retry)`, so it is remapped through the same table.
 */

function isRecord(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

/** The chain identity the released fold compares member by member. */
function chainKey(data) {
  const members = [data.turn, data.step, data.provider, data.policyKey];
  if (members.some((member) => member !== null && typeof member === "object")) return undefined;
  return JSON.stringify(members);
}

function pairKey(retryId, retry) {
  return JSON.stringify([retryId, retry]);
}

/**
 * Walk the log in stream order and compute the attempt number and chain id the
 * released fold demands for every `llm/retry`. Returns the rewrite table plus
 * the reasons a caller must refuse on rather than write a guess.
 */
function planChains(events) {
  const chains = new Map();
  const seenIds = new Set();
  const started = new Set();
  const scheduled = new Map();
  const rewrite = new Map();
  const refusals = [];

  for (const [index, event] of events.entries()) {
    const type = event?.type;
    if (type !== "llm/retry" && type !== "llm/retry-started") continue;
    const data = event.data;
    if (!isRecord(data)) {
      refusals.push(`${type}@${event.seq} carries no data object`);
      continue;
    }
    const retryId = data.retryId;
    const retry = data.retry;
    if (typeof retryId !== "string" || retryId === "") {
      refusals.push(`${type}@${event.seq} has no usable retryId`);
      continue;
    }
    if (!Number.isSafeInteger(retry) || retry < 1) {
      refusals.push(`${type}@${event.seq} has no usable retry counter`);
      continue;
    }
    const original = pairKey(retryId, retry);

    if (type === "llm/retry-started") {
      const target = scheduled.get(original);
      if (target === undefined) {
        refusals.push(`llm/retry-started@${event.seq} pairs no earlier scheduled attempt`);
        continue;
      }
      if (target.turn !== data.turn || target.step !== data.step) {
        refusals.push(`llm/retry-started@${event.seq} changes its scheduled coordinates`);
        continue;
      }
      const key = pairKey(target.retryId, target.retry);
      if (started.has(key)) {
        refusals.push(`llm/retry-started@${event.seq} repeats one scheduled attempt`);
        continue;
      }
      started.add(key);
      if (target.retryId !== retryId || target.retry !== retry) {
        rewrite.set(index, { retryId: target.retryId, retry: target.retry });
      }
      continue;
    }

    const key = chainKey(data);
    if (key === undefined) {
      refusals.push(`llm/retry@${event.seq} has no comparable chain identity`);
      continue;
    }
    let chain = chains.get(key);
    if (chain === undefined) {
      if (seenIds.has(retryId)) {
        refusals.push(`llm/retry@${event.seq} starts a new chain on retryId ${retryId}, which an earlier chain already uses`);
        continue;
      }
      chain = { retryId, count: 0, pairs: new Set() };
      chains.set(key, chain);
    }
    if (chain.pairs.has(original)) {
      refusals.push(`llm/retry@${event.seq} repeats the pair (${retryId}, ${retry}) inside one chain`);
      continue;
    }
    chain.pairs.add(original);
    chain.count += 1;
    seenIds.add(retryId);
    const next = { retryId: chain.retryId, retry: chain.count, turn: data.turn, step: data.step };
    scheduled.set(original, next);
    if (next.retryId !== retryId || next.retry !== retry) rewrite.set(index, next);
  }
  return { rewrite, refusals };
}

/** Seq numbers of the retries whose chain the released fold would refuse. */
export function retryChainHits(events) {
  if (!Array.isArray(events)) return { seqs: [], refusals: [] };
  const { rewrite, refusals } = planChains(events);
  const seqs = [...rewrite.keys()].map((index) => events[index]?.seq).filter((seq) => seq !== undefined);
  return { seqs, refusals };
}

/**
 * Renumber every `llm/retry` inside its chain and unify the chain's retryId.
 * Returns `fixed: 0` for a log the fold already accepts, and a non-empty
 * `refusals` when the correct values are not recoverable.
 */
export function repairRetryChains(events) {
  if (!Array.isArray(events) || events.length === 0) return { value: events, fixed: 0, refusals: [] };
  const { rewrite, refusals } = planChains(events);
  if (refusals.length > 0) return { value: events, fixed: 0, refusals };
  if (rewrite.size === 0) return { value: events, fixed: 0, refusals: [] };
  const value = events.map((event, index) => {
    const next = rewrite.get(index);
    if (next === undefined) return event;
    return {
      ...event,
      data: { ...event.data, retryId: next.retryId, retry: next.retry },
    };
  });
  return { value, fixed: rewrite.size, refusals: [] };
}
