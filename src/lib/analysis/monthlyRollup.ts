import { addDaysJst } from "@/lib/date/jst";
import {
  getHighlightsAtTimestamp,
  getInsightAtTimestamp,
  getSnapshotAtTimestamp,
  getWeatherDaily,
  listDailyBundlesForMonth,
  putMonthlyRollup,
} from "@/lib/db/rankingRepository";
import type { DailyBundleItem, DiffHighlightRecord, DiffHighlightType } from "@/lib/db/types";
import { mapWithConcurrency } from "@/lib/collectAndAnalyze";
import { summariseMonthlySnapshots, type MonthlySnapshotRow } from "@/lib/analysis/rollupMetrics";

const HIGHLIGHT_TYPES: DiffHighlightType[] = [
  "NEW_ENTRY",
  "RANK_SURGE",
  "RANK_DROP",
  "PRICE_DROP",
  "PRICE_UP",
];
const ITEMS_PER_SNAPSHOT = 30;

// DynamoDBへの同時クエリ数を抑えるための上限。対応38.で発見: ジャンル単位・日単位とも
// 無制限にPromise.allしていたため、当月・前月2ヶ月分×16ジャンル×最大31日×3クエリで
// 最大3000件近いQueryがほぼ同時発火しうる設計になっていた。楽天API呼び出し(完全直列)・
// Gemini呼び出し(GEMINI_ANALYSIS_CONCURRENCY=8)には明示的な同時実行数の上限を設けている
// 既存の設計方針(CLAUDE.md参照)に合わせ、ここにも上限を設ける。
const GENRE_CONCURRENCY = 4;
const DAY_CONCURRENCY = 6;

/**
 * 対応27.のDiffHighlightsItem分離より前に書き込まれた日はDiffHighlightsItemが存在せず、
 * InsightItem側に埋め込まれたままなのでそちらにフォールバックする
 * (/api/insights、scripts/compute-monthly-rollup.mjsと同じ後方互換ロジック)。
 */
async function getHighlightsWithFallback(
  genreId: string,
  timestamp: string,
): Promise<DiffHighlightRecord[]> {
  const highlightsItem = await getHighlightsAtTimestamp(genreId, timestamp);
  if (highlightsItem?.highlights) return highlightsItem.highlights;

  const insight = await getInsightAtTimestamp(genreId, timestamp);
  return insight?.highlights ?? [];
}

/**
 * 1ジャンル・1ヶ月分のロールアップを、その月の生データからフル再計算する。
 * scripts/compute-monthly-rollup.mjsの手動実行版と同じロジック(対応28.)を、
 * /api/cron/monthly-rollup(対応36.)からの自動実行向けにsrc/lib化したもの。
 */
export async function computeRollupForGenre(
  genreId: string,
  month: string,
  dailyBundles: DailyBundleItem[],
) {
  const prices: number[] = [];
  const itemCodes = new Set<string>();
  const dailySnapshots: MonthlySnapshotRow[][] = [];
  const highlightCounts = Object.fromEntries(
    HIGHLIGHT_TYPES.map((t) => [t, 0]),
  ) as Record<DiffHighlightType, number>;
  const weatherSamples: { tempMaxC: number; tempMinC: number; precipitationMm: number }[] = [];

  await mapWithConcurrency(dailyBundles, DAY_CONCURRENCY, async (bundle) => {
    const [snapshot, highlights, weather] = await Promise.all([
      getSnapshotAtTimestamp(genreId, bundle.timestamp),
      getHighlightsWithFallback(genreId, bundle.timestamp),
      getWeatherDaily(addDaysJst(bundle.date, -1)),
    ]);

    dailySnapshots.push(
      snapshot.map((item) => ({
        rank: Number(item.rank),
        itemCode: item.itemCode,
        itemName: item.itemName,
      })),
    );
    for (const item of snapshot) {
      if (typeof item.price === "number") prices.push(item.price);
      if (item.itemCode) itemCodes.add(item.itemCode);
    }
    for (const highlight of highlights) {
      if (highlight.type in highlightCounts) highlightCounts[highlight.type] += 1;
    }
    if (weather) {
      weatherSamples.push({
        tempMaxC: weather.tempMaxC,
        tempMinC: weather.tempMinC,
        precipitationMm: weather.precipitationMm,
      });
    }
  });

  const daysCollected = dailyBundles.length;
  const priceStats = prices.length
    ? {
        avg: Math.round((prices.reduce((a, b) => a + b, 0) / prices.length) * 10) / 10,
        min: Math.min(...prices),
        max: Math.max(...prices),
      }
    : { avg: 0, min: 0, max: 0 };

  const weather = weatherSamples.length
    ? {
        avgTempMaxC:
          Math.round(
            (weatherSamples.reduce((a, w) => a + w.tempMaxC, 0) / weatherSamples.length) * 10,
          ) / 10,
        avgTempMinC:
          Math.round(
            (weatherSamples.reduce((a, w) => a + w.tempMinC, 0) / weatherSamples.length) * 10,
          ) / 10,
        totalPrecipitationMm:
          Math.round(weatherSamples.reduce((a, w) => a + w.precipitationMm, 0) * 10) / 10,
        daysWithData: weatherSamples.length,
      }
    : null;

  const { nameKeywords, topItems } = summariseMonthlySnapshots(dailySnapshots);

  return {
    genreId,
    month,
    daysCollected,
    priceStats,
    uniqueItemCount: itemCodes.size,
    totalItemSlots: daysCollected * ITEMS_PER_SNAPSHOT,
    highlightCounts,
    nameKeywords,
    topItems,
    weather,
  };
}

export interface MonthlyRollupGenreResult {
  genreId: string;
  outcome: "saved" | "failed";
  error?: string;
}

export interface MonthlyRollupMonthResult {
  month: string;
  daysCollected: number;
  genres: MonthlyRollupGenreResult[];
}

/**
 * 指定月の全ジャンル分のロールアップを再計算・保存する。その月の収集データが1件も
 * 無ければ何もしない(daysCollected: 0を返す)。1ジャンルの失敗が他ジャンルを止めない
 * よう、ジャンル単位でエラーを捕捉する(collectAndAnalyzeGenre系の既存方針と同じ)。
 */
export async function computeAndSaveMonthlyRollupForMonth(
  month: string,
  genreIds: string[],
): Promise<MonthlyRollupMonthResult> {
  const dailyBundles = await listDailyBundlesForMonth(month);
  if (dailyBundles.length === 0) {
    return { month, daysCollected: 0, genres: [] };
  }

  const genres = await mapWithConcurrency(
    genreIds,
    GENRE_CONCURRENCY,
    async (genreId): Promise<MonthlyRollupGenreResult> => {
      try {
        const rollup = await computeRollupForGenre(genreId, month, dailyBundles);
        await putMonthlyRollup(rollup);
        return { genreId, outcome: "saved" };
      } catch (error) {
        console.error(`[monthly-rollup] Failed to compute rollup for ${genreId} (${month})`, error);
        return {
          genreId,
          outcome: "failed",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  );

  return { month, daysCollected: dailyBundles.length, genres };
}
