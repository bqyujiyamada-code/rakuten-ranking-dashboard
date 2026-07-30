// 楽天ウェブサービス IchibaItem Ranking API のレスポンス型 (必要な項目のみ抜粋)
export interface RakutenRankingRawItem {
  itemName: string;
  itemCode: string;
  // 2026年移行後の新エンドポイントは itemPrice を文字列で返すことがある (client.ts で Number() 変換する)
  itemPrice: number | string;
  itemUrl: string;
  shopName?: string;
  reviewCount?: number;
  reviewAverage?: number;
  mediumImageUrls?: { imageUrl: string }[];
  rank: number;
}

export interface RakutenRankingResponseEntry {
  Item: RakutenRankingRawItem;
}

export interface RakutenRankingResponse {
  Items: RakutenRankingResponseEntry[];
  count?: number;
  page?: number;
  genreInformation?: unknown;
}

/** アプリ内で使う正規化済みのランキング商品情報 */
export interface RankingItem {
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
}
