/** Copy for the settings-plugins tab. The live UI is the sidebar panel. */
export function settingsCopy() {
  return {
    title: "Session surgeon / 会话医生",
    description:
      "Scan and repair DeepSeek Harness sessions that refuse to load (seq gap, torn zstd, lone surrogate).",
    body: [
      "GUI: 左侧「会话医生」打开面板；会话 ⋯ 菜单可复制 ID / 检查 / 预览修复。",
      "CLI:",
      "  node bin/dsh-session-surgeon.mjs scan",
      "  node bin/dsh-session-surgeon.mjs inspect <id>",
      "  node bin/dsh-session-surgeon.mjs repair <id>          # dry-run",
      "  node bin/dsh-session-surgeon.mjs repair <id> --apply  # writes .bak.<utc> first",
      "Agent tools: session_scan / session_inspect / session_repair (apply defaults to false).",
    ].join("\n"),
  };
}
