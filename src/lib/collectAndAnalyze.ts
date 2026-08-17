import { TARGET_GENRES, type GenreDefinition } from "@/lib/rakuten/genres";
import { fetchGenreRanking } from "@/lib/rakuten/client";
import { addDaysJst, toJstDateString } from "@/lib/date/jst";
import { fetchTokyoDailyWeather } from "@/lib/weather/openMeteo";
import { fetchDailyTrendSummary } from "@/lib/analysis/trendSummary";
import {
  advanceGenreMeta,
  getGenreMeta,
  getHighlightsAtTimestamp,
  getInsightAtTimestamp,
  getLatestInsight,
  getSnapshotAtTimestamp,
  getTrendDaily,
  getWeatherDaily,
  putDailyBundle,
  putHighlights,
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

// フェーズ2 (Gemini分析) の同時実行数上限。楽天APIと異なりGeminiの正確な秒間/分間
// レート制限はドキュメント化されていないため、16件全てを無条件に同時発火するのは
// バースト起因の429/503を誘発するリスクがあると判断し、保守的にキャップしている。
// 詳細な設計判断はCLAUDE.md参照。
const GEMINI_ANALYSIS_CONCURRENCY = 8;

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

/** collectAndAnalyzeAllGenresの戻り値。dailyContextもSlackアラートで使うため一緒に返す */
export interface CollectionOutcome extends DailyContext {
  results: GenreCollectionResult[];
}

const EMPTY_DAILY_CONTEXT: DailyContext = { weather: null, trend: null };

/** フェーズ1(取得→差分検知→保存)の結果。フェーズ2(Gemini分析)への引き継ぎ用 */
interface GenrePreparation {
  genre: GenreDefinition;
  timestamp: string;
  itemCount: number;
  highlights: DiffHighlightRecord[];
  error?: string;
}

/**
 * フェーズ1: 1ジャンル分の「取得→差分検知→スナップショット/ハイライト保存」。
 * 楽天APIのレート制限があるため呼び出し側で直列に実行される想定。Gemini呼び出しは
 * 一切行わない(フェーズ2の`analyzeGenre`に分離、並行実行される)。
 */
async function prepareGenre(
  genre: GenreDefinition,
  timestamp: string,
): Promise<GenrePreparation> {
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

  // Gemini分析の成否とは独立に、差分検知ができた時点でハイライトは必ず保存する。
  // 以前はGemini呼び出しが成功した場合のみputInsightの一部として保存していたため、
  // Gemini API障害時にランキング表の「変動」列・将来の長期分析用の生データが
  // 丸ごと失われる問題があった(2026-08-05に実際に発生、CLAUDE.md参照)。
  //
  // advanceGenreMetaは必ずこれより後に呼ぶこと。先にmetaを進めてしまうと、
  // putHighlightsがここで失敗した場合に「今日分のスナップショットは存在するが
  // ハイライトだけ無い」状態になり、retryFailedGenresがこれを「ハイライト0件=
  // 変動なしの正常系」と区別できず、誰にも気づかれないまま当日の「変動」列・
  // AI分析が永久欠落するバグを実際に踏んだ(対応38.参照)。この順序であれば、
  // putHighlights失敗時はmetaが進んでおらず例外がそのままprepareGenre全体を
  // 失敗させるため、既存のerror系(自動リトライ対象外・次回の日次Cronで再試行)
  // が正しく機能する。
  if (highlights.length > 0) {
    await putHighlights(genre.genreId, timestamp, highlights);
  }

  await advanceGenreMeta(genre.genreId, timestamp);

  return { genre, timestamp, itemCount: currentItems.length, highlights };
}

/**
 * フェーズ2: フェーズ1で検知したハイライトをもとにGemini分析を行い保存する。
 * 楽天APIのようなレート制限の制約が無いため、呼び出し側で並行実行される想定。
 */
async function analyzeGenre(
  prep: GenrePreparation,
  dailyContext: DailyContext,
): Promise<GenreCollectionResult> {
  const { genre, timestamp, itemCount, highlights, error: prepError } = prep;
  let aiAnalysisGenerated = false;

  if (!prepError && highlights.length > 0) {
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
      await putInsight(genre.genreId, timestamp, trendAnalysisText, forecastText);
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
    itemCount,
    highlightCount: highlights.length,
    aiAnalysisGenerated,
    error: prepError,
  };
}

/** 1ジャンル分の「取得→差分検知→AI分析→保存」を直列に行う(単発実行・テスト用途向け) */
export async function collectAndAnalyzeGenre(
  genre: GenreDefinition,
  timestamp: string,
  dailyContext: DailyContext = EMPTY_DAILY_CONTEXT,
): Promise<GenreCollectionResult> {
  const prep = await prepareGenre(genre, timestamp);
  return analyzeGenre(prep, dailyContext);
}

/** 配列の各要素にfnを適用する。同時実行数をconcurrencyで制限する簡易ワーカープール */
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const current = nextIndex;
      nextIndex += 1;
      if (current >= items.length) return;
      results[current] = await fn(items[current]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  return results;
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
 * 全ての対象ジャンルを収集・分析する(定期収集バッチのエントリポイント)。
 * 1ジャンルの失敗が他ジャンルの処理を止めないよう、genre単位でエラーを捕捉する。
 *
 * 気象・トレンドは「前日(causalDate)分」を全ジャンル共通で1回だけ取得し、各ジャンルの
 * AI分析に渡す。収集時点(5時JST)では前日は既に終わっているため、Open-Meteoの実測値・
 * Geminiのトレンド要約とも確定情報として即座に取得でき、追加の夜間バッチは不要
 * (詳細な設計理由はCLAUDE.md参照)。
 *
 * 2フェーズ構成(2026-08-05〜07の3日連続Gemini障害を受けて導入、詳細はCLAUDE.md参照):
 * - フェーズ1(ランキング収集): 楽天APIのレート制限により直列。気象・トレンド取得は
 *   これと独立なので、フェーズ1の待ち時間に相乗りさせるため並行して開始する。
 * - フェーズ2(Gemini分析): 楽天APIのようなレート制限は無いため、
 *   GEMINI_ANALYSIS_CONCURRENCY件ずつ並行実行する。以前は直列(1ジャンルずつ)だったため、
 *   短いタイムアウトのfail-fastを16回積み上げるだけで300秒予算の大半を消費してしまい、
 *   個々の呼び出しに十分な時間を与えられなかった。
 */
export async function collectAndAnalyzeAllGenres(
  genres: GenreDefinition[] = TARGET_GENRES,
): Promise<CollectionOutcome> {
  const timestamp = new Date().toISOString();
  const today = toJstDateString(new Date(timestamp));
  const causalDate = addDaysJst(today, -1);

  const dailyContextPromise: Promise<DailyContext> = Promise.all([
    getOrFetchWeatherContext(causalDate),
    getOrFetchTrendContext(causalDate),
  ]).then(([weather, trend]) => ({ weather, trend }));

  // フェーズ1: 楽天APIのレート制限があるため直列。Gemini呼び出しはここでは行わない。
  const preparations: GenrePreparation[] = [];
  for (let i = 0; i < genres.length; i += 1) {
    const genre = genres[i];
    try {
      preparations.push(await prepareGenre(genre, timestamp));
    } catch (error) {
      console.error(
        `[collect] Failed to prepare genre ${genre.genreId} (${genre.name})`,
        error,
      );
      preparations.push({
        genre,
        timestamp,
        itemCount: 0,
        highlights: [],
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const isLast = i === genres.length - 1;
    if (!isLast) {
      await new Promise((resolve) => setTimeout(resolve, REQUEST_INTERVAL_MS));
    }
  }

  const dailyContext = await dailyContextPromise;

  // フェーズ2: Gemini分析は並行実行する(GEMINI_ANALYSIS_CONCURRENCY件ずつ)。
  const results = await mapWithConcurrency(
    preparations,
    GEMINI_ANALYSIS_CONCURRENCY,
    (prep) => analyzeGenre(prep, dailyContext),
  );

  try {
    await putDailyBundle(today, timestamp, causalDate);
  } catch (error) {
    console.error(`[collect] Failed to save daily bundle for date ${today}`, error);
  }

  return { results, weather: dailyContext.weather, trend: dailyContext.trend };
}

export interface RetryGenreResult {
  genreId: string;
  genreName: string;
  outcome:
    | "succeeded"
    | "failed"
    | "skipped-no-snapshot"
    | "skipped-already-ok"
    | "skipped-no-highlights";
  error?: string;
}

export interface RetryOutcome extends DailyContext {
  today: string;
  results: RetryGenreResult[];
}

/**
 * 当日分でAI分析が未完了のジャンルだけを対象に、Gemini呼び出しだけを再試行する。
 * ランキング再取得・GenreMeta更新には一切触れないため、何度実行しても安全(冪等)。
 * `/api/cron/retry`(自動リトライcron・ユーザーの手動トリガー両方から)呼ばれる想定。
 * 対応26./31./33.で毎回ゼロから作っていた一時的な復旧ルートを、恒久的な機能として
 * 持たせたもの(詳細な設計判断はCLAUDE.md参照)。
 */
export async function retryFailedGenres(
  genres: GenreDefinition[] = TARGET_GENRES,
): Promise<RetryOutcome> {
  const today = toJstDateString(new Date());
  const causalDate = addDaysJst(today, -1);

  const [weather, trend] = await Promise.all([
    getOrFetchWeatherContext(causalDate),
    getOrFetchTrendContext(causalDate),
  ]);
  const dailyContext: DailyContext = { weather, trend };

  const results = await mapWithConcurrency(
    genres,
    GEMINI_ANALYSIS_CONCURRENCY,
    async (genre): Promise<RetryGenreResult> => {
      const meta = await getGenreMeta(genre.genreId);
      if (!meta?.latestTimestamp || toJstDateString(new Date(meta.latestTimestamp)) !== today) {
        return {
          genreId: genre.genreId,
          genreName: genre.name,
          outcome: "skipped-no-snapshot",
        };
      }
      const timestamp = meta.latestTimestamp;

      const existingInsight = await getInsightAtTimestamp(genre.genreId, timestamp);
      if (existingInsight?.aiAnalysisText) {
        return {
          genreId: genre.genreId,
          genreName: genre.name,
          outcome: "skipped-already-ok",
        };
      }

      const highlightsItem = await getHighlightsAtTimestamp(genre.genreId, timestamp);
      const highlights = highlightsItem?.highlights ?? [];
      if (highlights.length === 0) {
        return {
          genreId: genre.genreId,
          genreName: genre.name,
          outcome: "skipped-no-highlights",
        };
      }

      try {
        const previousInsight = meta.previousTimestamp
          ? await getInsightAtTimestamp(genre.genreId, meta.previousTimestamp)
          : null;

        const { trendAnalysisText, forecastText } = await generateTrendInsight(
          genre.name,
          selectHighlightsForGemini(highlights),
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
        await putInsight(genre.genreId, timestamp, trendAnalysisText, forecastText);
        return { genreId: genre.genreId, genreName: genre.name, outcome: "succeeded" };
      } catch (error) {
        console.error(
          `[retry] Gemini analysis retry failed for genre ${genre.genreId}`,
          error,
        );
        return {
          genreId: genre.genreId,
          genreName: genre.name,
          outcome: "failed",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  );

  return { today, weather, trend, results };
}
