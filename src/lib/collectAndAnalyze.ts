import { TARGET_GENRES, type GenreDefinition } from "@/lib/rakuten/genres";
import { fetchGenreRanking } from "@/lib/rakuten/client";
import { addDaysJst, toJstDateString } from "@/lib/date/jst";
import { fetchTokyoDailyWeather } from "@/lib/weather/openMeteo";
import { fetchDailyTrendSummary } from "@/lib/analysis/trendSummary";
import {
  advanceGenreMeta,
  getGenreMeta,
  getLatestInsight,
  getSnapshotAtTimestamp,
  getTrendDaily,
  getWeatherDaily,
  putDailyBundle,
  putInsight,
  putRankingSnapshot,
  putTrendDaily,
  putWeatherDaily,
} from "@/lib/db/rankingRepository";
import { detectDiffHighlights, selectHighlightsForGemini } from "@/lib/analysis/diff";
import {
  generateTrendInsight,
  type TrendContext,
  type WeatherContext,
} from "@/lib/analysis/gemini";
import type { DiffHighlightRecord } from "@/lib/db/types";

// 楽天APIのレート制限 (概ね1リクエスト/秒) を踏まえたジャンル間インターバル
const REQUEST_INTERVAL_MS = 1100;

export interface GenreCollectionResult {
  genreId: string;
  genreName: string;
  itemCount: number;
  highlightCount: number;
  aiAnalysisGenerated: boolean;
  error?: string;
}

export interface DailyContext {
  weather: WeatherContext | null;
  trend: TrendContext | null;
}

const EMPTY_DAILY_CONTEXT: DailyContext = { weather: null, trend: null };

/** 1ジャンル分の「取得 → 差分検知 → AI分析 → 保存」パイプライン */
export async function collectAndAnalyzeGenre(
  genre: GenreDefinition,
  timestamp: string,
  dailyContext: DailyContext = EMPTY_DAILY_CONTEXT,
): Promise<GenreCollectionResult> {
  const meta = await getGenreMeta(genre.genreId);
  const previousTimestamp = meta?.latestTimestamp ?? null;

  const currentItems = await fetchGenreRanking({ genreId: genre.genreId });

  const previousItems = previousTimestamp
    ? await getSnapshotAtTimestamp(genre.genreId, previousTimestamp)
    : [];

  const highlights: DiffHighlightRecord[] = previousItems.length
    ? detectDiffHighlights(currentItems, previousItems)
    : [];

  await putRankingSnapshot(genre.genreId, timestamp, currentItems);
  await advanceGenreMeta(genre.genreId, timestamp);

  let aiAnalysisGenerated = false;
  if (highlights.length > 0) {
    try {
      const previousInsight = await getLatestInsight(genre.genreId);
      // Geminiには件数・多様性を絞った部分集合のみ渡す。保存する highlights (ランキング表の
      // 「変動」列がそのまま表示に使う) は detectDiffHighlights が返した全件のまま。
      const geminiHighlights = selectHighlightsForGemini(highlights);
      const { trendAnalysisText, forecastText } = await generateTrendInsight(
        genre.name,
        geminiHighlights,
        new Date(timestamp),
        previousInsight
          ? {
              trendAnalysisText: previousInsight.aiAnalysisText,
              forecastText: previousInsight.forecastText,
            }
          : null,
        dailyContext.weather,
        dailyContext.trend,
      );
      await putInsight(genre.genreId, timestamp, trendAnalysisText, forecastText, highlights);
      aiAnalysisGenerated = true;
    } catch (error) {
      console.error(
        `[analysis] Gemini analysis failed for genre ${genre.genreId}`,
        error,
      );
    }
  }

  return {
    genreId: genre.genreId,
    genreName: genre.name,
    itemCount: currentItems.length,
    highlightCount: highlights.length,
    aiAnalysisGenerated,
  };
}

/**
 * 気象データを取得する。既にDBに当日分のキャッシュがあればそれを使い、無ければ
 * Open-Meteoから取得して保存する。失敗してもnullを返すだけで収集全体は継続する。
 */
