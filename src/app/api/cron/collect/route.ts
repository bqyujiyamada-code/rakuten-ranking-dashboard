import { isAuthorizedCronRequest } from "@/lib/auth/cronAuth";
import { collectAndAnalyzeAllGenres } from "@/lib/collectAndAnalyze";
import { toJstDateString } from "@/lib/date/jst";
import { buildCronFailureMessage } from "@/lib/notify/cronAlert";
import { notifySlack } from "@/lib/notify/slack";

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
  if (!isAuthorizedCronRequest(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { results, weather, trend } = await collectAndAnalyzeAllGenres();

    const failureMessage = buildCronFailureMessage(
      results,
      { weather, trend },
      toJstDateString(new Date()),
    );
    if (failureMessage) {
      await notifySlack(failureMessage);
    }

    return Response.json({ collectedAt: new Date().toISOString(), results, weather, trend });
  } catch (error) {
    console.error("[cron/collect] Unexpected failure", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    await notifySlack(
      `:rotating_light: [楽天ランキングダッシュボード] Cron収集バッチが致命的エラーで停止しました - ${message}`,
    );
    return Response.json({ error: message }, { status: 500 });
  }
}
