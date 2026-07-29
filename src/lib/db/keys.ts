// RakutenRankings テーブルの単一テーブル設計におけるキー生成ロジック。
// PK/SK の組み立てをこのファイルに集約し、他コードから文字列を直書きさせない。

export const GSI1_NAME = "GSI1_GenreTimestamp";

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
