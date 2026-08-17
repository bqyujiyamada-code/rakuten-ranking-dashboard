import { isAuthorizedCronRequest } from "@/lib/auth/cronAuth";
import { computeAndSaveMonthlyRollupForMonth } from "@/lib/analysis/monthlyRollup";
import { currentJstMonth, previousJstMonth } from "@/lib/date/jst";
import { buildMonthlyRollupFailureMessage } from "@/lib/notify/cronAlert";
import { notifySlack } from "@/lib/notify/slack";
import { TARGET_GENRES } from "@/lib/rakuten/genres";

/**
 * 月次ロールアップ(対応28.)を毎日自動計算するcron。`/api/cron/collect`(5:00 JST)・
 * `/api/cron/retry`(10:00 JST頃)とは独立した3本目のcronジョブ(Vercel Hobbyでも
 * プロジェクトあたり最大100個のcronジョブを持てることを踏まえた設計、対応35.参照)。
 *
 * 生データ(RankingSnapshotItem/DiffHighlightsItem/WeatherDailyItem)から常にフル再計算
 * する設計(対応28.)のため、日次で毎回実行しても冪等。当月分に加え前月分も毎回
 * 再計算しているのは、月初のタイミングで前月最終日までのデータを確実に反映させるため
 * (前月分の生データは既に確定しているため、何度再計算しても結果は安定する)。
 */
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const genreIds = TARGET_GENRES.map((g) => g.genreId);
    const currentMonth = currentJstMonth();
    const targetMonths = [currentMonth, previousJstMonth(currentMonth)];

    const monthResults = await Promise.all(
      targetMonths.map((month) => computeAndSaveMonthlyRollupForMonth(month, genreIds)),
    );

    const message = buildMonthlyRollupFailureMessage(monthResults);
    if (message) {
      await notifySlack(message);
    }

    return Response.json({ computedAt: new Date().toISOString(), months: monthResults });
  } catch (error) {
    console.error("[cron/monthly-rollup] Unexpected failure", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    await notifySlack(
      `:rotating_light: [楽天ランキングダッシュボード] 月次ロールアップバッチが致命的エラーで停止しました - ${message}`,
    );
    return Response.json({ error: message }, { status: 500 });
  }
}
