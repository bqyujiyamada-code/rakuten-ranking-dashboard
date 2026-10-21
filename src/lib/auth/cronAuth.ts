import { env } from "@/lib/config/env";

/**
 * `/api/cron/*` 系ルート共通の認証チェック。
 * CRON_SECRET未設定時は、ローカル開発 (`next dev`) に限り無条件で許可する。
 * 本番・プレビュー (NODE_ENV=production) では設定漏れでも誰でも叩けないよう拒否する (fail-closed)。
 */
export function isAuthorizedCronRequest(request: Request): boolean {
  const secret = env.cron.secret;
  if (!secret) {
    if (process.env.NODE_ENV === "development") return true;
    console.error("CRON_SECRET is not set; rejecting cron request");
    return false;
  }
  return request.headers.get("authorization") === `Bearer ${secret}`;
}
