// DynamoDB `RakutenRankings` テーブルに保存する各アイテムの型定義 (単一テーブル設計)

export interface RankingSnapshotItem {
  PK: string; // GENRE#{genreId}#ITEM#{itemCode}
  SK: string; // TS#{timestamp}
  entityType: "RANKING_ITEM";
  genreId: string;
  itemCode: string;
  itemName: string;
  rank: number;
  price: number;
  itemUrl: string;
  imageUrl?: string;
  shopName?: string;
  reviewCount?: number;
  reviewAverage?: number;
  capturedAt: string; // ISO8601、SKと同じ値
  GSI1PK: string; // GENRE#{genreId}
  GSI1SK: string; // TS#{timestamp}#RANK#{paddedRank}
}

export interface GenreMetaItem {
  PK: string; // GENRE#{genreId}#META
  SK: string; // LATEST
  entityType: "GENRE_META";
  genreId: string;
  latestTimestamp?: string;
  previousTimestamp?: string;
  updatedAt: string;
}

export type DiffHighlightType =
  | "NEW_ENTRY"
  | "RANK_SURGE"
  | "RANK_DROP"
  | "PRICE_DROP"
  | "PRICE_UP";

export interface DiffHighlightRecord {
  type: DiffHighlightType;
  itemCode: string;
  itemName: string;
  currentRank?: number;
  previousRank?: number;
  currentPrice?: number;
  previousPrice?: number;
  detail: string;
}

export interface InsightItem {
  PK: string; // GENRE#{genreId}#INSIGHT
  SK: string; // TS#{timestamp}
  entityType: "AI_INSIGHT";
  genreId: string;
  timestamp: string;
  aiAnalysisText: string;
  highlights: DiffHighlightRecord[];
  createdAt: string;
}
