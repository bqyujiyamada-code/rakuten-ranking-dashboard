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
  /**
   * @deprecated 新規書き込みでは使わない(DiffHighlightsItem側に保存する。2026-08-06対応)。
   * それより前に書き込まれた過去レコードには埋め込まれたままなので、読み取り時の
   * 後方互換フォールバック用にoptionalで残している。
   */
  highlights?: DiffHighlightRecord[];
  createdAt: string;
}

/**
 * 差分ハイライト(ランキング表の「変動」列表示用)。差分検知ができた時点で、Gemini分析の
 * 成否とは独立して必ず保存する。以前はInsightItemに同梱していたが、Gemini API障害時に
 * putInsight自体が呼ばれず生データごと失われる問題があったため分離した(2026-08-06対応、
 * CLAUDE.md参照)。将来、収集済みデータから季節性・長期トレンドを分析する際の基礎データ。
 */
export interface DiffHighlightsItem {
  PK: string; // GENRE#{genreId}#HIGHLIGHTS
  SK: string; // TS#{timestamp}
  entityType: "DIFF_HIGHLIGHTS";
  genreId: string;
  timestamp: string;
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

/** 月次ロールアップの商品名キーワード頻度エントリ(対応42.)。字種ベースの素朴な抽出のため厳密ではない */
export interface RollupNameKeyword {
  term: string;
  /** その月、その語を名前に含んだユニークitemCode数 */
  itemCount: number;
  /** その語が出現した延べスナップショット行数(在籍日数ぶん重複カウントされる) */
  occurrences: number;
}

/** 月次ロールアップの top30 在籍商品エントリ(対応42.)。前月・前年同月との商品集合の突合用 */
export interface RollupTopItem {
  itemCode: string;
  itemName: string;
  /** その月のうち、その商品が top30 に載っていた収集日数 */
  daysPresent: number;
  avgRank: number;
  bestRank: number;
}

/**
 * 月次ロールアップ(ジャンル×JST暦月の集計値)。季節性・長期トレンド分析の土台となる
 * 導出データで、その月の生データ(RankingSnapshotItem/DiffHighlightsItem/WeatherDailyItem)
 * から都度フル再計算する(scripts/compute-monthly-rollup.mjs参照)。日次で積み上げる
 * インクリメンタル方式ではないため、再計算しても冪等(同じ月を何度計算しても同じ結果になる)。
 */
export interface MonthlyRollupItem {
  PK: string; // GENRE#{genreId}#ROLLUP
  SK: string; // MONTH#{YYYY-MM}
  entityType: "MONTHLY_ROLLUP";
  genreId: string;
  month: string; // "YYYY-MM" (JST暦月)
  /** その月で実際に収集できた日数。30に満たない場合はデータ欠落(Cron障害等)の目安になる */
  daysCollected: number;
  priceStats: { avg: number; min: number; max: number };
  /** ユニークなitemCode数 / (daysCollected * 30)。ジャンルの総入れ替わり傾向を月単位で見る指標 */
  uniqueItemCount: number;
  totalItemSlots: number;
  highlightCounts: Record<DiffHighlightType, number>;
  /**
   * その月の商品名から抽出した季節性キーワードの頻度(上位40語、対応42.)。前月比・前年同月比の
   * シフトを見るための材料。形態素解析は使っておらず字種ベース抽出のため厳密ではない。
   */
  nameKeywords: RollupNameKeyword[];
  /**
   * その月に top30 へ登場した商品の在籍日数ランキング(上位40件、対応42.)。前月・前年同月との
   * 商品集合の突合(定番化しているか / 総入れ替わりしているか)に使う。
   */
  topItems: RollupTopItem[];
  /** その月に対応するcausalDateの気象データが1件も無ければnull */
  weather: {
    avgTempMaxC: number;
    avgTempMinC: number;
    totalPrecipitationMm: number;
    daysWithData: number;
  } | null;
  computedAt: string;
}
