/** Copy for the settings-plugins tab. No DOM, no aionui details slot. */
export function settingsCopy() {
  return {
    title: "Session surgeon",
    description:
      "Scan and repair DeepSeek Harness sessions that refuse to load (seq gap, torn zstd, lone surrogate).",
    body: [
      "Use the CLI when the GUI cannot open a session:",
      "  node bin/dsh-session-surgeon.mjs scan",
      "  node bin/dsh-session-surgeon.mjs inspect <id>",
      "  node bin/dsh-session-surgeon.mjs repair <id>          # dry-run",
      "  node bin/dsh-session-surgeon.mjs repair <id> --apply  # writes .bak.<utc> first",
      "Agent tools: session_scan / session_inspect / session_repair (apply defaults to false).",
    ].join("\n"),
  };
}