async function getOrFetchWeatherContext(date: string): Promise<WeatherContext | null> {
  try {
    const cached = await getWeatherDaily(date);
    if (cached) {
      return {
        date: cached.date,
        tempMaxC: cached.tempMaxC,
        tempMinC: cached.tempMinC,
        precipitationMm: cached.precipitationMm,
        weatherLabel: cached.weatherLabel,
      };
    }

    const fetched = await fetchTokyoDailyWeather(date);
    if (!fetched) return null;

    await putWeatherDaily(date, {
      location: "Tokyo",
      tempMaxC: fetched.tempMaxC,
      tempMinC: fetched.tempMinC,
      precipitationMm: fetched.precipitationMm,
      weatherCode: fetched.weatherCode,
      weatherLabel: fetched.weatherLabel,
      fetchedAt: new Date().toISOString(),
    });

    return { date, ...fetched };
  } catch (error) {
    console.error(`[weather] Failed to get/fetch weather for ${date}`, error);
    return null;
  }
}

/**
 * 世間のトレンド要約を取得する。既にDBに当日分のキャッシュがあればそれを使い、
 * 無ければGeminiのGoogle検索groundingで生成して保存する。全ジャンル共通のため
 * 収集バッチ全体で1回だけ呼ばれる想定。失敗してもnullを返すだけで収集全体は継続する。
 */
async function getOrFetchTrendContext(date: string): Promise<TrendContext | null> {
  try {
    const cached = await getTrendDaily(date);
    if (cached) {
      return { date: cached.date, summaryText: cached.summaryText };
    }

    const fetched = await fetchDailyTrendSummary(date);
    await putTrendDaily(date, fetched.summaryText, fetched.sources);
    return { date, summaryText: fetched.summaryText };
  } catch (error) {
    console.error(`[trend] Failed to get/fetch trend summary for ${date}`, error);
    return null;
  }
}

/**
 * 全ての対象ジャンルを順番に収集・分析する (定期収集バッチのエントリポイント)。
 * 1ジャンルの失敗が他ジャンルの処理を止めないよう、genre単位でエラーを捕捉する。
 *
 * 気象・トレンドは「前日(causalDate)分」を全ジャンル共通で1回だけ取得し、各ジャンルの
 * AI分析に渡す。収集時点(7時JST)では前日は既に終わっているため、Open-Meteoの実測値・
 * Geminiのトレンド要約とも確定情報として即座に取得でき、追加の夜間バッチは不要
  (詳細な設計理由はCLAUDE.md参照)。
 */
export async function collectAndAnalyzeAllGenres(
  genres: GenreDefinition[] = TARGET_GENRES,
): Promise<GenreCollectionResult[]> {
  const timestamp = new Date().toISOString();
  const today = toJstDateString(new Date(timestamp));
  const causalDate = addDaysJst(today, -1);

  const [weather, trend] = await Promise.all([
    getOrFetchWeatherContext(causalDate),
    getOrFetchTrendContext(causalDate),
  ]);
  const dailyContext: DailyContext = { weather, trend };

  const results: GenreCollectionResult[] = [];

  for (let i = 0; i < genres.length; i += 1) {
    const genre = genres[i];
    try {
      const result = await collectAndAnalyzeGenre(genre, timestamp, dailyContext);
      results.push(result);
    } catch (error) {
      console.error(
        `[collect] Failed to process genre ${genre.genreId} (${genre.name})`,
        error,
      );
      results.push({
        genreId: genre.genreId,
        genreName: genre.name,
        itemCount: 0,
        highlightCount: 0,
        aiAnalysisGenerated: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const isLast = i === genres.length - 1;
    if (!isLast) {
      await new Promise((resolve) => setTimeout(resolve, REQUEST_INTERVAL_MS));
    }
  }

  try {
    await putDailyBundle(today, timestamp, causalDate);
  } catch (error) {
    console.error(`[collect] Failed to save daily bundle for date ${today}`, error);
  }

  return results;
}
