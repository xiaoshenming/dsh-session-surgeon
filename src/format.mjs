function pad(value, n) {
  const s = value == null ? "-" : String(value);
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

function shortId(id) {
  if (!id) return "-";
  return id.length <= 16 ? id : id.slice(0, 8) + "…" + id.slice(-4);
}

export function formatScanText(report) {
  const lines = [`root ${report.root}  (${report.count} sessions)`, ""];
  lines.push([pad("health", 22), pad("id", 18), pad("frames", 8), pad("bytes", 10), "flags"].join(" "));
  for (const row of report.sessions ?? []) {
    const id = shortId(row.header?.id ?? row.sessionDir);
    const flags = (row.flags ?? []).join(",") || (row.orphanTmp ? "orphan-tmp" : "");
    lines.push(
      [pad(row.health, 22), pad(id, 18), pad(row.frames ?? "-", 8), pad(row.bytes ?? "-", 10), flags].join(" "),
    );
  }
  return lines.join("\n");
}

export function formatInspectText(report) {
  const lines = [
    `id        ${report.header?.id ?? report.sessionDir}`,
    `health    ${report.health}`,
    `preset    ${report.preset ?? "-"}`,
    `parent    ${report.parent ?? "-"}`,
    `depth     ${report.depth ?? "-"}`,
    `frames    ${report.frames}  failed=${report.failedFrames}  torn=${report.torn ? "yes" : "no"}`,
    `events    ${report.logicalEvents}  lastSeq=${report.lastSeq}  packedRows=${report.packedRows}  overflow=${report.overflowEvents ?? 0}  packedOverlap=${report.packedOverlapKept ?? 0}`,
    `turns     ${report.turns?.count ?? 0}  open=${report.turns?.open ? "yes" : "no"}  wouldClose=${report.wouldClose}`,
    `goal      ${report.goal ? report.goal.id + " / " + report.goal.phase : "-"}`,
    `flags     ${(report.flags ?? []).join(", ") || "-"}`,
  ];
  if (report.issues?.length) {
    lines.push("issues:");
    for (const issue of report.issues) lines.push(`  - ${issue.code}: ${issue.message}`);
  }
  if (report.types && Object.keys(report.types).length) {
    lines.push("types:");
    for (const [type, n] of Object.entries(report.types).sort((a, b) => b[1] - a[1])) {
      lines.push(`  ${pad(type, 28)} ${n}`);
    }
  }
  return lines.join("\n");
}

export function formatIndexText(report) {
  const lines = [`root ${report.root}  (${report.count} sessions)`, ""];
  lines.push(
    [pad("health", 20), pad("id", 16), pad("parent", 12), pad("d", 3), pad("preset", 12), pad("turns", 6), "goal"].join(" "),
  );
  for (const row of report.sessions ?? []) {
    lines.push(
      [
        pad(row.health, 20),
        pad(shortId(row.id), 16),
        pad(shortId(row.parent), 12),
        pad(row.depth ?? "-", 3),
        pad(row.preset ?? "-", 12),
        pad(row.turns ?? "-", 6),
        row.goal ? `${shortId(row.goal.id)}/${row.goal.phase}` : "-",
      ].join(" "),
    );
  }
  return lines.join("\n");
}

export function formatRepairText(result) {
  const lines = [
    result.dryRun ? "dry-run (no write)" : result.wrote ? "applied" : "no write",
    result.plan.refuse ? `refuse: ${result.plan.refuse}` : `actions: ${result.plan.actions.length}`,
  ];
  for (const action of result.plan.actions ?? []) lines.push(`  - ${action.code}: ${action.detail}`);
  if (result.afterHealth) lines.push(`after: ${result.afterHealth}`);
  return lines.join("\n");
}
