// RakutenRankings テーブルの単一テーブル設計におけるキー生成ロジック。
// PK/SK の組み立てをこのファイルに集約し、他コードから文字列を直書きさせない。

export const GSI1_NAME = "GSI1_GenreTimestamp";
export const GSI2_NAME = "GSI2_DailyBundle";

export const META_SK = "LATEST";

/** ランキングitemスナップショットのPK: ジャンル×商品ごとの時系列を保持 */
export function itemPk(genreId: string, itemCode: string): string {
  return `GENRE#${genreId}#ITEM#${itemCode}`;
}

export function itemSk(timestamp: string): string {
  return `TS#${timestamp}`;
}

/** GSI1: ジャンル単位で「その時刻の順位表」を取得するためのキー */
export function genreGsi1Pk(genreId: string): string {
  return `GENRE#${genreId}`;
}

export function genreGsi1Sk(timestamp: string, rank: number): string {
  return `TS#${timestamp}#RANK#${String(rank).padStart(4, "0")}`;
}

export function genreGsi1SkPrefix(timestamp: string): string {
  return `TS#${timestamp}#`;
}

/** ジャンルごとの最新/直前収集タイムスタンプを覚えておくメタアイテム */
export function metaPk(genreId: string): string {
  return `GENRE#${genreId}#META`;
}

/** AIインサイト(差分分析コメント)のキー */
export function insightPk(genreId: string): string {
  return `GENRE#${genreId}#INSIGHT`;
}

export function insightSk(timestamp: string): string {
  return `TS#${timestamp}`;
}

/**
 * 差分ハイライト(ランキング表の「変動」列表示用)のキー。Gemini分析の成否とは独立に、
 * 差分検知ができた時点で必ず保存する(collectAndAnalyze.ts参照)。
 */
export function highlightsPk(genreId: string): string {
  return `GENRE#${genreId}#HIGHLIGHTS`;
}

export function highlightsSk(timestamp: string): string {
  return `TS#${timestamp}`;
}

/** 気象データ(日次・実際に発生した日=JST暦日をキーにする)のキー */
export function weatherPk(date: string): string {
  return `WEATHER#${date}`;
}

export const WEATHER_SK = "DAILY";

/** 世間のトレンド要約(日次)のキー */
export function trendPk(date: string): string {
  return `TREND#${date}`;
}

export const TREND_SK = "DAILY";

/**
 * 日次バンドル索引: 「ランキング収集日(JST)」から、その日の収集バッチが使った
 * timestampや気象/トレンドの対象日(causalDate)を引けるようにする。
 * バックナンバー(過去日付選択)閲覧のエントリポイント。
 */
export function dailyBundlePk(date: string): string {
  return `DAY#${date}`;
}

export const DAILY_BUNDLE_SK = "META";

// GSI2: 日次バンドルの一覧を新しい順に取得するための固定パーティション。
// 収集頻度が1日1回のため、単一パーティションに集約してもホットパーティションの懸念はない。
export const DAILY_BUNDLE_GSI2PK = "DAILY_BUNDLE";

export function dailyBundleGsi2Sk(date: string): string {
  return date;
}
