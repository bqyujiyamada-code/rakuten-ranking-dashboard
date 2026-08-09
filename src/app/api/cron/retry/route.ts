import { isAuthorizedCronRequest } from "@/lib/auth/cronAuth";
import { retryFailedGenres } from "@/lib/collectAndAnalyze";
import { buildRetryOutcomeMessage } from "@/lib/notify/cronAlert";
import { notifySlack } from "@/lib/notify/slack";

/**
 * 当日分でAI分析が未完了のジャンル・気象・トレンドだけを対象にした復旧バッチ。
 * `/api/cron/collect`とは別のcronジョブ(1日1回、収集より後の時刻)から自動実行される他、
 * ランキング再取得・GenreMeta更新には一切触れない設計のため、同じ `CRON_SECRET` を使って
 * ユーザーが手動で(curl等で)いつでも安全に叩くこともできる(冪等: 既に成功済みのジャンルは
 * 何もせずスキップする)。詳細な設計判断はCLAUDE.md参照。
 */
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const outcome = await retryFailedGenres();

    const message = buildRetryOutcomeMessage(outcome);
    if (message) {
      await notifySlack(message);
    }

    return Response.json({ retriedAt: new Date().toISOString(), ...outcome });
  } catch (error) {
    console.error("[cron/retry] Unexpected failure", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    await notifySlack(
      `:rotating_light: [楽天ランキングダッシュボード] 自動リトライバッチが致命的エラーで停止しました - ${message}`,
    );
    return Response.json({ error: message }, { status: 500 });
  }
}
