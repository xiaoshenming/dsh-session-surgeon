/** Copy for the settings-plugins tab. The live UI is the center-column panel. */
export function settingsCopy() {
  return {
    title: "Session surgeon / 会话医生",
    description: "会话 ⋯ → 复制会话 ID，贴进新对话接着学；会话打不开时再检查和修好磁盘文件。",
    body: [
      "安装（DSH 桌面端）：「插件」页添加 github:xiaoshenming/dsh-session-surgeon#main；更新也在插件页点更新，不用重启。",
      "最常用：左侧 ⋯ → 复制会话 ID，开新聊天把 ID 贴给助手。",
      "Agent tools: session_scan / session_inspect / session_repair (apply defaults to false).",
    ].join("\n"),
  };
}
