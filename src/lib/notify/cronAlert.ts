import type { GenreCollectionResult } from "@/lib/collectAndAnalyze";

/**
 * Cronの収集結果を検査し、Slackへ通知すべき失敗があればメッセージを組み立てる。
 * DB/ネットワーク依存の無い純粋関数(notifySlackとは意図的に分離してある)。
 *
 * 失敗の判定基準:
 * - 収集自体の失敗: result.error が truthy (prepareGenre が例外を投げたジャンル)
 * - AI分析の失敗: highlightCount > 0 (=ハイライトが検知されGemini呼び出しを試みたはず) なのに
 *   aiAnalysisGenerated が false のまま。highlightCount === 0 は「変動なしで元々呼んでいない」
 *   正常系なので失敗として扱わない。
 *
 * 該当ジャンルが1件も無ければ null を返す(呼び出し側はnullなら通知しない)。
 */
export function buildCronFailureMessage(
  results: GenreCollectionResult[],
  date: string,
): string | null {
  const failures = results
    .map((result) => {
      if (result.error) {
        return `- ${result.genreName} (${result.genreId}): ランキング取得/保存に失敗 - ${result.error}`;
      }
      if (result.highlightCount > 0 && !result.aiAnalysisGenerated) {
        return `- ${result.genreName} (${result.genreId}): AI分析に失敗 (ハイライト${result.highlightCount}件検知)`;
      }
      return null;
    })
    .filter((line): line is string => line !== null);

  if (failures.length === 0) return null;

  return [
    `:warning: [楽天ランキングダッシュボード] ${date}の収集で${failures.length}/${results.length}ジャンル失敗`,
    ...failures,
  ].join("\n");
}
