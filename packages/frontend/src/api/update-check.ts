import { authFetch } from "../auth";

export interface UpdateCheckResult {
  current: { backend: string; source: "VERSION" | "package.json" | "unknown" };
  latest: {
    tag: string;
    name: string | null;
    htmlUrl: string;
    publishedAt: string | null;
    asset: { name: string; downloadUrl: string; sizeBytes: number } | null;
  } | null;
  hasUpdate: boolean;
  checkedAt: string;
  error: string | null;
}

export async function fetchUpdateCheck(): Promise<UpdateCheckResult> {
  const res = await authFetch("/api/version/latest");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
