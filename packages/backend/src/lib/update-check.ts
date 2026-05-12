// GitHub Releases API poller. 6h in-memory cache so we don't hit unauth rate
// limit (60 req/h). Returns the latest release + matched arm64 .pkg asset.

import { getCurrentVersion } from "./version-info.js";

const REPO_OWNER = process.env.VESSEL_REPO_OWNER ?? "Albertsun6";
const REPO_NAME = process.env.VESSEL_REPO_NAME ?? "claude-web";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

export interface LatestReleaseAsset {
  name: string;
  downloadUrl: string;
  sizeBytes: number;
}

export interface LatestRelease {
  tag: string;
  name: string | null;
  htmlUrl: string;
  publishedAt: string | null;
  asset: LatestReleaseAsset | null;
}

export interface UpdateCheckResult {
  current: ReturnType<typeof getCurrentVersion>;
  latest: LatestRelease | null;
  hasUpdate: boolean;
  checkedAt: string;
  error: string | null;
}

interface CacheEntry {
  result: UpdateCheckResult;
  ts: number;
}

let cache: CacheEntry | null = null;

function pickArm64Asset(assets: Array<{ name: string; browser_download_url: string; size: number }>): LatestReleaseAsset | null {
  const m = assets.find((a) => /Vessel-Backend-v[\d.]+-arm64\.pkg$/.test(a.name));
  if (!m) return null;
  return { name: m.name, downloadUrl: m.browser_download_url, sizeBytes: m.size };
}

function parsePkgVersion(assetName: string): string | null {
  const m = assetName.match(/Vessel-Backend-v([\d.]+)-arm64\.pkg$/);
  return m ? m[1] : null;
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const ai = pa[i] ?? 0;
    const bi = pb[i] ?? 0;
    if (ai !== bi) return ai - bi;
  }
  return 0;
}

async function fetchLatest(): Promise<UpdateCheckResult> {
  const current = getCurrentVersion();
  const checkedAt = new Date().toISOString();

  try {
    const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, {
      headers: {
        "Accept": "application/vnd.github+json",
        "User-Agent": `Vessel/${current.backend}`,
        ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
      },
      signal: ctrl.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      return {
        current,
        latest: null,
        hasUpdate: false,
        checkedAt,
        error: `GitHub API ${res.status} ${res.statusText}`,
      };
    }

    const data = await res.json() as {
      tag_name: string;
      name: string | null;
      html_url: string;
      published_at: string | null;
      assets: Array<{ name: string; browser_download_url: string; size: number }>;
    };

    const asset = pickArm64Asset(data.assets ?? []);
    const latest: LatestRelease = {
      tag: data.tag_name,
      name: data.name,
      htmlUrl: data.html_url,
      publishedAt: data.published_at,
      asset,
    };

    let hasUpdate = false;
    if (asset && current.source !== "unknown") {
      const latestPkgVersion = parsePkgVersion(asset.name);
      if (latestPkgVersion) {
        hasUpdate = compareVersions(latestPkgVersion, current.backend) > 0;
      }
    }

    return { current, latest, hasUpdate, checkedAt, error: null };
  } catch (err) {
    return {
      current,
      latest: null,
      hasUpdate: false,
      checkedAt,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function checkForUpdate(opts: { force?: boolean } = {}): Promise<UpdateCheckResult> {
  if (!opts.force && cache && Date.now() - cache.ts < CACHE_TTL_MS) {
    return cache.result;
  }
  const result = await fetchLatest();
  // Only refresh cache on successful fetch — keep last-good when GitHub is flaky
  if (!result.error || !cache) {
    cache = { result, ts: Date.now() };
  }
  return cache.result;
}
