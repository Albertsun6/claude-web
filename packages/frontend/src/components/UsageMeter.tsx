import { useActiveSession } from "../store";

function fmt(n: number): string {
  if (n < 1000) return `${n}`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

export function UsageMeter() {
  const session = useActiveSession();
  const u = session?.usage;
  if (!u || u.turns === 0) return null;

  // cache hit ratio: how much of input came from cache (== free tokens)
  const totalInput = u.inputTokens + u.cacheCreationTokens + u.cacheReadTokens;
  const cachePct = totalInput > 0 ? Math.round((u.cacheReadTokens / totalInput) * 100) : 0;

  return (
    <div
      className="usage-meter"
      title={[
        `轮次: ${u.turns}`,
        `新增 input: ${u.inputTokens}`,
        `写入缓存: ${u.cacheCreationTokens}`,
        `读取缓存: ${u.cacheReadTokens} (${cachePct}% 命中)`,
        `output: ${u.outputTokens}`,
        `名义成本: $${u.costUsd.toFixed(4)} (订阅模式不实扣)`,
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
        <div
          className="usage-bar-cached"
          style={{ width: `${cachePct}%` }}
          title={`缓存命中 ${cachePct}%`}
        />
      </div>
    </div>
  );
}
