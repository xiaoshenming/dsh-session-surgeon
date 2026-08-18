/** Copy for the settings-plugins tab. The live UI is the overlay panel. */
export function settingsCopy() {
  return {
    title: "Session surgeon / 会话医生",
    description: "点开一条看对话；会话打不开时再检查和修好磁盘文件。",
    body: [
      "有 session- 前缀和没有前缀是同一种会话，只是新旧 ID 写法不同。",
      "最常用：会话 ⋯ → 复制会话 ID。点「会话医生」里的一条可看对话。",
      "CLI: node bin/dsh-session-surgeon.mjs scan | inspect <id> | repair <id> [--apply]",
      "Agent tools: session_scan / session_inspect / session_repair (apply defaults to false).",
    ].join("\n"),
  };
}
