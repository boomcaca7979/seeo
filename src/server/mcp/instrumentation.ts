export function mcpLog(tool: string, elapsedMs: number, ok: boolean) {
  if (process.env.NODE_ENV !== "production") console.info(`[mcp] ${tool} ${ok ? "ok" : "error"} ${elapsedMs}ms`);
}
