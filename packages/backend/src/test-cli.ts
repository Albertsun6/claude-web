import { runSession } from "./cli-runner.js";

console.log("Testing claude CLI subprocess (subscription mode)...\n");

await runSession({
  prompt: "用一句话告诉我当前目录里有哪些文件。",
  cwd: process.cwd(),
  model: "claude-haiku-4-5",
  permissionMode: "bypassPermissions",
  onMessage: (msg) => {
    const m = msg as { type: string; subtype?: string };
    if (m.type === "system" && m.subtype === "init") {
      const init = msg as any;
      console.log(`[init] session=${init.session_id} model=${init.model} apiKeySource=${init.apiKeySource}`);
    } else if (m.type === "assistant") {
      const content = (msg as any).message?.content ?? [];
      for (const block of content) {
        if (block.type === "text") process.stdout.write(block.text);
        if (block.type === "tool_use")
          console.log(`\n[tool_use] ${block.name}(${JSON.stringify(block.input).slice(0, 80)})`);
      }
    } else if (m.type === "result") {
      const r = msg as any;
      console.log(`\n\n[done] ${r.num_turns} turns, $${r.total_cost_usd?.toFixed(4) ?? "?"} (note: cost is nominal under subscription)`);
    }
  },
});
