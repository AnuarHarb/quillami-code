export type AgentMode = "agent" | "plan" | "yolo";

export function formatModeLabel(mode: AgentMode): string {
  if (mode === "plan") return "plan";
  if (mode === "yolo") return "yolo";
  return "agent";
}

export function promptPrefix(mode: AgentMode): string {
  if (mode === "plan") return "plan> ";
  if (mode === "yolo") return "yolo> ";
  return "> ";
}
