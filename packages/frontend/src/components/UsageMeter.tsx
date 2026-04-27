import { useStore, useActiveSession } from "../store";

const WARN = 50_000;
const CRIT = 100_000;

function fmt(n: number): string {
  if (n < 1000) return `${n}`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

export function UsageMeter() {
  const session = useActiveSession();
  const resetSession = useStore((s) => s.resetSession);
  const u = session?.usage;
  if (!u || u.turns === 0) return null;

  const totalInput = u.inputTokens + u.cacheCreationTokens + u.cacheReadTokens;
  const cachePct = totalInput > 0 ? Math.round((u.cacheReadTokens / totalInput) * 100) : 0;
  const level = totalInput >= CRIT ? "crit" : totalInput >= WARN ? "warn" : "ok";

  return (
    <div
      className={`usage-meter ${level !== "ok" ? level : ""}`}
      title={[
        `轮次: ${u.turns}`,
        `新增 input: ${u.inputTokens}`,
        `写入缓存: ${u.cacheCreationTokens}`,
        `读取缓存: ${u.cacheReadTokens} (${cachePct}% 命中)`,
        `output: ${u.outputTokens}`,
        `名义成本: $${u.costUsd.toFixed(4)}`,
      ].join("\n")}
    >
      <div className="usage-row">
        <span className="usage-label">📊</span>
        <span>{u.turns} 轮</span>
        <span className="usage-sep">·</span>
        <span title="缓存命中">💾 {fmt(u.cacheReadTokens)}</span>
        <span className="usage-sep">·</span>
        <span title="新 input">🆕 {fmt(u.inputTokens + u.cacheCreationTokens)}</span>
        <span className="usage-sep">·</span>
        <span title="输出">📝 {fmt(u.outputTokens)}</span>
      </div>
      <div className="usage-bar">
        <div className="usage-bar-cached" style={{ width: `${cachePct}%` }} />
      </div>
      {level === "warn" && (
        <div className="usage-tip">
          ⚠ 上下文 {fmt(totalInput)} 偏大；之后 input 都按 cache_creation 算了。
        </div>
      )}
      {level === "crit" && session && (
        <div className="usage-tip">
          🔥 上下文 {fmt(totalInput)} 太大，**强烈建议开新会话**。
          <button
            className="secondary"
            style={{ marginLeft: 6, fontSize: 10, padding: "2px 8px", minHeight: 22 }}
            onClick={() => resetSession(session.cwd)}
          >
            new session
          </button>
        </div>
      )}
    </div>
  );
}
