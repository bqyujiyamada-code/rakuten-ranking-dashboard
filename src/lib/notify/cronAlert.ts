import type {
  DailyContext,
  GenreCollectionResult,
  RetryOutcome,
} from "@/lib/collectAndAnalyze";

const RETRY_SCHEDULE_LABEL = "10:00 JST頃";

/**
 * Cronの収集結果(ジャンル単位の失敗 + 気象/トレンドの成否)を検査し、Slackへ通知すべき
 * 失敗があればメッセージを組み立てる。DB/ネットワーク依存の無い純粋関数
 * (notifySlackとは意図的に分離してある)。
 *
 * 失敗の判定基準:
 * - 収集自体の失敗: result.error が truthy (prepareGenre が例外を投げたジャンル)。
 *   このケースは`/api/cron/retry`の自動リトライ対象外(ランキング再取得を伴わないと
 *   直せないため、当日中は次回の日次Cronを待つしかない)。
 * - AI分析の失敗: highlightCount > 0 (=ハイライトが検知されGemini呼び出しを試みたはず) なのに
 *   aiAnalysisGenerated が false のまま。highlightCount === 0 は「変動なしで元々呼んでいない」
 *   正常系なので失敗として扱わない。このケースは自動リトライ対象。
 * - 気象/トレンドの取得失敗(dailyContext.weather / trend が null)。このケースも自動リトライ対象。
 *
 * 該当が1件も無ければ null を返す(呼び出し側はnullなら通知しない)。
 */
export function buildCronFailureMessage(
  results: GenreCollectionResult[],
  dailyContext: DailyContext,
  date: string,
): string | null {
  const genreFailures = results
    .map((result) => {
      if (result.error) {
        return `- ${result.genreName} (${result.genreId}): ランキング取得/保存に失敗 - ${result.error} (自動リトライ対象外、次回の自動収集まで待つ必要があります)`;
      }
      if (result.highlightCount > 0 && !result.aiAnalysisGenerated) {
        return `- ${result.genreName} (${result.genreId}): AI分析に失敗 (ハイライト${result.highlightCount}件検知) (${RETRY_SCHEDULE_LABEL}に自動リトライされます)`;
      }
      return null;
    })
    .filter((line): line is string => line !== null);

  const contextFailures: string[] = [];
  if (!dailyContext.weather) {
    contextFailures.push(
      `- 気象データ(Open-Meteo)の取得に失敗 (${RETRY_SCHEDULE_LABEL}に自動リトライされます)`,
    );
  }
  if (!dailyContext.trend) {
    contextFailures.push(
      `- 世間のトレンド要約(Gemini検索grounding)の取得に失敗 (${RETRY_SCHEDULE_LABEL}に自動リトライされます)`,
    );
  }

  const allFailures = [...genreFailures, ...contextFailures];
  if (allFailures.length === 0) return null;

  return [
    `:warning: [楽天ランキングダッシュボード] ${date}の収集で${genreFailures.length}/${results.length}ジャンル失敗`,
    ...allFailures,
  ].join("\n");
}

/**
 * `/api/cron/retry`(自動リトライ・手動トリガー共通)の結果を検査し、まだ未解決のものが
 * あればSlackへ通知するメッセージを組み立てる。全て解決した場合は既存の「成功時は静かに」
 * という方針を踏襲しnullを返す(通知しない)。
 *
 * buildCronFailureMessageと異なり、これは「自動での回復手段を既に使い切った後」の状態を
 * 伝えるものなので、文面は一段階緊急度を上げてある(手動対応が必要であることを明示する)。
 */
export function buildRetryOutcomeMessage(retryOutcome: RetryOutcome): string | null {
  const stillFailing = retryOutcome.results
    .map((result) => {
      if (result.outcome === "failed") {
        return `- ${result.genreName} (${result.genreId}): 自動リトライでもAI分析に失敗 - ${result.error ?? "不明なエラー"}`;
      }
      if (result.outcome === "skipped-no-snapshot") {
        return `- ${result.genreName} (${result.genreId}): ランキング取得自体が失敗しており自動リトライ対象外です(次回の自動収集まで待つ必要があります)`;
      }
      return null;
    })
    .filter((line): line is string => line !== null);

  const contextStillMissing: string[] = [];
  if (!retryOutcome.weather) {
    contextStillMissing.push("- 気象データ(Open-Meteo)が依然として取得できていません");
  }
  if (!retryOutcome.trend) {
    contextStillMissing.push("- 世間のトレンド要約が依然として取得できていません");
  }

  const allIssues = [...stillFailing, ...contextStillMissing];
  if (allIssues.length === 0) return null;

  return [
    `:rotating_light: [楽天ランキングダッシュボード] ${retryOutcome.today}: 自動リトライ後も${allIssues.length}件が未解決です。手動での確認をお願いします`,
    ...allIssues,
  ].join("\n");
}
