import { env } from "@/lib/config/env";

/** `/api/cron/*` 系ルート共通の認証チェック。CRON_SECRET未設定なら無条件で許可(ローカル開発用)。 */
export function isAuthorizedCronRequest(request: Request): boolean {
  const secret = env.cron.secret;
  if (!secret) return true;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}
