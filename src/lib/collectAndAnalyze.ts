import { TARGET_GENRES, type GenreDefinition } from "@/lib/rakuten/genres";
import { fetchGenreRanking } from "@/lib/rakuten/client";
import {
  advanceGenreMeta,
  getGenreMeta,
  getLatestInsight,
  getSnapshotAtTimestamp,
  putInsight,
  putRankingSnapshot,
} from "@/lib/db/rankingRepository";
import { detectDiffHighlights } from "@/lib/analysis/diff";
import { generateTrendInsight } from "@/lib/analysis/gemini";
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

/** 1ジャンル分の「取得 → 差分検知 → AI分析 → 保存」パイプライン */
export async function collectAndAnalyzeGenre(
  genre: GenreDefinition,
  timestamp: string,
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
      const { trendAnalysisText, forecastText } = await generateTrendInsight(
        genre.name,
        highlights,
        new Date(timestamp),
        previousInsight
          ? {
              trendAnalysisText: previousInsight.aiAnalysisText,
              forecastText: previousInsight.forecastText,
            }
          : null,
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
 * 全ての対象ジャンルを順番に収集・分析する (定期収集バッチのエントリポイント)。
 * 1ジャンルの失敗が他ジャンルの処理を止めないよう、genre単位でエラーを捕捉する。
 */
export async function collectAndAnalyzeAllGenres(
  genres: GenreDefinition[] = TARGET_GENRES,
): Promise<GenreCollectionResult[]> {
  const timestamp = new Date().toISOString();
  const results: GenreCollectionResult[] = [];

  for (let i = 0; i < genres.length; i += 1) {
    const genre = genres[i];
    try {
      const result = await collectAndAnalyzeGenre(genre, timestamp);
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

  return results;
}
