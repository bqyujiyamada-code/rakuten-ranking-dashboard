import { env } from "@/lib/config/env";
import { collectAndAnalyzeAllGenres } from "@/lib/collectAndAnalyze";

/**
 * 定期収集バッチのエントリポイント。
 * EventBridge Scheduler / Vercel Cron 等の外部スケジューラから
 * `Authorization: Bearer <CRON_SECRET>` 付きで呼び出す想定。
 * Vercel Cron Jobs はプロジェクトに `CRON_SECRET` 環境変数を設定しておくと、
 * 自動的にこのヘッダーを付与して呼び出してくれる。
 *
 * ジャンル数×Gemini呼び出しで数十秒かかりうるため、デフォルトの実行時間上限
 * (Hobbyプランでも300秒) を明示しておく。
 */
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = env.cron.secret;
  if (secret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${secret}`) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const results = await collectAndAnalyzeAllGenres();
    return Response.json({ collectedAt: new Date().toISOString(), results });
  } catch (error) {
    console.error("[cron/collect] Unexpected failure", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
