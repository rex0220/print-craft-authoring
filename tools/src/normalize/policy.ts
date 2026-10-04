/**
 * 外部 URL の承認（docs/authoring-plan.md 12.3、Codex BLOCKER 1）。承認は AI が書けない場所 policy/authoring-policy.json に置く
 * （テンプレートの .claude/settings.json で policy/ への書き込みを許可しない。利用者が手で編集する）。
 * {
 *   "allowExternal": [
 *     { "origin": "https://cdn.example.com", "files": ["settings/見積書.json"], "note": "社印の画像" },
 *     { "url": "https://example.com/logo.png" }
 *   ]
 * }
 * origin か url のどちらかで照合し、files があればその設定ファイル（相対パス）に限る。
 * Web フォントの Google Fonts（fonts.googleapis.com / fonts.gstatic.com）は既定で許す。
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export interface AllowRule {
  origin?: string;
  url?: string;
  files?: string[];
  note?: string;
}

export interface Policy {
  allowExternal: AllowRule[];
  /** 読んだファイル（無ければ undefined） */
  file?: string;
}

export const DEFAULT_ALLOWED_ORIGINS = ["https://fonts.googleapis.com", "https://fonts.gstatic.com"];

export function loadPolicy(opt: { policyFile?: string; cwd?: string } = {}): Policy {
  const file = opt.policyFile ?? path.join(opt.cwd ?? process.cwd(), "policy", "authoring-policy.json");
  if (!existsSync(file)) return { allowExternal: [] };
  const raw = JSON.parse(readFileSync(file, "utf8")) as { allowExternal?: unknown };
  const rules = Array.isArray(raw.allowExternal) ? (raw.allowExternal as AllowRule[]) : [];
  return { allowExternal: rules.filter((r) => r && (typeof r.origin === "string" || typeof r.url === "string")), file };
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function normalizeRel(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "");
}

/** URL が承認済みか（settingsFile は cwd からの相対パス） */
export function isAllowed(policy: Policy, url: string, settingsFile?: string): boolean {
  const origin = originOf(url);
  if (origin && DEFAULT_ALLOWED_ORIGINS.includes(origin)) return true;
  const rel = settingsFile ? normalizeRel(settingsFile) : undefined;
  for (const r of policy.allowExternal) {
    const hit = (r.url && r.url === url) || (r.origin && origin && originOf(r.origin) === origin);
    if (!hit) continue;
    if (r.files && r.files.length) {
      if (!rel) continue;
      if (!r.files.map(normalizeRel).includes(rel)) continue;
    }
    return true;
  }
  return false;
}
