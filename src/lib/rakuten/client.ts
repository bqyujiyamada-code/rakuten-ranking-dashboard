import { env } from "@/lib/config/env";
import type {
  GenreDefinition,
} from "@/lib/rakuten/genres";
import type {
  RakutenRankingResponse,
  RankingItem,
} from "@/lib/rakuten/types";

const RANKING_ENDPOINT =
  "https://app.rakuten.co.jp/services/api/IchibaItem/Ranking/20220601";

// 楽天APIのレート制限 (概ね1リクエスト/秒) を踏まえた、複数ジャンル取得時のインターバル
const REQUEST_INTERVAL_MS = 1100;

export type RankingPeriod = "realtime" | "daily" | "weekly" | "monthly";

export interface FetchGenreRankingOptions {
  genreId: string;
  page?: number; // 1ページ30件、最大3ページ
  period?: RankingPeriod;
}

/** 指定ジャンルの楽天ランキングを取得し、正規化した配列で返す */
export async function fetchGenreRanking({
  genreId,
  page = 1,
  period = "daily",
}: FetchGenreRankingOptions): Promise<RankingItem[]> {
  const url = new URL(RANKING_ENDPOINT);
  url.searchParams.set("format", "json");
  url.searchParams.set("applicationId", env.rakuten.applicationId);
  url.searchParams.set("genreId", genreId);
  url.searchParams.set("page", String(page));
  url.searchParams.set("period", period);

  const res = await fetch(url.toString(), { cache: "no-store" });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Rakuten Ranking API error for genre ${genreId}: ${res.status} ${res.statusText} ${body}`,
    );
  }

  const data = (await res.json()) as RakutenRankingResponse;

  return data.Items.map(({ Item }) => ({
    genreId,
    itemCode: Item.itemCode,
    itemName: Item.itemName,
    rank: Item.rank,
    price: Item.itemPrice,
    itemUrl: Item.itemUrl,
    imageUrl: Item.mediumImageUrls?.[0]?.imageUrl,
    shopName: Item.shopName,
    reviewCount: Item.reviewCount,
    reviewAverage: Item.reviewAverage,
  }));
}

/**
 * 複数ジャンルのランキングを順番に取得する。
 * 楽天APIのレート制限に配慮し、リクエスト間に待機を挟む。
 * 1ジャンルの取得に失敗しても他ジャンルの収集は継続する。
 */
export async function fetchAllTargetGenreRankings(
  genres: GenreDefinition[],
  options?: { period?: RankingPeriod },
): Promise<Map<string, RankingItem[]>> {
  const result = new Map<string, RankingItem[]>();

  for (let i = 0; i < genres.length; i += 1) {
    const genre = genres[i];
    try {
      const items = await fetchGenreRanking({
        genreId: genre.genreId,
        period: options?.period,
      });
      result.set(genre.genreId, items);
    } catch (error) {
      console.error(
        `[rakuten] Failed to fetch ranking for genre ${genre.genreId} (${genre.name})`,
        error,
      );
    }

    const isLast = i === genres.length - 1;
    if (!isLast) {
      await new Promise((resolve) => setTimeout(resolve, REQUEST_INTERVAL_MS));
    }
  }

  return result;
}
