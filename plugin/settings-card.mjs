/** Copy for the settings-plugins tab. The live UI is the overlay panel. */
export function settingsCopy() {
  return {
    title: "Session surgeon / 会话医生",
    description: "点开一条看对话；会话打不开时再检查和修好磁盘文件。",
    body: [
      "安装：dsh plugin --profile web add \"github:xiaoshenming/dsh-session-surgeon#main\"",
      "最常用：会话 ⋯ → 复制会话 ID。点「会话医生」里的一条可看对话。",
      "Agent tools: session_scan / session_inspect / session_repair (apply defaults to false).",
    ].join("\n"),
  };
}
