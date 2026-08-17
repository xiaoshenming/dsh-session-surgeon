/** Copy for the settings-plugins tab. The live UI is the overlay panel. */
export function settingsCopy() {
  return {
    title: "Session surgeon / 会话医生",
    description: "当左侧会话打不开、点进去报错时，用它检查和修好磁盘上的会话文件。",
    body: [
      "最常用：会话 ⋯ → 复制会话 ID。",
      "会话打不开时：打开「会话医生」→ 选中它 → 先看会改什么 → 再点修好。",
      "CLI: node bin/dsh-session-surgeon.mjs scan | inspect <id> | repair <id> [--apply]",
      "Agent tools: session_scan / session_inspect / session_repair (apply defaults to false).",
    ].join("\n"),
  };
}
