/**
 * Official generation filenames (0.1.3-alpha+):
 *   v0 → session.jsonl[.zstd]
 *   vN → session.vN.jsonl[.zstd]  (N >= 1, no leading zeros, never .v0)
 */

export function sessionFormatLogFilename(version) {
  if (!Number.isSafeInteger(version) || version < 0) return null;
  return version === 0 ? "session.jsonl" : `session.v${version}.jsonl`;
}

export function generationLogFilename(version, compression) {
  const stem = sessionFormatLogFilename(version);
  if (!stem) return null;
  return compression === "zstd" ? `${stem}.zstd` : stem;
}

/**
 * Parse a committed generation basename. `.tmp`, `.v0`, uppercase, and
 * leading-zero names are not canonical.
 */
export function parseGenerationFilename(name) {
  if (typeof name !== "string" || name.endsWith(".tmp")) return null;
  let compression = "none";
  let stem = name;
  if (stem.endsWith(".jsonl.zstd")) {
    compression = "zstd";
    stem = stem.slice(0, -".jsonl.zstd".length);
  } else if (stem.endsWith(".jsonl")) {
    stem = stem.slice(0, -".jsonl".length);
  } else {
    return null;
  }
  if (stem === "session") return { version: 0, compression, filename: name };
  const match = /^session\.v([1-9][0-9]*)$/.exec(stem);
  if (!match) return null;
  return { version: Number(match[1]), compression, filename: name };
}

export function isGenerationTmpName(name) {
  return typeof name === "string" && name.endsWith(".tmp") && parseGenerationFilename(name.slice(0, -4)) != null;
}

/** Highest generation the installed runtime can read; else the newest on disk. */
export function pickCanonicalGeneration(gens, currentVersion) {
  if (!Array.isArray(gens) || gens.length === 0) return null;
  const sorted = [...gens].sort((a, b) => a.version - b.version);
  const readable = sorted.filter((g) => g.version <= currentVersion);
  return (readable.length > 0 ? readable : sorted).at(-1);
}
