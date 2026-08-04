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
  forecastText?: string;
  highlights: DiffHighlightRecord[];
  createdAt: string;
}

/** 気象データ(日次・東京)。dateは実際にその気象が発生したJST暦日 ("YYYY-MM-DD") */
export interface WeatherDailyItem {
  PK: string; // WEATHER#{date}
  SK: "DAILY";
  entityType: "WEATHER_DAILY";
  date: string;
  location: string; // 例: "Tokyo"
  tempMaxC: number;
  tempMinC: number;
  precipitationMm: number;
  weatherCode: number;
  weatherLabel: string; // 日本語ラベル (例: "晴れ")
  fetchedAt: string;
}

/** 世間のトレンド要約(日次)。dateは要約の対象としたJST暦日 ("YYYY-MM-DD") */
export interface TrendDailyItem {
  PK: string; // TREND#{date}
  SK: "DAILY";
  entityType: "TREND_DAILY";
  date: string;
  summaryText: string;
  sources: { title: string; uri: string }[];
  fetchedAt: string;
}

/**
 * 日次バンドル索引。ランキング収集日(date, JST)から、その日の収集バッチの
 * timestampと、気象/トレンドの対象日(causalDate = date - 1日)を引けるようにする。
 * バックナンバー(過去日付選択)閲覧の起点。
 */
export interface DailyBundleItem {
  PK: string; // DAY#{date}
  SK: "META";
  entityType: "DAILY_BUNDLE";
  date: string;
  timestamp: string;
  causalDate: string;
  GSI2PK: string; // 固定値 "DAILY_BUNDLE"
  GSI2SK: string; // date と同じ
  createdAt: string;
}
